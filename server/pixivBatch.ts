import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { extractPixivArtworkId, assertPixivImageUrl } from '../src/shared/pixiv'
import type {
  PixivBatchPreviewArtwork,
  PixivBatchPreviewPage,
  PixivBatchPreviewResponse,
  PixivBatchTask,
  PixivSessionTestResult,
} from '../src/shared/types'
import { pixivBatchPreviewSchema, pixivBatchTaskIdSchema, pixivBatchTaskQuerySchema, pixivBatchTaskSchema } from '../src/shared/schemas'
import type { StudioDatabase } from './database'
import { ALLOWED_IMAGE_MIME, detectImageDimensions, MAX_IMAGE_BYTES } from './importers'
import { getAppDataDir, projectAssetDir } from './paths'
import type { SecretStore } from './secrets'

const DEFAULT_REQUEST_DELAY_MS = 1800
const MAX_REQUEST_RETRIES = 3
const MAX_BATCH_IMAGES = 200

export interface PixivBatchContext {
  db: StudioDatabase
  secrets: SecretStore
  fetchImpl?: typeof fetch
}

export function registerPixivBatchRoutes(server: FastifyInstance, context: PixivBatchContext): PixivBatchService {
  const service = new PixivBatchService(context)

  server.post('/api/import/pixiv/preview', async (request) => {
    const input = pixivBatchPreviewSchema.parse(request.body ?? {})
    return service.preview(input)
  })

  server.post('/api/import/pixiv/tasks', async (request) => {
    const input = pixivBatchTaskSchema.parse(request.body ?? {})
    const task = service.createTask(input)
    void service.runTask(task.id)
    return task
  })

  server.get('/api/import/pixiv/tasks/:id', async (request) => {
    const { id } = pixivBatchTaskIdSchema.parse(request.params)
    return service.getTask(id)
  })

  server.get('/api/import/pixiv/tasks', async (request) => {
    const { projectId } = pixivBatchTaskQuerySchema.parse(request.query)
    return { tasks: context.db.listRecoverablePixivBatchTasks(projectId) }
  })

  server.post('/api/import/pixiv/tasks/:id/pause', async (request) => {
    const { id } = pixivBatchTaskIdSchema.parse(request.params)
    return service.pauseTask(id)
  })

  server.post('/api/import/pixiv/tasks/:id/resume', async (request) => {
    const { id } = pixivBatchTaskIdSchema.parse(request.params)
    const task = service.resumeTask(id)
    void service.runTask(task.id)
    return task
  })

  server.post('/api/import/pixiv/tasks/:id/cancel', async (request) => {
    const { id } = pixivBatchTaskIdSchema.parse(request.params)
    return service.cancelTask(id)
  })

  server.post('/api/import/pixiv/tasks/:id/retry', async (request) => {
    const { id } = pixivBatchTaskIdSchema.parse(request.params)
    const task = service.retryTask(id)
    void service.runTask(task.id)
    return task
  })

  server.get('/api/pixiv/session/test', async () => service.testSession())
  return service
}

export class PixivBatchService {
  private readonly db: StudioDatabase
  private readonly secrets: SecretStore
  private readonly fetchImpl: typeof fetch
  private readonly workers = new Map<string, Promise<void>>()
  private readonly abortControllers = new Map<string, AbortController>()
  private taskQueue: Promise<void> = Promise.resolve()
  private requestQueue: Promise<void> = Promise.resolve()
  private nextRequestAt: number

  constructor(context: PixivBatchContext) {
    this.db = context.db
    this.secrets = context.secrets
    this.fetchImpl = context.fetchImpl || fetch
    const persistedCooldown = this.db.getPixivRequestCooldown()
    this.nextRequestAt = persistedCooldown ? Date.parse(persistedCooldown) : 0
  }

