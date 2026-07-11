import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoryBible } from '../src/shared/types'
import { StudioDatabase } from '../server/database'
import { registerDialogueRoutes } from '../server/dialogues'
import { registerPageRoutes } from '../server/pages'

function createDb(): StudioDatabase {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-pages-test-'))
  process.env.PTM_DATA_DIR = dataDir
  return new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
}

function createProjectWithPages(db: StudioDatabase, count = 3) {
  const project = db.createProject({ title: 'Pages Project', mode: 'story', source: 'local' })
  const pages = Array.from({ length: count }, (_, index) => {
    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath: path.join('projects', project.id, 'originals', `page-${index + 1}.svg`),
      mimeType: 'image/svg+xml',
    })
    return db.createPage({ projectId: project.id, index, originalAssetId: asset.id })
  })
  return { project, pages }
}

function bibleWithBeats(projectId: string, summaries: string[]): StoryBible {
  return {
    synopsis: '测试故事。',
    tone: '轻松',
    characters: [
      {
        id: 'char-1',
        projectId,
        name: '夏海',
        description: '',
        voice: '',
        color: '#c9282d',
        bubbleStyle: 'speech',
      },
    ],
    pageBeats: summaries.map((summary, pageIndex) => ({ pageIndex, summary, intent: 'i' })),
    r18Enabled: false,
  }
}

function sampleDialogue(pageId: string, id: string, text: string) {
  return {
    id,
    pageId,
    text,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    bubbleStyle: 'speech' as const,
    color: '#141414',
    locked: false,
  }
}

function createServer(db: StudioDatabase): FastifyInstance {
  const server = fastify()
  registerPageRoutes(server, { db })
  registerDialogueRoutes(server, { db })
  return server
}

afterEach(() => {
  delete process.env.PTM_DATA_DIR
})

describe('page reorder and delete', () => {
  it('moves a page and swaps its story-bible beat with the neighbor', () => {
    const db = createDb()
    const { project, pages } = createProjectWithPages(db)
    db.saveStoryBible(project.id, bibleWithBeats(project.id, ['beat-0', 'beat-1', 'beat-2']))

    db.movePage(pages[1].id, -1)

    const detail = db.getProjectDetail(project.id)
    expect(detail.pages.map((page) => page.id)).toEqual([pages[1].id, pages[0].id, pages[2].id])
    expect(detail.pages.map((page) => page.index)).toEqual([0, 1, 2])
    const beats = detail.project.storyBible!.pageBeats
    expect(beats.find((beat) => beat.pageIndex === 0)!.summary).toBe('beat-1')
    expect(beats.find((beat) => beat.pageIndex === 1)!.summary).toBe('beat-0')
    expect(beats.find((beat) => beat.pageIndex === 2)!.summary).toBe('beat-2')
  })

  it('is a no-op at the edges', () => {
    const db = createDb()
    const { project, pages } = createProjectWithPages(db)

    db.movePage(pages[0].id, -1)
    db.movePage(pages[2].id, 1)

    expect(db.getProjectDetail(project.id).pages.map((page) => page.id)).toEqual(pages.map((page) => page.id))
  })

  it('deletes a page, drops its dialogues, reindexes, and shifts beats down', () => {
    const db = createDb()
    const { project, pages } = createProjectWithPages(db)
    db.saveStoryBible(project.id, bibleWithBeats(project.id, ['beat-0', 'beat-1', 'beat-2']))
    db.createDialogue(pages[1].id, sampleDialogue(pages[1].id, 'd-1', '要删除的对白'))

    db.deletePage(pages[1].id)

    const detail = db.getProjectDetail(project.id)
    expect(detail.pages.map((page) => page.id)).toEqual([pages[0].id, pages[2].id])
    expect(detail.pages.map((page) => page.index)).toEqual([0, 1])
    expect(detail.dialogues).toHaveLength(0)
    const beats = detail.project.storyBible!.pageBeats
    expect(beats).toHaveLength(2)
    expect(beats.find((beat) => beat.pageIndex === 0)!.summary).toBe('beat-0')
    expect(beats.find((beat) => beat.pageIndex === 1)!.summary).toBe('beat-2')
  })

  it('keeps a stale bible instead of storing an empty beat list', () => {
    const db = createDb()
    const { project, pages } = createProjectWithPages(db, 1)
    db.saveStoryBible(project.id, bibleWithBeats(project.id, ['only-beat']))

    db.deletePage(pages[0].id)

    const detail = db.getProjectDetail(project.id)
    expect(detail.pages).toHaveLength(0)
    // storyBibleSchema requires >=1 beat, so the last beat stays rather than persisting [].
    expect(detail.project.storyBible!.pageBeats).toHaveLength(1)
  })

  it('serves move and delete over routes returning refreshed project detail', async () => {
    const db = createDb()
    const { pages } = createProjectWithPages(db, 2)
    const server = createServer(db)

    const moved = await server.inject({
      method: 'POST',
      url: `/api/pages/${pages[0].id}/move`,
      payload: { offset: 1 },
    })
    expect(moved.statusCode).toBe(200)
    expect((moved.json() as { pages: Array<{ id: string }> }).pages.map((page) => page.id)).toEqual([
      pages[1].id,
      pages[0].id,
    ])

    const deleted = await server.inject({ method: 'DELETE', url: `/api/pages/${pages[0].id}` })
    expect(deleted.statusCode).toBe(200)
    expect((deleted.json() as { pages: unknown[] }).pages).toHaveLength(1)

    const invalidOffset = await server.inject({
      method: 'POST',
      url: `/api/pages/${pages[1].id}/move`,
      payload: { offset: 2 },
    })
    expect(invalidOffset.statusCode).not.toBe(200)
  })
})

