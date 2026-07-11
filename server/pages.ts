import type { FastifyInstance } from 'fastify'
import { pageMoveSchema } from '../src/shared/schemas'
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
}
