import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type {
  Dialogue,
  FontAsset,
  JobEvent,
  Page,
  PageStatus,
  Project,
  ProjectDetail,
  ReadingDirection,
  SecretStatus,
  StoryBible,
} from './shared/types'
import { resolveDialogueCollisions } from './shared/layout'
import { renderPageToDataUrl, renderProjectPages } from './canvasExport'
import { registerCustomFont } from './fonts'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import type { MessageParams } from './i18n/types'
import { cryptoId, clampNumber } from './uiUtils'
import { useToast } from './toastContext'
import * as api from './api'

export type InspectorTab = 'story' | 'characters' | 'dialogue' | 'layout' | 'settings'
export type EntryMode = 'studio' | 'continue'
export type LogLevel = 'info' | 'success' | 'error'
type Translator = (key: MessageKey, params?: MessageParams) => string

export interface BatchProgress {
  current: number
  total: number
}

export interface LogEntry {
  id: string
  time: string
  level: LogLevel
  message: string
}

export interface RawOutputState {
  title: string
  text: string
}

export interface SettingsForm {
  apiBaseUrl: string
  modelName: string
  apiKey: string
  pixivCookie: string
}

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

type HistoryCommand = DialogueHistoryCommand | BibleHistoryCommand

const HISTORY_LIMIT = 50

/** Raw model output is debug-only and can be huge; history snapshots drop it. */
function stripRawFromDialogues(dialogues: Dialogue[]): Dialogue[] {
  // `undefined` keeps the Dialogue type and disappears in the JSON restore payload.
  return dialogues.map((dialogue) => ({ ...dialogue, raw: undefined }))
}