  async preview(input: { urls: string[]; r18Enabled: boolean; usePixivSession: boolean; maxImages: number }): Promise<PixivBatchPreviewResponse> {
    const delayMs = requestDelayMs()
    const cookie = input.r18Enabled || input.usePixivSession ? await this.secrets.getPixivCookie() : null
    const artworks: PixivBatchPreviewArtwork[] = []
    let totalPages = 0
    let selectedPages = 0
    let haltedReason = ''

    for (const rawUrl of uniqueArtworkInputs(input.urls)) {
      const artworkId = extractPixivArtworkId(rawUrl)
      if (!artworkId) {
        artworks.push({ artworkId: '', artworkUrl: rawUrl, pageCount: 0, pages: [], error: 'Invalid Pixiv artwork URL' })
        continue
      }
      if (haltedReason) {
        artworks.push({ artworkId, artworkUrl: `https://www.pixiv.net/artworks/${artworkId}`, pageCount: 0, pages: [], error: haltedReason })
        continue
      }
      try {
        const urls = await this.fetchArtworkPages(artworkId, cookie, delayMs)
        const pages: PixivBatchPreviewPage[] = urls.map((sourceUrl, pageIndex) => {
          const selected = selectedPages < input.maxImages
          if (selected) selectedPages += 1
          return {
            artworkId,
            pageIndex,
            sourceUrl,
            fileName: `pixiv-${artworkId}-${String(pageIndex + 1).padStart(3, '0')}${extensionFromUrl(sourceUrl)}`,
            selected,
          }
        })
        totalPages += pages.length
        artworks.push({
          artworkId,
          artworkUrl: `https://www.pixiv.net/artworks/${artworkId}`,
          pageCount: pages.length,
          pages,
        })
      } catch (error) {
        artworks.push({
          artworkId,
          artworkUrl: `https://www.pixiv.net/artworks/${artworkId}`,
          pageCount: 0,
          pages: [],
          error: publicPixivError(error),
        })
        if (error instanceof PixivPauseError) haltedReason = `${error.message}; remaining previews were not requested`
      }
    }

    return { artworks, totalPages, selectedPages, maxImages: input.maxImages, requestDelayMs: delayMs }
  }

  createTask(input: {
    projectId?: string
    title?: string
    r18Enabled: boolean
    usePixivSession: boolean
    pages: Array<{ artworkId: string; pageIndex: number; sourceUrl: string; fileName: string }>
    requestDelayMs?: number
  }): PixivBatchTask {
    if (input.pages.length > MAX_BATCH_IMAGES) throw new Error('Pixiv batch tasks cannot contain more than 200 pages')
    const pages = uniqueTaskPages(input.pages).map((page) => ({ ...page, sourceUrl: assertDownloadUrl(page.sourceUrl).toString() }))
    if (!pages.length) throw new Error('At least one Pixiv page is required')
    const project = input.projectId
      ? this.db.getProject(input.projectId)
      : this.db.createProject({ title: input.title || 'Pixiv Batch Import', mode: 'story', source: 'pixiv' })
    return this.db.createPixivBatchTask({
      projectId: project.id,
      title: input.title || project.title,
      r18Enabled: input.r18Enabled,
      usePixivSession: input.r18Enabled || input.usePixivSession,
      requestDelayMs: effectiveTaskDelayMs(input.requestDelayMs),
      pages,
    })
  }

  getTask(taskId: string): PixivBatchTask {
    return this.db.getPixivBatchTask(taskId)
  }

  pauseTask(taskId: string): PixivBatchTask {
    const task = this.db.getPixivBatchTask(taskId)
    if (isTerminalTask(task.status)) return task
    this.abortControllers.get(taskId)?.abort()
    for (const item of task.items) {
      if (item.status === 'downloading') this.db.updatePixivBatchTaskItem(item.id, { status: 'queued' })
    }
    return this.db.updatePixivBatchTask(taskId, { status: 'paused', pauseReason: 'Paused by user', retryAt: null })
  }

  resumeTask(taskId: string): PixivBatchTask {
    const task = this.db.getPixivBatchTask(taskId)
    if (task.status !== 'paused') return task
    if (task.retryAt && Date.parse(task.retryAt) > Date.now()) throw new PixivCooldownError(task.retryAt)
    return this.db.updatePixivBatchTask(taskId, { status: 'queued', pauseReason: null, retryAt: null, error: null })
  }