describe('dialogue restore route', () => {
  it('replaces the page dialogue list with preserved ids and restores the status', async () => {
    const db = createDb()
    const { project, pages } = createProjectWithPages(db, 1)
    const server = createServer(db)
    db.replaceDialogues(pages[0].id, [sampleDialogue(pages[0].id, 'old-1', '旧对白')])
    expect(db.getPage(pages[0].id).status).toBe('complete')

    const restored = await server.inject({
      method: 'PUT',
      url: `/api/pages/${pages[0].id}/dialogues`,
      payload: {
        dialogues: [sampleDialogue(pages[0].id, 'fixed-1', '恢复的对白')],
        status: 'ready',
      },
    })

    expect(restored.statusCode).toBe(200)
    const detail = db.getProjectDetail(project.id)
    expect(detail.dialogues).toHaveLength(1)
    expect(detail.dialogues[0].id).toBe('fixed-1')
    expect(detail.dialogues[0].text).toBe('恢复的对白')
    expect(db.getPage(pages[0].id).status).toBe('ready')
  })

  it('restores an empty list (undo of the first generation)', async () => {
    const db = createDb()
    const { project, pages } = createProjectWithPages(db, 1)
    const server = createServer(db)
    db.replaceDialogues(pages[0].id, [sampleDialogue(pages[0].id, 'old-1', '旧对白')])

    const restored = await server.inject({
      method: 'PUT',
      url: `/api/pages/${pages[0].id}/dialogues`,
      payload: { dialogues: [], status: 'ready' },
    })

    expect(restored.statusCode).toBe(200)
    expect(db.getProjectDetail(project.id).dialogues).toHaveLength(0)
    expect(db.getPage(pages[0].id).status).toBe('ready')
  })

  it('round-trips dialogue tail coordinates through create and update', () => {
    const db = createDb()
    const { pages } = createProjectWithPages(db, 1)

    const created = db.createDialogue(pages[0].id, {
      ...sampleDialogue(pages[0].id, 'tail-1', '带尾巴的对白'),
      tailX: 0.25,
      tailY: 0.75,
    })
    expect(created.tailX).toBeCloseTo(0.25, 5)
    expect(created.tailY).toBeCloseTo(0.75, 5)

    const updated = db.updateDialogue('tail-1', { tailX: 0.6, tailY: 0.1 })
    expect(updated.tailX).toBeCloseTo(0.6, 5)
    expect(updated.tailY).toBeCloseTo(0.1, 5)
  })
})
