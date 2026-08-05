import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type {
  CleanupStroke,
  Dialogue,
  FontAsset,
  JobEvent,
  LetteringDefaults,
  Page,
  PanelBox,
  Project,
  ProjectDetail,
  ReadingDirection,
  SecretStatus,
  StoryBible,
} from './shared/types'
import type { ConnectionMode } from './shared/types'
import { resolveDialogueCollisions } from './shared/layout'
import { registerCustomFont } from './fonts'
import { pageSnapshot, useStudioHistory } from './studio/useStudioHistory'
import { useStudioExports } from './studio/useStudioExports'
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

/** Container hook: owns all Manga Studio state and handlers; App.tsx stays a view shell. */
export function useStudio() {
  const { t } = useI18n()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)
  const detailRequestVersionRef = useRef(0)
  const selectedProjectIdRef = useRef('')
  const mountedRef = useRef(false)
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
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
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
  const letteringDefaults: LetteringDefaults = detail?.project.letteringDefaults || {
    scale: 1,
    color: '#141414',
    sfxStrokeColor: '#ffffff',
    sfxStrokeWidth: 0.18,
  }

  // runTask/pushLog/acceptDetail are function declarations below; hoisting makes
  // them safe to hand to the domain hooks here.
  const history = useStudioHistory({
    busy,
    labels: { undoing: t('log.undoing'), undone: t('log.undone'), redoing: t('log.redoing'), redone: t('log.redone') },
    runTask,
    pushLog,
    acceptDetail,
  })
  const exports = useStudioExports({
    detail,
    activePage,
    runTask,
    pushLog,
    labels: {
      exportZip: t('toolbar.exportZip'),
      exportCbz: t('toolbar.exportCbz'),
      exportPdf: t('toolbar.exportPdf'),
      exportBackupTask: t('log.exportBackupTask'),
      noPagesToExport: t('log.noPagesToExport'),
      exported: (fileName) => t('log.exported', { file: fileName }),
      backupExported: (fileName) => t('log.backupExported', { file: fileName }),
      exportPageLabel: (n) => t('log.exportPageLabel', { n }),
      pageExported: (n) => t('log.pageExported', { n }),
    },
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      detailRequestVersionRef.current += 1
    }
  }, [])

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
          selectProject(projectList[0].id)
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
    if (serverDetailRef.current?.project.id === selectedProjectId) return
    // History commands reference dialogue/page ids of one project; a switch invalidates them.
    history.clearHistory()

    void refreshSelectedProject(selectedProjectId).catch((error) => pushLog(describeError(error), 'error'))
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
        void history.handleUndo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        void history.handleRedo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  function describeError(error: unknown): string {
    if (!(error instanceof Error)) return t('log.unknownError')
    return localizedProviderHttpError(error, t)
      || localizedAiRouteError(error.message, t)
      || localizedAiProviderError(error.message, t)
      || error.message
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

  function acceptDetail(next: ProjectDetail) {
    detailRequestVersionRef.current += 1
    selectedProjectIdRef.current = next.project.id
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

  function selectProject(projectId: string) {
    if (selectedProjectIdRef.current === projectId) {
      if (!serverDetailRef.current) {
        void refreshSelectedProject(projectId).catch((error) => pushLog(describeError(error), 'error'))
      }
      return
    }
    selectedProjectIdRef.current = projectId
    detailRequestVersionRef.current += 1
    serverDetailRef.current = null
    setDetail(null)
    setSelectedPageId('')
    setSelectedProjectId(projectId)
  }

  async function refreshSelectedProject(projectId: string): Promise<ProjectDetail | null> {
    if (!mountedRef.current || selectedProjectIdRef.current !== projectId) return null
    const requestVersion = detailRequestVersionRef.current + 1
    detailRequestVersionRef.current = requestVersion
    try {
      const next = await api.getProject(projectId)
      if (
        !mountedRef.current
        || selectedProjectIdRef.current !== projectId
        || detailRequestVersionRef.current !== requestVersion
      ) return null
      acceptDetail(next)
      return next
    } catch (error) {
      if (
        !mountedRef.current
        || selectedProjectIdRef.current !== projectId
        || detailRequestVersionRef.current !== requestVersion
      ) return null
      throw error
    }
  }

  async function loadInitialProject(projectId: string): Promise<ProjectDetail | null> {
    if (!mountedRef.current || selectedProjectIdRef.current) return null
    selectedProjectIdRef.current = projectId
    try {
      return await refreshSelectedProject(projectId)
    } catch (error) {
      if (selectedProjectIdRef.current === projectId && !serverDetailRef.current) {
        selectedProjectIdRef.current = ''
      }
      throw error
    }
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
    const streamText = streamTextFromJobPayload(event.payload)
    if (streamText !== null) {
      // Live model output belongs in the raw panel; logging every snapshot would flood it.
      setRawOutput({ title: t('raw.streamingTitle'), text: streamText })
      return
    }
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
        history.recordHistory({ scope: 'bible', projectId: next.project.id, before: beforeBible, after: next.project.storyBible })
      }
      pushLog(t('log.storyBibleSaved'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
      await refreshSelectedProject(detail.project.id)
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
        history.recordDialogueChange(target.pageId, before, pageSnapshot(nextBaseline, target.pageId))
      }
      pushLog(t('log.dialogueSaved'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
      if (detail) {
        await refreshSelectedProject(detail.project.id)
      }
    }
  }

  async function handleRegenerateDialogue(id: string, instruction: string) {
    const target = detail?.dialogues.find((item) => item.id === id)
    if (!target) return
    await runTask(t('log.regeneratingLine'), async () => {
      const before = pageSnapshot(serverDetailRef.current, target.pageId)
      const next = await api.regenerateDialogue(
        id,
        { instruction, mode: generateMode, textDensity },
        { onJobId: setCurrentJobId, onEvent: handleJobEvent },
      )
      acceptDetail(next)
      history.recordDialogueChange(target.pageId, before, pageSnapshot(next, target.pageId))
      if (next.raw) {
        setRawOutput({ title: t('raw.lineTitle'), text: next.raw })
      }
      pushLog(t('log.lineRegenerated'), 'success', { toast: false })
    })
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
        history.recordDialogueChange(activePage.id, before, pageSnapshot(nextBaseline, activePage.id))
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
        history.recordDialogueChange(target.pageId, before, pageSnapshot(nextBaseline, target.pageId))
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

  async function handlePixivBatchImported(projectId: string) {
    const next = selectedProjectIdRef.current
      ? await refreshSelectedProject(projectId)
      : await loadInitialProject(projectId)
    if (!next) return
    pushLog(t('log.pixivBatchImported', { count: next.pages.length }), 'success')
  }

  function handlePixivBatchError(message: string) {
    pushLog(message, 'error')
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
        history.recordHistory({ scope: 'bible', projectId: next.project.id, before: beforeBible, after: next.project.storyBible })
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
      history.recordDialogueChange(activePage.id, before, pageSnapshot(next, activePage.id))
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
          history.recordDialogueChange(page.id, before, pageSnapshot(next, page.id))
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
        history.recordDialogueChange(activePage.id, before, pageSnapshot(nextBaseline, activePage.id))
      }
      pushLog(t('log.layoutAdjusted'), 'success', { toast: false })
    })
  }

  async function handleMovePage(pageId: string, offset: -1 | 1) {
    await runTask(t('log.movingPage'), async () => {
      const next = await api.movePage(pageId, offset)
      acceptDetail(next)
      // Page indexes shifted under the recorded snapshots; stale history must not restore them.
      history.clearHistory()
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
      history.clearHistory()
      pushLog(t('log.pageDeleted'), 'success')
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

  /** Lightweight commit for panel-frame edits; avoids the busy state so drawing stays fluid. */
  async function handleSetPanels(pageId: string, panels: PanelBox[]) {
    try {
      const next = await api.updatePagePanels(pageId, panels)
      acceptDetail(next)
      pushLog(t('log.panelsSaved'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
    }
  }

  async function handleSetCleanup(pageId: string, cleanupStrokes: CleanupStroke[]) {
    try {
      const next = await api.updatePageCleanup(pageId, cleanupStrokes)
      acceptDetail(next)
      pushLog(t('log.cleanupSaved'), 'success', { toast: false })
    } catch (error) {
      pushLog(describeError(error), 'error')
    }
  }

  async function handleSaveLettering(defaults: LetteringDefaults, applyToExisting: boolean) {
    if (!detail) return
    await runTask(applyToExisting ? t('log.letteringApplied') : t('log.letteringSaved'), async () => {
      const next = await api.updateProjectSettings(detail.project.id, {
        letteringDefaults: defaults,
        applyLetteringToExisting: applyToExisting,
      })
      acceptDetail(next)
      pushLog(applyToExisting ? t('log.letteringApplied') : t('log.letteringSaved'), 'success', { toast: false })
    })
  }

  async function handleColorDialoguesByCharacter() {
    if (!detail) return
    await runTask(t('log.characterColorsApplied'), async () => {
      const next = await api.updateProjectSettings(detail.project.id, { colorDialoguesByCharacter: true })
      acceptDetail(next)
      pushLog(t('log.characterColorsApplied'), 'success', { toast: false })
    })
  }

  async function handleSetReadingDirection(readingDirection: ReadingDirection) {
    if (!detail || detail.project.readingDirection === readingDirection) return
    await runTask(t('log.savingDirection'), async () => {
      const next = await api.updateProjectSettings(detail.project.id, { readingDirection })
      acceptDetail(next)
      pushLog(t('log.readingDirectionSaved'), 'success', { toast: false })
    })
  }

  async function handleSaveSettings(event: FormEvent, mode: ConnectionMode) {
    event.preventDefault()
    await runTask(t('log.savingSettings'), async () => {
      const status = await api.saveSecrets({
        ...(mode === 'external'
          ? {
              apiBaseUrl: settingsForm.apiBaseUrl,
              modelName: settingsForm.modelName,
              apiKey: settingsForm.apiKey,
            }
          : {}),
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
    setSelectedProjectId: selectProject,
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
    letteringDefaults,
    hasExported: exports.hasExported,
    batchProgress,
    settingsForm,
    setSettingsForm,
    // derived
    assetsById,
    activePage,
    activeAsset,
    activeDialogues,
    selectedDialogue,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    // actions
    runTask,
    pushLog,
    updateDialogueLocal,
    updateStoryBibleLocal,
    commitStoryBible,
    commitDialogue,
    handleAddDialogue,
    handleDeleteDialogue,
    handleRegenerateDialogue,
    handleCreateProject,
    handleLocalFiles,
    importLocalFiles,
    handleBackupFile,
    handlePixivImport,
    handlePixivBatchImported,
    handlePixivBatchError,
    handleAnalyzeStory,
    handleGenerateActivePage,
    handleGenerateAll,
    handleGenerateRange,
    handleCancelCurrentJob,
    handleAvoidOverlap,
    handleUndo: history.handleUndo,
    handleRedo: history.handleRedo,
    handleMovePage,
    handleDeletePage,
    handleExportZip: exports.handleExportZip,
    handleExportCbz: exports.handleExportCbz,
    handleExportPdf: exports.handleExportPdf,
    handleExportActivePage: exports.handleExportActivePage,
    handleExportBackup: exports.handleExportBackup,
    handleSetPanels,
    handleSetCleanup,
    handleSaveLettering,
    handleColorDialoguesByCharacter,
    handleSetReadingDirection,
    handleSaveSettings,
    handleUploadFont,
    handleDeleteCustomFont,
  }
}

function streamTextFromJobPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as { streamText?: unknown }).streamText
  return typeof value === 'string' ? value : null
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

const aiRouteErrorKeys: Record<string, MessageKey> = {
  illegal_content: 'routeError.illegalContent',
  r18_disabled: 'routeError.r18Disabled',
  vision_required: 'routeError.visionRequired',
  vision_capability_unknown: 'routeError.visionRequired',
  adult_input_not_allowed: 'routeError.adultInputRequired',
  adult_input_capability_unknown: 'routeError.adultInputRequired',
  explicit_image_not_allowed: 'routeError.adultInputRequired',
  adult_generation_not_allowed: 'routeError.adultGenerationRequired',
  adult_generation_capability_unknown: 'routeError.adultGenerationRequired',
  image_generation_required: 'routeError.imageGenerationRequired',
  image_generation_capability_unknown: 'routeError.imageGenerationRequired',
  safety_unknown: 'routeError.safetyUnknown',
  safety_classification_failed: 'routeError.safetyUnknown',
  no_compatible_provider: 'routeError.noCompatibleProvider',
}

function localizedAiRouteError(message: string, t: Translator): string | null {
  const prefix = 'AI route blocked by provider safety policy: '
  if (!message.startsWith(prefix)) return null
  const key = aiRouteErrorKeys[message.slice(prefix.length)]
  return key ? t(key) : null
}

function localizedAiProviderError(message: string, t: Translator): string | null {
  return message === 'AI provider refused the request: content_policy' ? t('routeError.providerContentPolicy') : null
}

function localizedProviderHttpError(error: Error, t: Translator): string | null {
  if (!(error instanceof api.JobFailedError) || !error.payload || typeof error.payload !== 'object') return null
  const value = (error.payload as { providerHttpError?: unknown }).providerHttpError
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    typeof record.status !== 'number'
    || typeof record.endpoint !== 'string'
    || typeof record.model !== 'string'
    || typeof record.responseBody !== 'string'
  ) return null
  return t('routeError.providerHttp', {
    status: record.status,
    endpoint: record.endpoint,
    model: record.model,
    response: record.responseBody,
  })
}