  cancelTask(taskId: string): PixivBatchTask {
    const task = this.db.getPixivBatchTask(taskId)
    if (isTerminalTask(task.status)) return task
    this.abortControllers.get(taskId)?.abort()
    for (const item of task.items) {
      if (item.status === 'downloading') this.db.updatePixivBatchTaskItem(item.id, { status: 'queued', error: 'Cancelled by user' })
    }
    return this.db.updatePixivBatchTask(taskId, { status: 'cancelled', pauseReason: null, retryAt: null })
  }

  retryTask(taskId: string): PixivBatchTask {
    const task = this.db.getPixivBatchTask(taskId)
    if (task.status === 'cancelled' || task.status === 'completed') return task
    for (const item of task.items) {
      if (item.status === 'failed') this.db.updatePixivBatchTaskItem(item.id, { status: 'queued', error: null })
    }
    return this.db.updatePixivBatchTask(taskId, { status: 'queued', failedItems: 0, error: null, pauseReason: null, retryAt: null })
  }

  async testSession(): Promise<PixivSessionTestResult> {
    const cookie = await this.secrets.getPixivCookie()
    if (!cookie) {
      return {
        status: 'not_configured',
        message: 'No Pixiv session cookie is saved; public artworks can still be imported',
        canImportPublic: true,
        canImportPrivate: false,
      }
    }
    try {
      const response = await this.request(new URL('/ajax/user/self?lang=en', pixivBaseUrl()), cookie, requestDelayMs(), undefined, null)
      if (!response.ok) return { status: 'unauthenticated', message: 'Pixiv session is not authenticated', httpStatus: response.status, canImportPublic: true, canImportPrivate: false }
      const payload = await parseJsonRecord(response)
      const userData = payload.userData ?? payload.body
      const userRecord = userData && typeof userData === 'object' && !Array.isArray(userData)
        ? userData as Record<string, unknown>
        : null
      const loggedIn = Boolean(userRecord && String(userRecord.userId ?? userRecord.id ?? ''))
      return loggedIn
        ? { status: 'authenticated', message: 'Pixiv session is valid', httpStatus: response.status, canImportPublic: true, canImportPrivate: true }
        : { status: 'unauthenticated', message: 'Pixiv responded without an authenticated user', httpStatus: response.status, canImportPublic: true, canImportPrivate: false }
    } catch (error) {
      const httpStatus = error instanceof PixivHttpError ? error.status : undefined
      return {
        status: httpStatus === 429 ? 'rate_limited' : httpStatus === 401 || httpStatus === 403 ? 'unauthenticated' : 'error',
        message: publicPixivError(error),
        ...(httpStatus === undefined ? {} : { httpStatus }),
        canImportPublic: httpStatus === 401 || httpStatus === 403,
        canImportPrivate: false,
      }
    }
  }

  async runTask(taskId: string): Promise<void> {
    if (this.workers.has(taskId)) return this.workers.get(taskId)
    const previousTask = this.taskQueue
    const worker = previousTask.then(() => this.processTask(taskId)).catch((error) => {
      const task = this.db.getPixivBatchTask(taskId)
      if (!isTerminalTask(task.status) && task.status !== 'paused') {
        this.db.updatePixivBatchTask(taskId, { status: 'failed', error: publicPixivError(error) })
      }
    }).finally(() => {
      this.workers.delete(taskId)
      this.abortControllers.delete(taskId)
      if (this.db.getPixivBatchTask(taskId).status === 'queued') void this.runTask(taskId)
    })
    this.workers.set(taskId, worker)
    this.taskQueue = worker.then(() => undefined, () => undefined)
    return worker
  }

