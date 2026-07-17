import { useState } from 'react'
import type { Dialogue, PageStatus, ProjectDetail, StoryBible } from '../shared/types'
import * as api from '../api'

interface DialogueHistoryCommand {
  scope: 'dialogues'
  pageId: string
  before: Dialogue[]
  beforeStatus: PageStatus
  after: Dialogue[]
  afterStatus: PageStatus
}

interface BibleHistoryCommand {
  scope: 'bible'
  projectId: string
  before: StoryBible
  after: StoryBible
}

export type HistoryCommand = DialogueHistoryCommand | BibleHistoryCommand

const HISTORY_LIMIT = 50

/** Raw model output is debug-only and can be huge; history snapshots drop it. */
function stripRawFromDialogues(dialogues: Dialogue[]): Dialogue[] {
  // `undefined` keeps the Dialogue type and disappears in the JSON restore payload.
  return dialogues.map((dialogue) => ({ ...dialogue, raw: undefined }))
}

export function pageSnapshot(
  source: ProjectDetail | null,
  pageId: string,
): { dialogues: Dialogue[]; status: PageStatus } | null {
  const page = source?.pages.find((item) => item.id === pageId)
  if (!source || !page) {
    return null
  }
  return {
    dialogues: stripRawFromDialogues(source.dialogues.filter((dialogue) => dialogue.pageId === pageId)),
    status: page.status,
  }
}

interface HistoryDeps {
  busy: string
  labels: { undoing: string; undone: string; redoing: string; redone: string }
  runTask: (label: string, task: () => Promise<void>) => Promise<void>
  pushLog: (message: string, level?: 'info' | 'success' | 'error', options?: { toast?: boolean }) => void
  acceptDetail: (next: ProjectDetail) => void
}

/**
 * Undo/redo command stacks for dialogue and Story Bible edits. Restores go
 * through the server (restorePageDialogues / saveStoryBible) so ids survive.
 */
export function useStudioHistory(deps: HistoryDeps) {
  const [undoStack, setUndoStack] = useState<HistoryCommand[]>([])
  const [redoStack, setRedoStack] = useState<HistoryCommand[]>([])

  function recordHistory(command: HistoryCommand) {
    setUndoStack((current) => [...current, command].slice(-HISTORY_LIMIT))
    setRedoStack([])
  }

  function clearHistory() {
    setUndoStack([])
    setRedoStack([])
  }

  function recordDialogueChange(
    pageId: string,
    before: { dialogues: Dialogue[]; status: PageStatus } | null,
    after: { dialogues: Dialogue[]; status: PageStatus } | null,
  ) {
    if (!before || !after) return
    recordHistory({
      scope: 'dialogues',
      pageId,
      before: before.dialogues,
      beforeStatus: before.status,
      after: after.dialogues,
      afterStatus: after.status,
    })
  }

  function applyHistoryState(command: HistoryCommand, side: 'before' | 'after'): Promise<ProjectDetail> {
    if (command.scope === 'dialogues') {
      return api.restorePageDialogues(
        command.pageId,
        side === 'before' ? command.before : command.after,
        side === 'before' ? command.beforeStatus : command.afterStatus,
      )
    }
    return api.saveStoryBible(command.projectId, side === 'before' ? command.before : command.after)
  }

  async function handleUndo() {
    const command = undoStack[undoStack.length - 1]
    if (!command || deps.busy) return
    await deps.runTask(deps.labels.undoing, async () => {
      deps.acceptDetail(await applyHistoryState(command, 'before'))
      setUndoStack((current) => current.slice(0, -1))
      setRedoStack((current) => [...current, command].slice(-HISTORY_LIMIT))
      deps.pushLog(deps.labels.undone, 'success', { toast: false })
    })
  }

  async function handleRedo() {
    const command = redoStack[redoStack.length - 1]
    if (!command || deps.busy) return
    await deps.runTask(deps.labels.redoing, async () => {
      deps.acceptDetail(await applyHistoryState(command, 'after'))
      setRedoStack((current) => current.slice(0, -1))
      setUndoStack((current) => [...current, command].slice(-HISTORY_LIMIT))
      deps.pushLog(deps.labels.redone, 'success', { toast: false })
    })
  }

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    recordHistory,
    recordDialogueChange,
    clearHistory,
    handleUndo,
    handleRedo,
  }
}