function pageSnapshot(
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

/** Container hook: owns all Manga Studio state and handlers; App.tsx stays a view shell. */
export function useStudio() {
  const { t } = useI18n()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [selectedDialogueId, setSelectedDialogueId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<InspectorTab>('story')
  const [busy, setBusy] = useState<string>('')
  const [currentJobId, setCurrentJobId] = useState<string>('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [rawOutput, setRawOutput] = useState<RawOutputState | null>(null)
  const [entryMode, setEntryMode] = useState<EntryMode>('studio')
  const [createTitle, setCreateTitle] = useState(() => t('studio.untitledManga'))
  const [createMode, setCreateMode] = useState<'story' | 'translation'>('story')
  const [pixivUrl, setPixivUrl] = useState('')
  const [userBrief, setUserBrief] = useState('')
  const [r18Enabled, setR18Enabled] = useState(false)
  const [generateMode, setGenerateMode] = useState<'story' | 'translation'>('story')
  const [textDensity, setTextDensity] = useState(0.65)
  const [rangeFromInput, setRangeFromInput] = useState('1')
  const [rangeToInput, setRangeToInput] = useState('')
  const [zoom, setZoom] = useState(1)
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null)
  const [providers, setProviders] = useState<api.ProviderProfile[]>([])
  const [customFonts, setCustomFonts] = useState<FontAsset[]>([])
  const [hasExported, setHasExported] = useState(false)
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [undoStack, setUndoStack] = useState<HistoryCommand[]>([])
  const [redoStack, setRedoStack] = useState<HistoryCommand[]>([])
  // Last server-confirmed detail: history snapshots diff against this, never against
  // in-flight local edits (typing updates `detail` before the commit lands).
  const serverDetailRef = useRef<ProjectDetail | null>(null)
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    apiBaseUrl: '',
    modelName: '',
    apiKey: '',
    pixivCookie: '',
  })

  const assetsById = useMemo(() => new Map(detail?.assets.map((asset) => [asset.id, asset]) || []), [detail])
  const activePage = useMemo(
    () => detail?.pages.find((page) => page.id === selectedPageId) || detail?.pages[0],
    [detail, selectedPageId],
  )
  const activeAsset = activePage ? assetsById.get(activePage.originalAssetId) : undefined
  const activeDialogues = useMemo(
    () => (activePage && detail ? detail.dialogues.filter((dialogue) => dialogue.pageId === activePage.id) : []),
    [activePage, detail],
  )
  const selectedDialogue =
    activeDialogues.find((dialogue) => dialogue.id === selectedDialogueId) || activeDialogues[0]

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const [projectList, status, providerList, fontList] = await Promise.all([
          api.listProjects(),
          api.getSecretStatus(),
          // Provider profiles only feed the onboarding hints; their failure must not block boot.
          api.listProviders().catch(() => [] as api.ProviderProfile[]),
          api.listFonts().catch(() => [] as FontAsset[]),
        ])
        if (cancelled) return
        setProjects(projectList)
        setSecretStatus(status)
        setProviders(providerList)
        setCustomFonts(fontList)
        void Promise.all(fontList.map(registerCustomFont))
        setSettingsForm((current) => ({
          ...current,
          apiBaseUrl: status.apiBaseUrl,
          modelName: status.modelName,
        }))
        if (projectList[0]) {
          setSelectedProjectId(projectList[0].id)
        }
        pushLog(t('log.studioReady'), 'success')
      } catch (error) {
        pushLog(describeError(error), 'error')
      }
    }

    boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot runs once; log locale is captured at startup
  }, [])

  useEffect(() => {
    if (!selectedProjectId) return
    let cancelled = false
    // History commands reference dialogue/page ids of one project; a switch invalidates them.
    clearHistory()

    api
      .getProject(selectedProjectId)
      .then((next) => {
        if (cancelled) return
        setDetail(next)
        serverDetailRef.current = next
        setGenerateMode(next.project.mode)
        setSelectedPageId((current) => (next.pages.some((page) => page.id === current) ? current : next.pages[0]?.id || ''))
      })
      .catch((error) => pushLog(describeError(error), 'error'))
      .finally(() => {
        if (!cancelled) {
          setBusy('')
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the selected project changes
  }, [selectedProjectId])

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo — skipped while typing in a field.
  // No dependency array: re-registering each render keeps the handler closures fresh.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        void handleUndo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        void handleRedo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : t('log.unknownError')
  }

  function pushLog(message: string, level: LogLevel = 'info', options?: { toast?: boolean }) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs((current) => [{ id: cryptoId(), time, level, message }, ...current].slice(0, 80))
    // Errors always surface as toasts; successes do too unless the caller opts out
    // (blur-triggered auto-saves and edits already visible on canvas stay log-only).
    if (level === 'error' || (level === 'success' && options?.toast !== false)) {
      toast.pushToast(message, level)
    }
  }

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

  function acceptDetail(next: ProjectDetail) {
    serverDetailRef.current = next
    setDetail(next)
    setProjects((current) => {
      const updated = current.some((project) => project.id === next.project.id)
        ? current.map((project) => (project.id === next.project.id ? next.project : project))
        : [next.project, ...current]
      return updated
    })
    setSelectedProjectId(next.project.id)
    setSelectedPageId((current) => (next.pages.some((page) => page.id === current) ? current : next.pages[0]?.id || ''))
    setGenerateMode(next.project.mode)
  }

  async function runTask(label: string, task: () => Promise<void>) {
    if (busy) return
    setCurrentJobId('')
    setBusy(label)
    pushLog(label)
    try {
      await task()
    } catch (error) {
      const message = describeError(error)
      const raw = rawOutputFromError(error, t)
      if (raw) {
        setRawOutput(raw)
      }
      // 'Job cancelled' is the API sentinel thrown by cancelled jobs, not a display string.
      pushLog(message === 'Job cancelled' ? t('log.jobCancelled') : message, message === 'Job cancelled' ? 'info' : 'error')
    } finally {
      setCurrentJobId('')
      setBusy('')
    }
  }

  function handleJobEvent(event: JobEvent) {
    if (event.type === 'queued' || event.type === 'progress') {
      pushLog(event.message)
    }
  }

  function updateDialogueLocal(id: string, patch: Partial<Dialogue>) {
    setDetail((current) =>
      current
        ? {
            ...current,
            dialogues: current.dialogues.map((dialogue) => (dialogue.id === id ? { ...dialogue, ...patch } : dialogue)),
          }
        : current,
    )
  }

  function updateStoryBibleLocal(storyBible: StoryBible) {
    setDetail((current) =>
      current
        ? {
            ...current,
            project: { ...current.project, storyBible },
            characters: storyBible.characters,
          }
        : current,
    )
  }

  async function commitStoryBible(storyBible: StoryBible) {
    if (!detail) return
    updateStoryBibleLocal(storyBible)
    try {
      const beforeBible = serverDetailRef.current?.project.storyBible
      const next = await api.saveStoryBible(detail.project.id, storyBible)
      acceptDetail(next)
      if (beforeBible && next.project.storyBible) {
        recordHistory({ scope: 'bible', projectId: next.project.id, before: beforeBible, after: next.project.storyBible })
      }
      pushLog(t('log.storyBibleSaved'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
      acceptDetail(await api.getProject(detail.project.id))
    }
  }

  async function commitDialogue(id: string, patch: Partial<Dialogue>) {
    updateDialogueLocal(id, patch)
    try {
      const baseline = serverDetailRef.current
      const target = baseline?.dialogues.find((dialogue) => dialogue.id === id)
      const before = target ? pageSnapshot(baseline, target.pageId) : null
      const updated = await api.patchDialogue(id, patch)
      updateDialogueLocal(id, updated)
      if (baseline && target) {
        const nextBaseline = {
          ...baseline,
          dialogues: baseline.dialogues.map((dialogue) => (dialogue.id === id ? { ...dialogue, ...updated } : dialogue)),
        }
        serverDetailRef.current = nextBaseline
        recordDialogueChange(target.pageId, before, pageSnapshot(nextBaseline, target.pageId))
      }
      pushLog(t('log.dialogueSaved'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
      if (detail) {
        acceptDetail(await api.getProject(detail.project.id))
      }
    }
  }

  async function handleAddDialogue(position?: { x: number; y: number }) {
    if (!activePage) return
    try {
      const baseline = serverDetailRef.current
      const before = pageSnapshot(baseline, activePage.id)
      const created = await api.createDialogue(activePage.id, position)
      setDetail((current) => (current ? { ...current, dialogues: [...current.dialogues, created] } : current))
      if (baseline) {
        const nextBaseline = { ...baseline, dialogues: [...baseline.dialogues, created] }
        serverDetailRef.current = nextBaseline
        recordDialogueChange(activePage.id, before, pageSnapshot(nextBaseline, activePage.id))
      }
      setSelectedDialogueId(created.id)
      setActiveTab('dialogue')
      pushLog(t('log.dialogueAdded'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
    }
  }

  async function handleDeleteDialogue(id: string) {
    try {
      const baseline = serverDetailRef.current
      const target = baseline?.dialogues.find((dialogue) => dialogue.id === id)
      const before = target ? pageSnapshot(baseline, target.pageId) : null
      await api.deleteDialogue(id)
      setDetail((current) =>
        current ? { ...current, dialogues: current.dialogues.filter((dialogue) => dialogue.id !== id) } : current,
      )
      if (baseline && target) {
        const nextBaseline = { ...baseline, dialogues: baseline.dialogues.filter((dialogue) => dialogue.id !== id) }
        serverDetailRef.current = nextBaseline
        recordDialogueChange(target.pageId, before, pageSnapshot(nextBaseline, target.pageId))
      }
      setSelectedDialogueId((current) => (current === id ? '' : current))
      pushLog(t('log.dialogueDeleted'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
    }
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    await runTask(t('log.creatingProject'), async () => {
      const next = await api.createProject({ title: createTitle.trim() || t('studio.untitledManga'), mode: createMode })
      acceptDetail(next)
      pushLog(t('log.projectCreated'), 'success')
    })
  }

  /** Shared import path for the file picker and canvas drag-and-drop. */
  async function importLocalFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) return

    await runTask(t('log.importingLocal'), async () => {
      const next = await api.importLocal(images, detail?.project.id)
      acceptDetail(next)
      pushLog(t('log.imagesImported', { count: images.length }), 'success')
    })
  }

  async function handleLocalFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    await importLocalFiles(files)
  }

  async function handleBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    await runTask(t('log.restoringBackup'), async () => {
      const next = await api.importProjectBackup(file)
      acceptDetail(next)
      pushLog(t('log.backupRestored', { title: next.project.title }), 'success')
    })
  }

  async function handlePixivImport(event: FormEvent) {
    event.preventDefault()
    if (!pixivUrl.trim()) {
      pushLog(t('log.pixivUrlRequired'), 'error')
      return
    }

    await runTask(t('log.importingPixiv'), async () => {
      const next = await api.importPixiv({
        projectId: detail?.project.id,
        url: pixivUrl.trim(),
        r18Enabled,
      })
      acceptDetail(next)
      setPixivUrl('')
      pushLog(t('log.pixivImported'), 'success')
    })
  }

  async function handleAnalyzeStory() {
    if (!detail) return
    await runTask(t('toolbar.analyzeStory'), async () => {
      const beforeBible = serverDetailRef.current?.project.storyBible
      const next = await api.analyzeStory(
        { projectId: detail.project.id, userBrief, r18Enabled },
        { onJobId: setCurrentJobId, onEvent: handleJobEvent },
      )
      acceptDetail(next)
      if (beforeBible && next.project.storyBible) {
        recordHistory({ scope: 'bible', projectId: next.project.id, before: beforeBible, after: next.project.storyBible })
      }
      if (next.raw) {
        setRawOutput({ title: t('raw.storyBibleTitle'), text: next.raw })
      }
      pushLog(next.usedMock ? t('log.storyBibleMock') : t('log.storyBibleGenerated'), 'success')
    })
  }

  async function handleGenerateActivePage() {
    if (!activePage) return
    await runTask(t('log.generatePageLabel', { n: activePage.index + 1 }), async () => {
      const before = pageSnapshot(serverDetailRef.current, activePage.id)
      const next = await api.generatePage(activePage.id, { mode: generateMode, textDensity }, { onJobId: setCurrentJobId, onEvent: handleJobEvent })
      acceptDetail(next)
      recordDialogueChange(activePage.id, before, pageSnapshot(next, activePage.id))
      if (next.raw) {
        setRawOutput({ title: t('raw.pageTitle', { n: activePage.index + 1 }), text: next.raw })
      }
      pushLog(t('log.pageDialogueGenerated', { n: activePage.index + 1 }), 'success')
    })
  }

  async function runGenerateBatch(label: string, pages: Page[], messages: { allComplete: string; done: string }) {
    await runTask(label, async () => {
      // Completed pages may hold hand-edited dialogue; bulk generation must not overwrite them.
      const pendingPages = pages.filter((page) => page.status !== 'complete')
      const skippedCount = pages.length - pendingPages.length
      if (!pendingPages.length) {
        pushLog(messages.allComplete)
        return
      }
      setBatchProgress({ current: 0, total: pendingPages.length })
      try {
        for (const page of pendingPages) {
          pushLog(t('log.generatingPage', { n: page.index + 1 }))
          const before = pageSnapshot(serverDetailRef.current, page.id)
          const next = await api.generatePage(page.id, { mode: generateMode, textDensity }, { onJobId: setCurrentJobId, onEvent: handleJobEvent })
          acceptDetail(next)
          recordDialogueChange(page.id, before, pageSnapshot(next, page.id))
          if (next.raw) {
            setRawOutput({ title: t('raw.pageTitle', { n: page.index + 1 }), text: next.raw })
          }
          setBatchProgress((current) => (current ? { ...current, current: current.current + 1 } : current))
        }
        if (skippedCount > 0) {
          pushLog(t('log.skippedCompletedPages', { count: skippedCount }))
        }
        pushLog(messages.done, 'success')
      } finally {
        setBatchProgress(null)
      }
    })
  }

  async function handleGenerateAll() {
    if (!detail) return
    await runGenerateBatch(t('toolbar.generateAll'), detail.pages, {
      allComplete: t('log.allPagesAlreadyComplete'),
      done: t('log.allPagesGenerated'),
    })
  }

  async function handleGenerateRange() {
    if (!detail || !detail.pages.length) return
    const pageCount = detail.pages.length
    const from = clampNumber(Math.round(Number(rangeFromInput) || 1), 1, pageCount)
    const to = rangeToInput.trim() === '' ? pageCount : clampNumber(Math.round(Number(rangeToInput) || pageCount), 1, pageCount)
    if (from > to) {
      pushLog(t('log.invalidPageRange'), 'error')
      return
    }
    const rangePages = detail.pages.filter((page) => page.index + 1 >= from && page.index + 1 <= to)
    await runGenerateBatch(t('log.generateRangeLabel', { from, to }), rangePages, {
      allComplete: t('log.rangeAlreadyComplete'),
      done: t('log.rangeGenerated', { from, to }),
    })
  }

  async function handleCancelCurrentJob() {
    if (!currentJobId) return
    try {
      await api.cancelJob(currentJobId)
      pushLog(t('log.cancellationRequested'))
    } catch (error) {
      pushLog(describeError(error), 'error')
    }
  }

  async function handleAvoidOverlap() {
    if (!activePage || !activeDialogues.length) return
    await runTask(t('log.resolvingLayout'), async () => {
      const baseline = serverDetailRef.current
      const before = pageSnapshot(baseline, activePage.id)
      const resolved = resolveDialogueCollisions(activeDialogues)
      const result = await api.patchPageLayout(
        activePage.id,
        resolved.map(({ id, x, y, scale, rotation, bubbleStyle, color, locked, text }) => ({
          id,
          x,
          y,
          scale,
          rotation,
          bubbleStyle,
          color,
          locked,
          text,
        })),
      )
      setDetail((current) =>
        current
          ? {
              ...current,
              dialogues: current.dialogues.map((dialogue) => result.dialogues.find((item) => item.id === dialogue.id) || dialogue),
            }
          : current,
      )
      if (baseline) {
        const nextBaseline = {
          ...baseline,
          dialogues: baseline.dialogues.map((dialogue) => result.dialogues.find((item) => item.id === dialogue.id) || dialogue),
        }
        serverDetailRef.current = nextBaseline
        recordDialogueChange(activePage.id, before, pageSnapshot(nextBaseline, activePage.id))
      }
      pushLog(t('log.layoutAdjusted'), 'success', { toast: false })
    })
  }

  async function handleUndo() {
    const command = undoStack[undoStack.length - 1]
    if (!command || busy) return
    await runTask(t('log.undoing'), async () => {
      acceptDetail(await applyHistoryState(command, 'before'))
      setUndoStack((current) => current.slice(0, -1))
      setRedoStack((current) => [...current, command].slice(-HISTORY_LIMIT))
      pushLog(t('log.undone'), 'success', { toast: false })
    })
  }

  async function handleRedo() {
    const command = redoStack[redoStack.length - 1]
    if (!command || busy) return
    await runTask(t('log.redoing'), async () => {
      acceptDetail(await applyHistoryState(command, 'after'))
      setRedoStack((current) => current.slice(0, -1))
      setUndoStack((current) => [...current, command].slice(-HISTORY_LIMIT))
      pushLog(t('log.redone'), 'success', { toast: false })
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

  async function handleMovePage(pageId: string, offset: -1 | 1) {
    await runTask(t('log.movingPage'), async () => {
      const next = await api.movePage(pageId, offset)
      acceptDetail(next)
      // Page indexes shifted under the recorded snapshots; stale history must not restore them.
      clearHistory()
      pushLog(t('log.pageMoved'), 'success', { toast: false })
    })
  }

  async function handleDeletePage(pageId: string) {
    const page = detail?.pages.find((item) => item.id === pageId)
    if (!page) return
    const confirmed = await toast.confirm({
      title: t('confirm.deletePageTitle'),
      message: t('confirm.deletePageMessage', { n: page.index + 1 }),
      confirmLabel: t('confirm.delete'),
      cancelLabel: t('confirm.cancel'),
      danger: true,
    })
    if (!confirmed) return
    await runTask(t('log.deletingPage', { n: page.index + 1 }), async () => {
      const next = await api.deletePage(pageId)
      acceptDetail(next)
      clearHistory()
      pushLog(t('log.pageDeleted'), 'success')
    })
  }

  async function handleExportActivePage() {
    if (!detail || !activePage) return
    const pageNumber = activePage.index + 1
    await runTask(t('log.exportPageLabel', { n: pageNumber }), async () => {
      const dataUrl = await renderPageToDataUrl(detail, activePage.id)
      if (!dataUrl) {
        throw new Error(t('log.noPagesToExport'))
      }
      const anchor = document.createElement('a')
      anchor.href = dataUrl
      anchor.download = `${sanitizeFileName(detail.project.title)}-page-${String(pageNumber).padStart(3, '0')}.png`
      anchor.click()
      setHasExported(true)
      pushLog(t('log.pageExported', { n: pageNumber }), 'success')
    })
  }

  async function handleUploadFont(file: File) {
    await runTask(t('log.uploadingFont'), async () => {
      const font = await api.uploadFont(file)
      setCustomFonts((current) => [...current, font])
      await registerCustomFont(font)
      pushLog(t('log.fontUploaded', { name: font.familyName }), 'success')
    })
  }

  async function handleDeleteCustomFont(id: string) {
    await runTask(t('log.deletingFont'), async () => {
      await api.deleteCustomFont(id)
      setCustomFonts((current) => current.filter((font) => font.id !== id))
      pushLog(t('log.fontDeleted'), 'success')
    })
  }

  async function exportRenderedArchive(format: 'zip' | 'cbz', taskLabel: string) {
    if (!detail) return
    await runTask(taskLabel, async () => {
      const pages = await renderProjectPages(detail)
      if (!pages.length) {
        throw new Error(t('log.noPagesToExport'))
      }
      const result = await api.exportZip({ projectId: detail.project.id, format, pages })
      setHasExported(true)
      pushLog(t('log.exported', { file: result.fileName }), 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  async function handleExportZip() {
    await exportRenderedArchive('zip', t('toolbar.exportZip'))
  }

  async function handleExportCbz() {
    await exportRenderedArchive('cbz', t('toolbar.exportCbz'))
  }

  async function handleSetReadingDirection(readingDirection: ReadingDirection) {
    if (!detail || detail.project.readingDirection === readingDirection) return
    await runTask(t('log.savingDirection'), async () => {
      const next = await api.updateProjectSettings(detail.project.id, { readingDirection })
      acceptDetail(next)
      pushLog(t('log.readingDirectionSaved'), 'success', { toast: false })
    })
  }

  async function handleExportBackup() {
    if (!detail) return
    await runTask(t('log.exportBackupTask'), async () => {
      const result = await api.exportProjectBackup({ projectId: detail.project.id })
      pushLog(t('log.backupExported', { file: result.fileName }), 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault()
    await runTask(t('log.savingSettings'), async () => {
      const status = await api.saveSecrets({
        apiBaseUrl: settingsForm.apiBaseUrl,
        modelName: settingsForm.modelName,
        apiKey: settingsForm.apiKey,
        pixivCookie: settingsForm.pixivCookie,
      })
      setSecretStatus(status)
      setSettingsForm((current) => ({ ...current, apiKey: '', pixivCookie: '' }))
      pushLog(t('log.settingsSaved'), 'success')
    })
  }

  return {
    // refs
    fileInputRef,
    backupInputRef,
    // state
    projects,
    detail,
    selectedProjectId,
    setSelectedProjectId,
    setSelectedPageId,
    selectedDialogueId,
    setSelectedDialogueId,
    activeTab,
    setActiveTab,
    busy,
    currentJobId,
    logs,
    rawOutput,
    entryMode,
    setEntryMode,
    createTitle,
    setCreateTitle,
    createMode,
    setCreateMode,
    pixivUrl,
    setPixivUrl,
    userBrief,
    setUserBrief,
    r18Enabled,
    setR18Enabled,
    generateMode,
    setGenerateMode,
    textDensity,
    setTextDensity,
    rangeFromInput,
    setRangeFromInput,
    rangeToInput,
    setRangeToInput,
    zoom,
    setZoom,
    secretStatus,
    providers,
    setProviders,
    customFonts,
    hasExported,
    batchProgress,
    settingsForm,
    setSettingsForm,
    // derived
    assetsById,
    activePage,
    activeAsset,
    activeDialogues,
    selectedDialogue,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    // actions
    runTask,
    pushLog,
    updateDialogueLocal,
    updateStoryBibleLocal,
    commitStoryBible,
    commitDialogue,
    handleAddDialogue,
    handleDeleteDialogue,
    handleCreateProject,
    handleLocalFiles,
    importLocalFiles,
    handleBackupFile,
    handlePixivImport,
    handleAnalyzeStory,
    handleGenerateActivePage,
    handleGenerateAll,
    handleGenerateRange,
    handleCancelCurrentJob,
    handleAvoidOverlap,
    handleUndo,
    handleRedo,
    handleMovePage,
    handleDeletePage,
    handleExportZip,
    handleExportCbz,
    handleExportActivePage,
    handleExportBackup,
    handleSetReadingDirection,
    handleSaveSettings,
    handleUploadFont,
    handleDeleteCustomFont,
  }
}

function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'manga'
}

function rawOutputFromError(error: unknown, t: Translator): RawOutputState | null {
  if (!(error instanceof api.JobFailedError)) {
    return null
  }
  const payload = error.payload
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as { raw?: unknown; repairedRaw?: unknown; schemaHint?: unknown }
  const sections = []
  if (typeof record.raw === 'string' && record.raw) {
    sections.push(`${t('raw.original')}\n${record.raw}`)
  }
  if (typeof record.repairedRaw === 'string' && record.repairedRaw) {
    sections.push(`${t('raw.repair')}\n${record.repairedRaw}`)
  }
  if (typeof record.schemaHint === 'string' && record.schemaHint) {
    sections.push(`${t('raw.schema')}\n${record.schemaHint}`)
  }
  return sections.length ? { title: t('raw.aiTitle'), text: sections.join('\n\n') } : null
}