  private async processTask(taskId: string): Promise<void> {
    const controller = new AbortController()
    this.abortControllers.set(taskId, controller)
    const initial = this.db.getPixivBatchTask(taskId)
    if (isTerminalTask(initial.status) || initial.status === 'paused') return
    this.db.updatePixivBatchTask(taskId, { status: 'running', error: null, pauseReason: null, retryAt: null })

    const cookie = initial.usePixivSession ? await this.secrets.getPixivCookie() : null
    for (;;) {
      const task = this.db.getPixivBatchTask(taskId)
      if (task.status === 'cancelled' || task.status === 'paused') return
      const item = task.items.find((candidate) => candidate.status === 'queued')
      if (!item) {
        const finalStatus = task.failedItems > 0 ? 'failed' : 'completed'
        this.db.updatePixivBatchTask(taskId, { status: finalStatus, error: task.failedItems > 0 ? 'One or more Pixiv pages failed' : null })
        return
      }

      this.db.updatePixivBatchTaskItem(item.id, { status: 'downloading', attempts: item.attempts + 1, error: null })
      try {
        const result = await this.downloadPage(task, item, cookie, controller.signal)
        this.db.updatePixivBatchTaskItem(item.id, {
          status: result.skipped ? 'skipped' : 'complete',
          assetId: result.assetId,
          pageId: result.pageId,
        })
      } catch (error) {
        if (error instanceof PixivPauseError) {
          this.db.updatePixivBatchTaskItem(item.id, { status: 'queued', error: error.message })
          this.db.updatePixivBatchTask(taskId, { status: 'paused', pauseReason: error.message, retryAt: error.retryAt })
          return
        }
        if (controller.signal.aborted || this.db.getPixivBatchTask(taskId).status === 'cancelled') return
        this.db.updatePixivBatchTaskItem(item.id, { status: 'failed', error: publicPixivError(error) })
      }
      this.refreshTaskCounts(taskId)
    }
  }

  private refreshTaskCounts(taskId: string): void {
    const task = this.db.getPixivBatchTask(taskId)
    const completedItems = task.items.filter((item) => item.status === 'complete' || item.status === 'skipped').length
    const failedItems = task.items.filter((item) => item.status === 'failed').length
    this.db.updatePixivBatchTask(taskId, { completedItems, failedItems })
  }

