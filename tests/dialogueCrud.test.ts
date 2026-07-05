import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { registerDialogueRoutes } from '../server/dialogues'

function createDb(): StudioDatabase {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-dialogue-crud-test-'))
  process.env.PTM_DATA_DIR = dataDir
  return new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
}

function createPageFixture(db: StudioDatabase) {
  const project = db.createProject({ title: 'CRUD Project', mode: 'story', source: 'local' })
  const asset = db.createAsset({
    projectId: project.id,
    kind: 'original',
    relativePath: path.join('projects', project.id, 'originals', 'page-001.svg'),
    mimeType: 'image/svg+xml',
  })
  const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
  return { project, page }
}

function createServer(db: StudioDatabase): FastifyInstance {
  const server = fastify()
  registerDialogueRoutes(server, { db })
  return server
}

afterEach(() => {
  delete process.env.PTM_DATA_DIR
})

describe('dialogue CRUD routes', () => {
  it('creates a dialogue with placeholder defaults on an existing page', async () => {
    const db = createDb()
    const { project, page } = createPageFixture(db)
    const server = createServer(db)

    const response = await server.inject({
      method: 'POST',
      url: `/api/pages/${page.id}/dialogues`,
      payload: {},
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({
      pageId: page.id,
      text: '……',
      x: 0.5,
      y: 0.5,
      bubbleStyle: 'speech',
      locked: false,
    })
    expect(db.getProjectDetail(project.id).dialogues).toHaveLength(1)
  })

  it('creates a dialogue at the requested position with custom fields', async () => {
    const db = createDb()
    const { page } = createPageFixture(db)
    const server = createServer(db)

    const response = await server.inject({
      method: 'POST',
      url: `/api/pages/${page.id}/dialogues`,
      payload: { x: 0.2, y: 0.8, text: '手动新增的对白', bubbleStyle: 'thought' },
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({ x: 0.2, y: 0.8, text: '手动新增的对白', bubbleStyle: 'thought' })
  })

  it('rejects creation when the page does not exist', async () => {
    const db = createDb()
    const server = createServer(db)

    const response = await server.inject({
      method: 'POST',
      url: '/api/pages/missing-page/dialogues',
      payload: {},
    })

    expect(response.statusCode).not.toBe(200)
    expect(db.listModelCapabilities()).toEqual([])
  })

  it('rejects out-of-range coordinates', async () => {
    const db = createDb()
    const { page } = createPageFixture(db)
    const server = createServer(db)

    const response = await server.inject({
      method: 'POST',
      url: `/api/pages/${page.id}/dialogues`,
      payload: { x: 1.5 },
    })

    expect(response.statusCode).not.toBe(200)
  })

  it('deletes a dialogue and rejects repeat deletion', async () => {
    const db = createDb()
    const { project, page } = createPageFixture(db)
    const server = createServer(db)

    const created = await server.inject({
      method: 'POST',
      url: `/api/pages/${page.id}/dialogues`,
      payload: {},
    })
    const dialogueId = (created.json() as { id: string }).id

    const deleted = await server.inject({ method: 'DELETE', url: `/api/dialogues/${dialogueId}` })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ ok: true })
    expect(db.getProjectDetail(project.id).dialogues).toHaveLength(0)

    const repeat = await server.inject({ method: 'DELETE', url: `/api/dialogues/${dialogueId}` })
    expect(repeat.statusCode).not.toBe(200)
  })

  it('keeps patch and layout routes working after the extraction from index.ts', async () => {
    const db = createDb()
    const { page } = createPageFixture(db)
    const server = createServer(db)

    const created = await server.inject({
      method: 'POST',
      url: `/api/pages/${page.id}/dialogues`,
      payload: { text: '初始文本' },
    })
    const dialogueId = (created.json() as { id: string }).id

    const patched = await server.inject({
      method: 'PATCH',
      url: `/api/dialogues/${dialogueId}`,
      payload: { text: '修改后的文本' },
    })
    expect(patched.statusCode).toBe(200)
    expect((patched.json() as { text: string }).text).toBe('修改后的文本')

    const layout = await server.inject({
      method: 'PATCH',
      url: `/api/pages/${page.id}/layout`,
      payload: { dialogues: [{ id: dialogueId, x: 0.31, y: 0.62 }] },
    })
    expect(layout.statusCode).toBe(200)
    expect((layout.json() as { dialogues: Array<{ x: number; y: number }> }).dialogues[0]).toMatchObject({
      x: 0.31,
      y: 0.62,
    })
  })
})
