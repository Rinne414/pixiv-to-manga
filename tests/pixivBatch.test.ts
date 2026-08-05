import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioDatabase } from '../server/database'
import { PixivBatchService, registerPixivBatchRoutes } from '../server/pixivBatch'
import { SecretStore } from '../server/secrets'
import { registerStudioErrorHandler } from '../server/errorHandler'

function createService(fetchImpl: typeof fetch): { db: StudioDatabase; dbPath: string; secrets: SecretStore; service: PixivBatchService } {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-pixiv-batch-test-'))
  process.env.PTM_DATA_DIR = dataDir
  process.env.PTM_TEST_MEMORY_KEYTAR = '1'
  process.env.PTM_PIXIV_MOCK_BASE_URL = 'http://127.0.0.1:5199'
  process.env.PTM_PIXIV_REQUEST_DELAY_MS = '0'
  const dbPath = path.join(dataDir, 'studio.sqlite')
  const db = new StudioDatabase(dbPath, false)
  const secrets = new SecretStore(db)
  return { db, dbPath, secrets, service: new PixivBatchService({ db, secrets, fetchImpl }) }
}

describe('PixivBatchService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.PTM_DATA_DIR
    delete process.env.PTM_TEST_MEMORY_KEYTAR
    delete process.env.PTM_PIXIV_MOCK_BASE_URL
    delete process.env.PTM_PIXIV_REQUEST_DELAY_MS
  })

  it('previews selected pages up to the requested maximum', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: false,
      body: [0, 1, 2].map((pageIndex) => ({ urls: { original: `http://127.0.0.1:5199/assets/123456_p${pageIndex}.png` } })),
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { service } = createService(fetchMock)

    const preview = await service.preview({ urls: ['https://www.pixiv.net/artworks/123456'], r18Enabled: false, usePixivSession: false, maxImages: 2 })

    expect(preview).toMatchObject({ totalPages: 3, selectedPages: 2, maxImages: 2, requestDelayMs: 0 })
    expect(preview.artworks[0].pages.map((page) => page.selected)).toEqual([true, true, false])
  })

  it('deduplicates artwork inputs and omits the saved cookie for public previews', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: false,
      body: [{ urls: { original: 'http://127.0.0.1:5199/assets/123456_p0.png' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { secrets, service } = createService(fetchMock)
    await secrets.save({ pixivCookie: 'PHPSESSID=secret-value' })

    const preview = await service.preview({
      urls: ['123456', 'https://www.pixiv.net/artworks/123456'],
      r18Enabled: false,
      usePixivSession: false,
      maxImages: 200,
    })

    expect(preview.artworks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(requestHeaders.Cookie).toBeUndefined()
  })

  it('stops preview requests after Pixiv rate limiting', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'retry-after': '10' } }))
    const { service } = createService(fetchMock)

    const preview = await service.preview({ urls: ['123456', '789012'], r18Enabled: false, usePixivSession: false, maxImages: 200 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(preview.artworks).toHaveLength(2)
    expect(preview.artworks[0].error).toMatch(/429/)
    expect(preview.artworks[1].error).toMatch(/not requested/)
  })

  it('uses the saved session for private non-R-18 previews only when explicitly enabled', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: false,
      body: [{ urls: { original: 'http://127.0.0.1:5199/assets/123456_p0.png' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { secrets, service } = createService(fetchMock)
    await secrets.save({ pixivCookie: 'PHPSESSID=private-session' })

    await service.preview({ urls: ['123456'], r18Enabled: false, usePixivSession: true, maxImages: 200 })

    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(requestHeaders.Cookie).toBe('PHPSESSID=private-session')
  })

  it('persists a completed task and skips an identical project import', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(pngWithDimensions(320, 480), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Batch', mode: 'story', source: 'pixiv' })
    const page = { artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'pixiv-123456-001' }

    const first = service.createTask({ projectId: project.id, r18Enabled: false, usePixivSession: false, pages: [page] })
    await service.runTask(first.id)
    const completed = service.getTask(first.id)

    expect(completed).toMatchObject({ status: 'completed', completedItems: 1, failedItems: 0 })
    expect(completed.items[0]).toMatchObject({ status: 'complete', attempts: 1 })
    expect(db.getProjectDetail(project.id).pages[0]).toMatchObject({ width: 320, height: 480 })

    const second = service.createTask({ projectId: project.id, r18Enabled: false, usePixivSession: false, pages: [page] })
    await service.runTask(second.id)

    expect(service.getTask(second.id).items[0].status).toBe('skipped')
    expect(db.getProjectDetail(project.id).pages).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent tasks and atomically deduplicates the imported project page', async () => {
    let activeRequests = 0
    let maximumActiveRequests = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      await new Promise((resolve) => setTimeout(resolve, 15))
      activeRequests -= 1
      return new Response(pngWithDimensions(320, 480), { status: 200, headers: { 'content-type': 'image/png' } })
    })
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Concurrent', mode: 'story', source: 'pixiv' })
    const page = { artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }
    const first = service.createTask({ projectId: project.id, r18Enabled: false, usePixivSession: false, pages: [page] })
    const second = service.createTask({ projectId: project.id, r18Enabled: false, usePixivSession: false, pages: [page] })

    await Promise.all([service.runTask(first.id), service.runTask(second.id)])

    expect(maximumActiveRequests).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.getProjectDetail(project.id).pages).toHaveLength(1)
    expect(service.getTask(first.id).items[0].status).toBe('complete')
    expect(service.getTask(second.id).items[0].status).toBe('skipped')
  })

  it('pauses a task on rate limiting and preserves a retry time', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'retry-after': '10' } }))
    const { db, secrets, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Rate limited', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    await service.runTask(task.id)
    const paused = service.getTask(task.id)

    expect(paused.status).toBe('paused')
    expect(paused.pauseReason).toMatch(/rate limit/i)
    expect(paused.retryAt).toBeTruthy()
    expect(paused.items[0].status).toBe('queued')
    expect(() => service.resumeTask(task.id)).toThrow(/cooldown/i)
    expect(service.getTask(task.id).status).toBe('paused')
    const server = fastify()
    registerStudioErrorHandler(server)
    registerPixivBatchRoutes(server, { db, secrets, fetchImpl: fetchMock })
    const response = await server.inject({ method: 'POST', url: `/api/import/pixiv/tasks/${task.id}/resume` })
    expect(response.statusCode).toBe(429)
    expect(response.json().error).toMatch(/cooldown/i)
    await server.close()
  })

  it('restores the global Pixiv cooldown before new requests after restart', async () => {
    const rateLimitedFetch = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'retry-after': '1' } }))
    const { dbPath, service } = createService(rateLimitedFetch)
    await service.preview({ urls: ['123456'], r18Enabled: false, usePixivSession: false, maxImages: 200 })

    const successfulFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: false,
      body: [{ urls: { original: 'http://127.0.0.1:5199/assets/123456_p0.png' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const restartedDb = new StudioDatabase(dbPath, false)
    const restartedSecrets = new SecretStore(restartedDb)
    const restartedService = new PixivBatchService({ db: restartedDb, secrets: restartedSecrets, fetchImpl: successfulFetch })
    const previewPromise = restartedService.preview({ urls: ['123456'], r18Enabled: false, usePixivSession: false, maxImages: 200 })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(successfulFetch).not.toHaveBeenCalled()
    await previewPromise
    expect(successfulFetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('pauses on Pixiv authentication or permission HTTP %i', async (status) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status }))
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: `HTTP ${status}`, mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    await service.runTask(task.id)

    expect(service.getTask(task.id)).toMatchObject({ status: 'paused', retryAt: undefined })
    expect(service.getTask(task.id).pauseReason).toMatch(new RegExp(`HTTP ${status}`))
  })

  it('resets an active item when the user cancels an in-flight request', async () => {
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      markStarted()
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Cancel', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    const worker = service.runTask(task.id)
    await started
    service.cancelTask(task.id)
    await worker

    const cancelled = service.getTask(task.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.items[0].status).toBe('queued')
  })

  it('allows retrying a task-level secret-store failure with no failed items', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const { db, secrets, service } = createService(fetchMock)
    vi.spyOn(secrets, 'getPixivCookie').mockRejectedValueOnce(new Error('Credential store unavailable'))
    const project = db.createProject({ title: 'Secret failure', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: true,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    await service.runTask(task.id)

    expect(service.getTask(task.id)).toMatchObject({ status: 'failed', failedItems: 0, error: 'Credential store unavailable' })
    expect(service.retryTask(task.id).status).toBe('queued')
  })

  it('retries server failures exactly three times before failing the page', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }))
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Retries', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    await service.runTask(task.id)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(service.getTask(task.id)).toMatchObject({ status: 'failed', failedItems: 1 })
    expect(service.retryTask(task.id)).toMatchObject({ status: 'queued', failedItems: 0, items: [{ status: 'queued' }] })
  })

  it('fails closed when an image response omits its MIME type', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(pngWithDimensions(320, 480), { status: 200 }))
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Missing MIME', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    await service.runTask(task.id)

    expect(service.getTask(task.id).items[0].error).toMatch(/missing Content-Type/)
    expect(db.getProjectDetail(project.id).pages).toHaveLength(0)
  })

  it('cancels an oversized response stream before buffering more than 30 MB', async () => {
    let cancelled = false
    let chunksSent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksSent += 1
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }))
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Oversized', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })

    await service.runTask(task.id)

    expect(cancelled).toBe(true)
    expect(chunksSent).toBeLessThanOrEqual(32)
    expect(service.getTask(task.id).items[0].error).toMatch(/31457280-byte limit/)
  })

  it('rejects non-Pixiv image hosts before creating a task', () => {
    const fetchMock = vi.fn<typeof fetch>()
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Host validation', mode: 'story', source: 'pixiv' })

    expect(() => service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'https://example.com/image.png', fileName: 'page.png' }],
    })).toThrow(/Pixiv image asset URLs/i)
  })

  it('pauses persisted running work and restores downloading items after restart', () => {
    const fetchMock = vi.fn<typeof fetch>()
    const { db, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Restart', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })
    db.updatePixivBatchTaskItem(task.items[0].id, { status: 'downloading' })
    db.updatePixivBatchTask(task.id, { status: 'running' })

    const restarted = new StudioDatabase(path.join(process.env.PTM_DATA_DIR!, 'studio.sqlite'), false)
    const restored = restarted.getPixivBatchTask(task.id)

    expect(restored.status).toBe('paused')
    expect(restored.pauseReason).toMatch(/restart/i)
    expect(restored.items[0].status).toBe('queued')
    expect(restarted.listRecoverablePixivBatchTasks(project.id).map((candidate) => candidate.id)).toContain(task.id)
  })

  it('lists recoverable tasks through the project-scoped route', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const { db, secrets, service } = createService(fetchMock)
    const project = db.createProject({ title: 'Recoverable', mode: 'story', source: 'pixiv' })
    const task = service.createTask({
      projectId: project.id,
      r18Enabled: false,
      usePixivSession: false,
      pages: [{ artworkId: '123456', pageIndex: 0, sourceUrl: 'http://127.0.0.1:5199/assets/123456_p0.png', fileName: 'page.png' }],
    })
    const server = fastify()
    registerPixivBatchRoutes(server, { db, secrets, fetchImpl: fetchMock })

    const response = await server.inject({ method: 'GET', url: `/api/import/pixiv/tasks?projectId=${project.id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ tasks: [{ id: task.id, projectId: project.id, status: 'queued' }] })
    await server.close()
  })

  it('serves the route contract and tests the saved session without returning its cookie', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ userData: { id: '42' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const { db, secrets } = createService(fetchMock)
    await secrets.save({ pixivCookie: 'PHPSESSID=secret-value' })
    const server = fastify()
    registerPixivBatchRoutes(server, { db, secrets, fetchImpl: fetchMock })

    const response = await server.inject({ method: 'GET', url: '/api/pixiv/session/test' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'authenticated', message: 'Pixiv session is valid', httpStatus: 200, canImportPublic: true, canImportPrivate: true })
    expect(response.body).not.toContain('secret-value')
    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(requestHeaders.Cookie).toBe('PHPSESSID=secret-value')
    await server.close()
  })
})

function pngWithDimensions(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buffer, 0)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}