  private async downloadPage(
    task: PixivBatchTask,
    item: PixivBatchTask['items'][number],
    cookie: string | null,
    signal: AbortSignal,
  ): Promise<{ skipped: boolean; assetId: string; pageId: string }> {
    const duplicate = this.db.findPixivImportRecord({
      projectId: task.projectId,
      artworkId: item.artworkId,
      pageIndex: item.pageIndex,
      sourceRevision: item.sourceUrl,
    })
    if (duplicate) return { skipped: true, ...duplicate }

    const imageUrl = assertDownloadUrl(item.sourceUrl)
    const response = await this.request(imageUrl, cookie, task.requestDelayMs, signal, item.artworkId)
    if (!response.ok || !response.body) throw new PixivHttpError(response.status, 'Pixiv image request failed')
    const contentType = response.headers.get('content-type')
    if (!contentType) throw new Error('Pixiv image response is missing Content-Type')
    const mimeType = contentType.split(';')[0].trim().toLowerCase()
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) throw new Error(`Pixiv returned unsupported image type: ${mimeType}`)
    const buffer = await readResponseBuffer(response, MAX_IMAGE_BYTES)
    const dimensions = detectImageDimensions(buffer, mimeType)
    if (!dimensions) throw new Error(`Pixiv returned invalid ${mimeType} image data`)
    const safeName = safeFileName(item.fileName, mimeType)
    const extension = path.extname(safeName)
    const stem = path.basename(safeName, extension)
    const relativePath = path.join('projects', task.projectId, 'originals', `${stem}-${item.id}${extension}`)
    const absolutePath = path.join(getAppDataDir(), relativePath)
    const temporaryPath = `${absolutePath}.part`
    projectAssetDir(task.projectId, 'originals')
    await writeFile(temporaryPath, buffer)
    await rm(absolutePath, { force: true })
    await rename(temporaryPath, absolutePath)
    const imported = this.db.createPixivImportedPage({
      projectId: task.projectId,
      artworkId: item.artworkId,
      pageIndex: item.pageIndex,
      sourceUrl: item.sourceUrl,
      sourceRevision: item.sourceUrl,
      fileName: safeName,
      relativePath,
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
    })
    if (!imported.created) await rm(absolutePath)
    return { skipped: !imported.created, assetId: imported.assetId, pageId: imported.pageId }
  }

  private async fetchArtworkPages(artworkId: string, cookie: string | null, delayMs: number): Promise<string[]> {
    const url = new URL(`/ajax/illust/${artworkId}/pages?lang=en`, pixivBaseUrl())
    const response = await this.request(url, cookie, delayMs, undefined, artworkId)
    if (!response.ok) throw new PixivHttpError(response.status, 'Pixiv artwork metadata request failed')
    const payload = await parseJsonRecord(response)
    if (payload.error === true) throw new Error('Pixiv rejected the artwork metadata request')
    const body = payload.body
    if (!Array.isArray(body)) throw new Error('Pixiv returned an invalid artwork metadata response')
    const urls = body.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const urlsValue = (entry as Record<string, unknown>).urls
      if (!urlsValue || typeof urlsValue !== 'object') return []
      const original = (urlsValue as Record<string, unknown>).original
      const regular = (urlsValue as Record<string, unknown>).regular
      return typeof original === 'string' ? [assertDownloadUrl(original).toString()] : typeof regular === 'string' ? [assertDownloadUrl(regular).toString()] : []
    })
    if (!urls.length) throw new Error('Pixiv artwork has no downloadable pages')
    return urls
  }

  private async request(url: URL, cookie: string | null, delayMs: number, signal: AbortSignal | undefined, artworkId: string | null): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_REQUEST_RETRIES; attempt += 1) {
      try {
        const response = await this.fetchWithThrottle(url, cookie, delayMs, signal, artworkId)
        if (response.status === 401 || response.status === 403) throw new PixivPauseError(response.status, `Pixiv session or permissions need attention (HTTP ${response.status})`, undefined)
        if (response.status === 429) {
          const retryAt = retryAtFromResponse(response)
          this.nextRequestAt = Math.max(this.nextRequestAt, retryAt ? Date.parse(retryAt) : Date.now() + 60_000)
          const persistedRetryAt = this.db.setPixivRequestCooldown(new Date(this.nextRequestAt).toISOString())
          throw new PixivPauseError(response.status, 'Pixiv rate limit reached (HTTP 429); task paused', persistedRetryAt)
        }
        if (response.status >= 500 && response.status <= 599) {
          lastError = new PixivHttpError(response.status, `Pixiv server error (HTTP ${response.status})`)
          continue
        }
        return response
      } catch (error) {
        if (error instanceof PixivPauseError) throw error
        if (signal?.aborted) throw error
        lastError = error
        if (attempt + 1 >= MAX_REQUEST_RETRIES) break
      }
    }
    if (lastError instanceof PixivHttpError) throw lastError
    throw new Error(lastError instanceof Error ? lastError.message : 'Pixiv request failed after retries')
  }

  private async fetchWithThrottle(url: URL, cookie: string | null, delayMs: number, signal: AbortSignal | undefined, artworkId: string | null): Promise<Response> {
    const previousRequest = this.requestQueue
    let releaseRequest: () => void = () => undefined
    this.requestQueue = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    await previousRequest
    try {
      await wait(Math.max(0, this.nextRequestAt - Date.now()), signal)
      this.nextRequestAt = Date.now() + delayMs
      return await this.fetchImpl(url, {
        headers: pixivHeaders(cookie, artworkId ? `https://www.pixiv.net/artworks/${artworkId}` : 'https://www.pixiv.net/'),
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      })
    } finally {
      releaseRequest()
    }
  }
}

export class PixivHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PixivHttpError'
    this.status = status
  }
}

class PixivPauseError extends PixivHttpError {
  readonly retryAt: string | null

  constructor(status: number, message: string, retryAt: string | undefined) {
    super(status, message)
    this.name = 'PixivPauseError'
    this.retryAt = retryAt || null
  }
}

