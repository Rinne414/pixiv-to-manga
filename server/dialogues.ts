import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { dialogueCreateSchema, dialogueRestoreSchema, dialogueSchema, letteringDefaultsSchema } from '../src/shared/schemas'
import type { StudioDatabase } from './database'
import { findDialogueCharacter } from '../src/shared/characters'

export interface DialogueRoutesContext {
  db: StudioDatabase
}

/** Dialogue CRUD + page layout routes (extracted from server/index.ts). */
export function registerDialogueRoutes(server: FastifyInstance, context: DialogueRoutesContext): void {
  const { db } = context

  server.post('/api/pages/:pageId/dialogues', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const input = dialogueCreateSchema.parse(request.body ?? {})
    const page = db.getPage(pageId)
    const project = db.getProject(page.projectId)
    const defaults = project.letteringDefaults || letteringDefaultsSchema.parse({})
    const character = findDialogueCharacter(db.listCharacters(project.id), input)
    return db.createDialogue(page.id, {
      ...input,
      id: randomUUID(),
      pageId: page.id,
      scale: input.scale === 1 ? defaults.scale : input.scale,
      color: input.color === '#141414' ? character?.color || defaults.color : input.color,
      fontFamily: input.fontFamily || defaults.fontFamily,
    })
  })

  server.patch('/api/dialogues/:id', async (request) => {
    const { id } = request.params as { id: string }
    const patch = dialogueSchema.partial().parse(request.body)
    return db.updateDialogue(id, patch)
  })

  server.delete('/api/dialogues/:id', async (request) => {
    const { id } = request.params as { id: string }
    db.deleteDialogue(id)
    return { ok: true }
  })

  server.patch('/api/pages/:pageId/layout', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const items = (request.body as { dialogues?: unknown[] }).dialogues || []
    const updated = items.map((item) => {
      const parsed = dialogueSchema.partial().required({ id: true }).parse(item)
      return db.updateDialogue(parsed.id, parsed)
    })
    return { pageId, dialogues: updated }
  })

  // Undo/redo restore: replaces the page's whole dialogue list (ids preserved) and its status.
  server.put('/api/pages/:pageId/dialogues', async (request) => {
    const { pageId } = request.params as { pageId: string }
    const input = dialogueRestoreSchema.parse(request.body)
    const page = db.getPage(pageId)
    db.replaceDialogues(
      page.id,
      input.dialogues.map((dialogue) => ({ ...dialogue, id: dialogue.id || randomUUID(), pageId: page.id })),
      input.status ?? 'complete',
    )
    return db.getProjectDetail(page.projectId)
  })
}
