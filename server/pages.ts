import type { FastifyInstance } from 'fastify'
import { pageMoveSchema, updatePageCleanupSchema, updatePagePanelsSchema } from '../src/shared/schemas'
import type { StudioDatabase } from './database'

export interface PageRoutesContext {
  db: StudioDatabase
}

/** Page ordering and deletion routes. */
export function registerPageRoutes(server: FastifyInstance, context: PageRoutesContext): void {
  const { db } = context

  server.post('/api/pages/:pageId/move', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const input = pageMoveSchema.parse(request.body)
    const page = db.getPage(pageId)
    db.movePage(pageId, input.offset)
    return db.getProjectDetail(page.projectId)
  })

  server.delete('/api/pages/:pageId', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const page = db.getPage(pageId)
    db.deletePage(pageId)
    return db.getProjectDetail(page.projectId)
  })

  // Manual panel frames: array order encodes reading order for generation prompts.
  server.put('/api/pages/:pageId/panels', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const input = updatePagePanelsSchema.parse(request.body)
    const page = db.getPage(pageId)
    db.updatePagePanels(page.id, input.panels)
    return db.getProjectDetail(page.projectId)
  })

  server.put('/api/pages/:pageId/cleanup', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const input = updatePageCleanupSchema.parse(request.body)
    const page = db.getPage(pageId)
    db.updatePageCleanup(page.id, input.cleanupStrokes)
    return db.getProjectDetail(page.projectId)
  })
}