class PixivCooldownError extends Error {
  readonly statusCode = 429
  readonly retryAt: string

  constructor(retryAt: string) {
    super(`Pixiv rate-limit cooldown is active until ${retryAt}`)
    this.name = 'PixivCooldownError'
    this.retryAt = retryAt
  }
}

function uniqueTaskPages(pages: Array<{ artworkId: string; pageIndex: number; sourceUrl: string; fileName: string }>): Array<{ artworkId: string; pageIndex: number; sourceUrl: string; fileName: string }> {
  const seen = new Set<string>()
  return pages.filter((page) => {
    const key = `${page.artworkId}:${page.pageIndex}:${page.sourceUrl}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueArtworkInputs(inputs: string[]): string[] {
  const seen = new Set<string>()
  return inputs.filter((input) => {
    const artworkId = extractPixivArtworkId(input)
    const key = artworkId || input
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function safeFileName(fileName: string, mimeType: string): string {
  const base = path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, '_')
  const stem = path.basename(base, path.extname(base)).slice(0, 180) || 'pixiv-page'
  return `${stem}${extensionForMime(mimeType)}`
}

function extensionForMime(mimeType: string): string {
  return mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/svg+xml' ? '.svg' : '.jpg'
}

function extensionFromUrl(sourceUrl: string): string {
  const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? extension : ''
}

function assertDownloadUrl(rawUrl: string): URL {
  const mock = getMockBaseUrl()
  const url = new URL(rawUrl)
  if (url.username || url.password) throw new Error('Pixiv image URLs must not contain credentials')
  if (mock && url.origin === mock.origin) return url
  return assertPixivImageUrl(rawUrl)
}

function pixivBaseUrl(): URL {
  return getMockBaseUrl() || new URL('https://www.pixiv.net')
}

function getMockBaseUrl(): URL | null {
  const raw = process.env.PTM_PIXIV_MOCK_BASE_URL?.trim()
  if (!raw) return null
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopback(url.hostname)) throw new Error('PTM_PIXIV_MOCK_BASE_URL must point to a loopback HTTP(S) server')
  return url
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function pixivHeaders(cookie: string | null, referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: referer,
    'User-Agent': 'Mozilla/5.0 Pixiv-to-Manga-Studio/0.1',
    Accept: 'application/json,image/avif,image/webp,image/png,image/jpeg,*/*',
  }
  if (cookie) headers.Cookie = cookie
  return headers
}

function requestDelayMs(): number {
  const raw = process.env.PTM_PIXIV_REQUEST_DELAY_MS?.trim()
  if (!raw) return DEFAULT_REQUEST_DELAY_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('PTM_PIXIV_REQUEST_DELAY_MS must be a non-negative number')
  return Math.min(60_000, Math.floor(parsed))
}

function effectiveTaskDelayMs(requested: number | undefined): number {
  const configured = requestDelayMs()
  if (configured === 0) return 0
  return Math.max(500, requested ?? configured)
}

async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('Pixiv image response has no body')
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`Pixiv image exceeds the ${maxBytes}-byte limit`)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    totalBytes += chunk.value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel('Pixiv image exceeded the configured size limit')
      throw new Error(`Pixiv image exceeds the ${maxBytes}-byte limit`)
    }
    chunks.push(Buffer.from(chunk.value))
  }
  return Buffer.concat(chunks, totalBytes)
}

function wait(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Pixiv request was aborted'))
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Pixiv request was aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function retryAtFromResponse(response: Response): string | undefined {
  const raw = response.headers.get('retry-after')
  if (!raw) return new Date(Date.now() + 60_000).toISOString()
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString()
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

async function parseJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pixiv returned an invalid JSON response')
  return value as Record<string, unknown>
}

function publicPixivError(error: unknown): string {
  if (error instanceof PixivPauseError || error instanceof PixivHttpError) return error.message
  if (error instanceof Error) return error.message.slice(0, 300)
  return 'Pixiv request failed'
}

function isTerminalTask(status: PixivBatchTask['status']): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed'
}
