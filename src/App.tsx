import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentType, FormEvent } from 'react'
import {
  BookOpen,
  CircleStop,
  Download,
  ArchiveRestore,
  ImagePlus,
  Images,
  Loader2,
  Lock,
  MessageSquare,
  Moon,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  Unlock,
} from 'lucide-react'
import type { Asset, BubbleStyle, Character, Dialogue, JobEvent, Page, PageStatus, Project, ProjectDetail, ProjectMode, ProjectSource, SecretStatus, StoryBible } from './shared/types'
import { resolveDialogueCollisions } from './shared/layout'
import { renderProjectPages } from './canvasExport'
import { ProviderLabPanel } from './ProviderLabPanel'
import { StoryContinuePanel } from './StoryContinuePanel'
import { WhiteboardCanvas, WHITEBOARD_MAX_ZOOM, WHITEBOARD_MIN_ZOOM } from './WhiteboardCanvas'
import { FONT_PRESETS } from './fonts'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import type { MessageParams } from './i18n/types'
import { useTheme } from './theme'
import * as api from './api'

type InspectorTab = 'story' | 'characters' | 'dialogue' | 'layout' | 'settings'
type EntryMode = 'studio' | 'continue'
type LogLevel = 'info' | 'success' | 'error'
type Translator = (key: MessageKey, params?: MessageParams) => string

interface LogEntry {
  id: string
  time: string
  level: LogLevel
  message: string
}

interface RawOutputState {
  title: string
  text: string
}

const tabItems: Array<{ id: InspectorTab; labelKey: MessageKey; icon: ComponentType<IconProps> }> = [
  { id: 'story', labelKey: 'tab.story', icon: BookOpen },
  { id: 'characters', labelKey: 'tab.characters', icon: Users },
  { id: 'dialogue', labelKey: 'tab.dialogue', icon: MessageSquare },
  { id: 'layout', labelKey: 'tab.layout', icon: PanelRight },
  { id: 'settings', labelKey: 'tab.settings', icon: Settings },
]

const bubbleStyles: BubbleStyle[] = ['speech', 'soft', 'thought', 'caption']

const modeKeys: Record<ProjectMode, MessageKey> = {
  story: 'mode.story',
  translation: 'mode.translation',
}

const sourceKeys: Record<ProjectSource, MessageKey> = {
  pixiv: 'source.pixiv',
  local: 'source.local',
  mixed: 'source.mixed',
  sample: 'source.sample',
}

const pageStatusKeys: Record<PageStatus, MessageKey> = {
  ready: 'pageStatus.ready',
  analyzing: 'pageStatus.analyzing',
  generating: 'pageStatus.generating',
  complete: 'pageStatus.complete',
  error: 'pageStatus.error',
}

const bubbleStyleKeys: Record<BubbleStyle, MessageKey> = {
  speech: 'bubble.speech',
  soft: 'bubble.soft',
  thought: 'bubble.thought',
  caption: 'bubble.caption',
}

function App() {
  const { locale, setLocale, t } = useI18n()
  const { theme, toggleTheme } = useTheme()
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
  const [zoom, setZoom] = useState(1)
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null)
  const [settingsForm, setSettingsForm] = useState({
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
        const [projectList, status] = await Promise.all([api.listProjects(), api.getSecretStatus()])
        if (cancelled) return
        setProjects(projectList)
        setSecretStatus(status)
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

    api
      .getProject(selectedProjectId)
      .then((next) => {
        if (cancelled) return
        setDetail(next)
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

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : t('log.unknownError')
  }

  function pushLog(message: string, level: LogLevel = 'info') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs((current) => [{ id: cryptoId(), time, level, message }, ...current].slice(0, 80))
  }

  function acceptDetail(next: ProjectDetail) {
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
      const next = await api.saveStoryBible(detail.project.id, storyBible)
      acceptDetail(next)
      pushLog(t('log.storyBibleSaved'), 'success')
    } catch (error) {
      pushLog(describeError(error), 'error')
      acceptDetail(await api.getProject(detail.project.id))
    }
  }

  async function commitDialogue(id: string, patch: Partial<Dialogue>) {
    updateDialogueLocal(id, patch)
    try {
      const updated = await api.patchDialogue(id, patch)
      updateDialogueLocal(id, updated)
      pushLog(t('log.dialogueSaved'), 'success')
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
      const created = await api.createDialogue(activePage.id, position)
      setDetail((current) => (current ? { ...current, dialogues: [...current.dialogues, created] } : current))
      setSelectedDialogueId(created.id)
      setActiveTab('dialogue')
      pushLog(t('log.dialogueAdded'), 'success')
    } catch (error) {
      pushLog(describeError(error), 'error')
    }
  }

  async function handleDeleteDialogue(id: string) {
    try {
      await api.deleteDialogue(id)
      setDetail((current) =>
        current ? { ...current, dialogues: current.dialogues.filter((dialogue) => dialogue.id !== id) } : current,
      )
      setSelectedDialogueId((current) => (current === id ? '' : current))
      pushLog(t('log.dialogueDeleted'), 'success')
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

  async function handleLocalFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    if (!files.length) return

    await runTask(t('log.importingLocal'), async () => {
      const next = await api.importLocal(files, detail?.project.id)
      acceptDetail(next)
      pushLog(t('log.imagesImported', { count: files.length }), 'success')
    })
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
      const next = await api.analyzeStory(
        { projectId: detail.project.id, userBrief, r18Enabled },
        { onJobId: setCurrentJobId, onEvent: handleJobEvent },
      )
      acceptDetail(next)
      if (next.raw) {
        setRawOutput({ title: t('raw.storyBibleTitle'), text: next.raw })
      }
      pushLog(next.usedMock ? t('log.storyBibleMock') : t('log.storyBibleGenerated'), 'success')
    })
  }

  async function handleGenerateActivePage() {
    if (!activePage) return
    await runTask(t('log.generatePageLabel', { n: activePage.index + 1 }), async () => {
      const next = await api.generatePage(activePage.id, { mode: generateMode, textDensity }, { onJobId: setCurrentJobId, onEvent: handleJobEvent })
      acceptDetail(next)
      if (next.raw) {
        setRawOutput({ title: t('raw.pageTitle', { n: activePage.index + 1 }), text: next.raw })
      }
      pushLog(t('log.pageDialogueGenerated', { n: activePage.index + 1 }), 'success')
    })
  }

  async function handleGenerateAll() {
    if (!detail) return
    await runTask(t('toolbar.generateAll'), async () => {
      // Completed pages may hold hand-edited dialogue; bulk generation must not overwrite them.
      const pendingPages = detail.pages.filter((page) => page.status !== 'complete')
      const skippedCount = detail.pages.length - pendingPages.length
      if (!pendingPages.length) {
        pushLog(t('log.allPagesAlreadyComplete'))
        return
      }
      for (const page of pendingPages) {
        pushLog(t('log.generatingPage', { n: page.index + 1 }))
        const next = await api.generatePage(page.id, { mode: generateMode, textDensity }, { onJobId: setCurrentJobId, onEvent: handleJobEvent })
        acceptDetail(next)
        if (next.raw) {
          setRawOutput({ title: t('raw.pageTitle', { n: page.index + 1 }), text: next.raw })
        }
      }
      if (skippedCount > 0) {
        pushLog(t('log.skippedCompletedPages', { count: skippedCount }))
      }
      pushLog(t('log.allPagesGenerated'), 'success')
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
      pushLog(t('log.layoutAdjusted'), 'success')
    })
  }

  async function handleExportZip() {
    if (!detail) return
    await runTask(t('toolbar.exportZip'), async () => {
      const pages = await renderProjectPages(detail)
      if (!pages.length) {
        throw new Error(t('log.noPagesToExport'))
      }
      const result = await api.exportZip({ projectId: detail.project.id, pages })
      pushLog(t('log.exported', { file: result.fileName }), 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
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

  const canRun = Boolean(detail && !busy)

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <h1>Pixiv-to-Manga Studio</h1>
            <span>
              {detail
                ? t('header.projectSummary', { pages: detail.pages.length, mode: t(modeKeys[detail.project.mode]) })
                : t('header.appSubtitle')}
            </span>
          </div>
        </div>
        <div className="toolbar">
          <div className="entry-switch" role="tablist" aria-label={t('header.workspaceEntries')}>
            <button type="button" className={entryMode === 'studio' ? 'active' : ''} onClick={() => setEntryMode('studio')}>
              {t('header.entryStudio')}
            </button>
            <button type="button" className={entryMode === 'continue' ? 'active' : ''} data-testid="entry-story-continue" onClick={() => setEntryMode('continue')}>
              {t('header.entryContinue')}
            </button>
          </div>
          {entryMode === 'studio' ? (
            <>
              <ToolbarButton icon={ImagePlus} label={t('toolbar.importPixiv')} testId="toolbar-import-pixiv" disabled={!canRun} onClick={() => setActiveTab('story')} />
              <ToolbarButton icon={Upload} label={t('toolbar.localImages')} testId="toolbar-import-local" disabled={Boolean(busy)} onClick={() => fileInputRef.current?.click()} />
              <ToolbarButton icon={WandSparkles} label={t('toolbar.analyzeStory')} testId="toolbar-analyze-story" disabled={!canRun} onClick={handleAnalyzeStory} />
              <ToolbarButton icon={Play} label={t('toolbar.generatePage')} testId="toolbar-generate-page" disabled={!canRun || !activePage} onClick={handleGenerateActivePage} />
              <ToolbarButton icon={Sparkles} label={t('toolbar.generateAll')} testId="toolbar-generate-all" disabled={!canRun} onClick={handleGenerateAll} />
              <ToolbarButton icon={CircleStop} label={t('toolbar.cancel')} testId="toolbar-cancel-job" disabled={!currentJobId} onClick={handleCancelCurrentJob} />
              <ToolbarButton icon={Download} label={t('toolbar.exportZip')} testId="toolbar-export-zip" disabled={!canRun || !detail?.pages.length} onClick={handleExportZip} />
              <ToolbarButton icon={Save} label={t('toolbar.exportBackup')} testId="toolbar-export-backup" disabled={!canRun} onClick={handleExportBackup} />
              <ToolbarButton icon={ArchiveRestore} label={t('toolbar.restoreBackup')} testId="toolbar-restore-backup" disabled={Boolean(busy)} onClick={() => backupInputRef.current?.click()} />
            </>
          ) : null}
        </div>
        <div className="topbar-controls">
          <div className="lang-switch" role="group" aria-label={t('header.language')}>
            <button type="button" className={locale === 'en' ? 'active' : ''} data-testid="lang-en" onClick={() => setLocale('en')}>
              EN
            </button>
            <button type="button" className={locale === 'zh-TW' ? 'active' : ''} data-testid="lang-zh" onClick={() => setLocale('zh-TW')}>
              中文
            </button>
          </div>
          <button
            type="button"
            className="icon-button"
            data-testid="theme-toggle"
            title={theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
            aria-label={theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="status-pill" data-busy={Boolean(busy)} data-testid="studio-status" role="status" aria-live="polite">
            {busy ? <Loader2 size={15} /> : <span />}
            {busy || t('status.ready')}
          </div>
        </div>
        <input
          ref={fileInputRef}
          id="local-image-input"
          className="hidden-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          multiple
          aria-label={t('header.localImageFiles')}
          data-testid="local-image-input"
          onChange={handleLocalFiles}
        />
        <input
          ref={backupInputRef}
          id="project-backup-input"
          className="hidden-input"
          type="file"
          accept="application/zip,.zip"
          aria-label={t('header.projectBackupZip')}
          data-testid="project-backup-input"
          onChange={handleBackupFile}
        />
      </header>

      {entryMode === 'continue' ? (
        <StoryContinuePanel disabled={Boolean(busy)} runTask={runTask} onLog={pushLog} />
      ) : (
      <main className="workspace-grid">
        <aside className="left-rail panel">
          <form className="create-form" onSubmit={handleCreateProject}>
            <div className="panel-heading">
              <Plus size={16} />
              <span>{t('studio.newProject')}</span>
            </div>
            <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} aria-label={t('studio.projectTitle')} />
            <div className="segmented">
              <button type="button" className={createMode === 'story' ? 'active' : ''} onClick={() => setCreateMode('story')}>
                {t('mode.story')}
              </button>
              <button type="button" className={createMode === 'translation' ? 'active' : ''} onClick={() => setCreateMode('translation')}>
                {t('mode.translation')}
              </button>
            </div>
            <button type="submit" className="primary-button" disabled={Boolean(busy)}>
              {t('studio.create')}
            </button>
          </form>

          <section className="project-list">
            <div className="panel-heading">
              <Images size={16} />
              <span>{t('studio.projects')}</span>
            </div>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`project-row ${project.id === selectedProjectId ? 'active' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <strong>{project.title}</strong>
                <span>
                  {t('studio.projectRowSummary', { source: t(sourceKeys[project.source]), mode: t(modeKeys[project.mode]) })}
                </span>
              </button>
            ))}
          </section>

          <section className="page-list">
            <div className="panel-heading">
              <BookOpen size={16} />
              <span>{t('studio.pages')}</span>
            </div>
            {detail?.pages.map((page) => (
              <PageThumb
                key={page.id}
                page={page}
                asset={assetsById.get(page.originalAssetId)}
                active={page.id === activePage?.id}
                dialogueCount={detail.dialogues.filter((dialogue) => dialogue.pageId === page.id).length}
                onClick={() => setSelectedPageId(page.id)}
              />
            ))}
          </section>
        </aside>

        <section className="canvas-panel">
          <WhiteboardCanvas
            page={activePage}
            asset={activeAsset}
            dialogues={activeDialogues}
            characters={detail?.characters || []}
            zoom={zoom}
            onZoomChange={setZoom}
            selectedDialogueId={selectedDialogueId}
            onSelectDialogue={(id) => {
              setSelectedDialogueId(id)
              setActiveTab('dialogue')
            }}
            onPatchDialogue={commitDialogue}
            onAddDialogue={(x, y) => handleAddDialogue({ x, y })}
          />
        </section>

        <aside className="right-rail panel">
          <div className="inspector-tabs" role="tablist" aria-label={t('tab.inspectorPanels')}>
            {tabItems.map((item) => {
              const Icon = item.icon
              const label = t(item.labelKey)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === item.id}
                  data-testid={`tab-${item.id}`}
                  className={activeTab === item.id ? 'active' : ''}
                  onClick={() => setActiveTab(item.id)}
                  title={label}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>

          {activeTab === 'story' && (
            <StoryPanel
              detail={detail}
              userBrief={userBrief}
              setUserBrief={setUserBrief}
              r18Enabled={r18Enabled}
              setR18Enabled={setR18Enabled}
              pixivUrl={pixivUrl}
              setPixivUrl={setPixivUrl}
              onPixivImport={handlePixivImport}
              onStoryBibleChange={updateStoryBibleLocal}
              onStoryBibleCommit={commitStoryBible}
              disabled={Boolean(busy)}
            />
          )}
          {activeTab === 'characters' && (
            <CharactersPanel
              storyBible={detail?.project.storyBible}
              onStoryBibleChange={updateStoryBibleLocal}
              onStoryBibleCommit={commitStoryBible}
            />
          )}
          {activeTab === 'dialogue' && (
            <DialoguePanel
              dialogues={activeDialogues}
              selectedDialogue={selectedDialogue}
              canAdd={Boolean(activePage) && !busy}
              onAdd={() => handleAddDialogue()}
              onDelete={handleDeleteDialogue}
              onSelect={setSelectedDialogueId}
              onLocalChange={updateDialogueLocal}
              onCommit={commitDialogue}
            />
          )}
          {activeTab === 'layout' && (
            <LayoutPanel
              mode={generateMode}
              setMode={setGenerateMode}
              textDensity={textDensity}
              setTextDensity={setTextDensity}
              zoom={zoom}
              setZoom={setZoom}
              selectedDialogue={selectedDialogue}
              onCommit={commitDialogue}
              onAvoidOverlap={handleAvoidOverlap}
              disabled={Boolean(busy)}
            />
          )}
          {activeTab === 'settings' && (
            <>
              <SettingsPanel
                status={secretStatus}
                form={settingsForm}
                setForm={setSettingsForm}
                onSubmit={handleSaveSettings}
                disabled={Boolean(busy)}
              />
              <ProviderLabPanel />
            </>
          )}
        </aside>
      </main>
      )}

      <footer className="log-panel">
        <div className="panel-heading">
          <RefreshCw size={16} />
          <span>{t('logPanel.title')}</span>
        </div>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="empty-text">{t('logPanel.empty')}</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className={`log-row ${entry.level}`}>
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
        {rawOutput ? (
          <details className="raw-output-panel">
            <summary>{rawOutput.title}</summary>
            <textarea readOnly value={rawOutput.text} data-testid="raw-ai-output" />
          </details>
        ) : null}
      </footer>
    </div>
  )
}

function ToolbarButton(props: {
  icon: ComponentType<IconProps>
  label: string
  testId: string
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      className="toolbar-button"
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
    >
      <Icon size={16} />
      <span>{props.label}</span>
    </button>
  )
}

function PageThumb(props: {
  page: Page
  asset?: Asset
  active: boolean
  dialogueCount: number
  onClick: () => void
}) {
  const { t } = useI18n()
  return (
    <button type="button" className={`page-thumb ${props.active ? 'active' : ''}`} data-testid="page-thumb" onClick={props.onClick}>
      <div className="thumb-image">
        {props.asset ? <img src={props.asset.url} alt={t('studio.pageLabel', { n: props.page.index + 1 })} /> : null}
      </div>
      <div>
        <strong>{t('studio.pageLabel', { n: props.page.index + 1 })}</strong>
        <span>{t('studio.pageThumbSummary', { count: props.dialogueCount, status: t(pageStatusKeys[props.page.status]) })}</span>
      </div>
    </button>
  )
}

function StoryPanel(props: {
  detail: ProjectDetail | null
  userBrief: string
  setUserBrief: (value: string) => void
  r18Enabled: boolean
  setR18Enabled: (value: boolean) => void
  pixivUrl: string
  setPixivUrl: (value: string) => void
  onPixivImport: (event: FormEvent) => void
  onStoryBibleChange: (storyBible: StoryBible) => void
  onStoryBibleCommit: (storyBible: StoryBible) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const story = props.detail?.project.storyBible
  const updateStory = (patch: Partial<StoryBible>) => {
    if (!story) return
    props.onStoryBibleChange({ ...story, ...patch })
  }
  const commitStory = (patch: Partial<StoryBible>) => {
    if (!story) return
    props.onStoryBibleCommit({ ...story, ...patch })
  }
  const updateBeat = (pageIndex: number, patch: Partial<StoryBible['pageBeats'][number]>) => {
    if (!story) return
    props.onStoryBibleChange({
      ...story,
      pageBeats: story.pageBeats.map((beat) => (beat.pageIndex === pageIndex ? { ...beat, ...patch } : beat)),
    })
  }
  const commitBeat = (pageIndex: number, patch: Partial<StoryBible['pageBeats'][number]>) => {
    if (!story) return
    props.onStoryBibleCommit({
      ...story,
      pageBeats: story.pageBeats.map((beat) => (beat.pageIndex === pageIndex ? { ...beat, ...patch } : beat)),
    })
  }

  return (
    <div className="inspector-body">
      <form className="pixiv-form" onSubmit={props.onPixivImport}>
        <label>
          {t('story.pixivUrlLabel')}
          <input value={props.pixivUrl} onChange={(event) => props.setPixivUrl(event.target.value)} placeholder={t('story.pixivPlaceholder')} />
        </label>
        <button type="submit" className="secondary-button" disabled={props.disabled}>
          <ImagePlus size={15} />
          {t('toolbar.importPixiv')}
        </button>
      </form>

      <label className="field-block">
        {t('story.userBrief')}
        <textarea value={props.userBrief} onChange={(event) => props.setUserBrief(event.target.value)} rows={5} placeholder={t('story.userBriefPlaceholder')} />
      </label>

      <label className="toggle-row danger">
        <input type="checkbox" checked={props.r18Enabled} onChange={(event) => props.setR18Enabled(event.target.checked)} />
        <span>{t('story.r18Local')}</span>
      </label>

      {story ? (
        <div className="edit-form story-editor">
          <label>
            {t('story.synopsis')}
            <textarea
              value={story.synopsis}
              rows={4}
              data-testid="story-synopsis-input"
              onChange={(event) => updateStory({ synopsis: event.target.value })}
              onBlur={(event) => commitStory({ synopsis: event.target.value })}
            />
          </label>
          <label>
            {t('story.tone')}
            <textarea
              value={story.tone}
              rows={3}
              data-testid="story-tone-input"
              onChange={(event) => updateStory({ tone: event.target.value })}
              onBlur={(event) => commitStory({ tone: event.target.value })}
            />
          </label>
          <label>
            {t('story.stylePrompt')}
            <textarea
              value={story.stylePrompt || ''}
              rows={3}
              data-testid="story-style-prompt-input"
              placeholder={t('story.stylePromptPlaceholder')}
              onChange={(event) => updateStory({ stylePrompt: event.target.value })}
              onBlur={(event) => commitStory({ stylePrompt: event.target.value })}
            />
          </label>
          <label className="toggle-row danger">
            <input
              type="checkbox"
              checked={story.r18Enabled}
              onChange={(event) => {
                const next = { ...story, r18Enabled: event.target.checked }
                props.onStoryBibleChange(next)
                props.onStoryBibleCommit(next)
              }}
            />
            <span>{t('story.bibleR18')}</span>
          </label>
          <div className="beat-list">
            {story.pageBeats.map((beat) => (
              <div key={`${beat.pageIndex}-${beat.summary}`} className="beat-row">
                <strong>P{beat.pageIndex + 1}</strong>
                <label>
                  {t('story.summary')}
                  <textarea
                    value={beat.summary}
                    rows={3}
                    data-testid="story-beat-summary-input"
                    onChange={(event) => updateBeat(beat.pageIndex, { summary: event.target.value })}
                    onBlur={(event) => commitBeat(beat.pageIndex, { summary: event.target.value })}
                  />
                </label>
                <label>
                  {t('story.intent')}
                  <textarea
                    value={beat.intent}
                    rows={2}
                    onChange={(event) => updateBeat(beat.pageIndex, { intent: event.target.value })}
                    onBlur={(event) => commitBeat(beat.pageIndex, { intent: event.target.value })}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty-text">{t('story.empty')}</p>
      )}
    </div>
  )
}

const CHARACTER_COLOR_PALETTE = ['#c9282d', '#1d5f9f', '#217a4f', '#7c3aed', '#b45309', '#0f766e']
const MAX_CHARACTERS = 20

function CharactersPanel(props: {
  storyBible?: StoryBible
  onStoryBibleChange: (storyBible: StoryBible) => void
  onStoryBibleCommit: (storyBible: StoryBible) => void
}) {
  const { t } = useI18n()
  const storyBible = props.storyBible
  const characters = storyBible?.characters || []
  // storyBibleSchema enforces 1..20 characters; mirror those bounds in the UI.
  const canAdd = Boolean(storyBible) && characters.length < MAX_CHARACTERS
  const canDelete = characters.length > 1

  const updateCharacter = (characterId: string, patch: Partial<Character>, commit = false) => {
    if (!storyBible) return
    const next = {
      ...storyBible,
      characters: storyBible.characters.map((character) => (character.id === characterId ? { ...character, ...patch } : character)),
    }
    props.onStoryBibleChange(next)
    if (commit) {
      props.onStoryBibleCommit(next)
    }
  }

  const addCharacter = () => {
    if (!storyBible || !canAdd) return
    const next = {
      ...storyBible,
      characters: [
        ...storyBible.characters,
        {
          id: cryptoId(),
          projectId: storyBible.characters[0]?.projectId || '',
          name: t('character.newName'),
          description: '',
          voice: '',
          color: CHARACTER_COLOR_PALETTE[storyBible.characters.length % CHARACTER_COLOR_PALETTE.length],
          bubbleStyle: 'speech' as BubbleStyle,
        },
      ],
    }
    props.onStoryBibleChange(next)
    props.onStoryBibleCommit(next)
  }

  const deleteCharacter = (characterId: string) => {
    if (!storyBible || !canDelete) return
    const next = {
      ...storyBible,
      characters: storyBible.characters.filter((character) => character.id !== characterId),
    }
    props.onStoryBibleChange(next)
    props.onStoryBibleCommit(next)
  }

  return (
    <div className="inspector-body">
      <button type="button" className="secondary-button" data-testid="character-add" disabled={!canAdd} onClick={addCharacter}>
        <Plus size={15} />
        {t('character.add')}
      </button>
      {characters.length ? (
        characters.map((character) => (
          <div key={character.id} className="character-row character-editor">
            <span className="swatch" style={{ background: character.color }} />
            <div>
              <label>
                {t('character.name')}
                <input
                  value={character.name}
                  data-testid="character-name-input"
                  onChange={(event) => updateCharacter(character.id, { name: event.target.value })}
                  onBlur={(event) => updateCharacter(character.id, { name: event.target.value }, true)}
                />
              </label>
              <label>
                {t('character.description')}
                <textarea
                  value={character.description}
                  rows={3}
                  onChange={(event) => updateCharacter(character.id, { description: event.target.value })}
                  onBlur={(event) => updateCharacter(character.id, { description: event.target.value }, true)}
                />
              </label>
              <label>
                {t('character.voice')}
                <textarea
                  value={character.voice}
                  rows={3}
                  onChange={(event) => updateCharacter(character.id, { voice: event.target.value })}
                  onBlur={(event) => updateCharacter(character.id, { voice: event.target.value }, true)}
                />
              </label>
              <div className="two-col">
                <label>
                  {t('character.color')}
                  <input
                    type="color"
                    value={character.color}
                    onChange={(event) => updateCharacter(character.id, { color: event.target.value })}
                    onBlur={(event) => updateCharacter(character.id, { color: event.target.value }, true)}
                  />
                </label>
                <label>
                  {t('character.bubble')}
                  <select
                    value={character.bubbleStyle}
                    onChange={(event) => updateCharacter(character.id, { bubbleStyle: event.target.value as BubbleStyle }, true)}
                  >
                    {bubbleStyles.map((style) => (
                      <option key={style} value={style}>
                        {t(bubbleStyleKeys[style])}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                {t('character.font')}
                <select
                  value={character.fontFamily || ''}
                  data-testid="character-font-select"
                  onChange={(event) => updateCharacter(character.id, { fontFamily: event.target.value || undefined }, true)}
                >
                  {FONT_PRESETS.map((preset) => (
                    <option key={preset.labelKey} value={preset.value}>
                      {t(preset.labelKey)}
                    </option>
                  ))}
                  {character.fontFamily && !FONT_PRESETS.some((preset) => preset.value === character.fontFamily) ? (
                    <option value={character.fontFamily}>{character.fontFamily}</option>
                  ) : null}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button danger-button"
                data-testid="character-delete"
                disabled={!canDelete}
                onClick={() => deleteCharacter(character.id)}
              >
                <Trash2 size={15} />
                {t('character.delete')}
              </button>
            </div>
          </div>
        ))
      ) : (
        <p className="empty-text">{t('character.empty')}</p>
      )}
    </div>
  )
}

function DialoguePanel(props: {
  dialogues: Dialogue[]
  selectedDialogue?: Dialogue
  canAdd: boolean
  onAdd: () => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
  onLocalChange: (id: string, patch: Partial<Dialogue>) => void
  onCommit: (id: string, patch: Partial<Dialogue>) => void
}) {
  const { t } = useI18n()
  const dialogue = props.selectedDialogue
  return (
    <div className="inspector-body">
      <button type="button" className="secondary-button" data-testid="dialogue-add" disabled={!props.canAdd} onClick={props.onAdd}>
        <Plus size={15} />
        {t('dialogue.add')}
      </button>
      <div className="dialogue-stack">
        {props.dialogues.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dialogue-chip ${item.id === dialogue?.id ? 'active' : ''}`}
            data-testid="dialogue-chip"
            onClick={() => props.onSelect(item.id)}
          >
            <span style={{ borderColor: item.color }} />
            {item.text}
          </button>
        ))}
      </div>

      {dialogue ? (
        <div className="edit-form">
          <label>
            {t('dialogue.text')}
            <textarea
              value={dialogue.text}
              rows={5}
              onChange={(event) => props.onLocalChange(dialogue.id, { text: event.target.value })}
              onBlur={() => props.onCommit(dialogue.id, { text: dialogue.text })}
            />
          </label>
          <label>
            {t('dialogue.character')}
            <input
              value={dialogue.characterName || ''}
              onChange={(event) => props.onLocalChange(dialogue.id, { characterName: event.target.value })}
              onBlur={() => props.onCommit(dialogue.id, { characterName: dialogue.characterName })}
            />
          </label>
          <div className="two-col">
            <label>
              {t('character.color')}
              <input
                type="color"
                value={dialogue.color}
                onChange={(event) => {
                  props.onLocalChange(dialogue.id, { color: event.target.value })
                  props.onCommit(dialogue.id, { color: event.target.value })
                }}
              />
            </label>
            <label>
              {t('character.bubble')}
              <select
                value={dialogue.bubbleStyle}
                onChange={(event) => {
                  const bubbleStyle = event.target.value as BubbleStyle
                  props.onLocalChange(dialogue.id, { bubbleStyle })
                  props.onCommit(dialogue.id, { bubbleStyle })
                }}
              >
                {bubbleStyles.map((style) => (
                  <option key={style} value={style}>
                    {t(bubbleStyleKeys[style])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two-col">
            <button
              type="button"
              className="secondary-button"
              aria-pressed={dialogue.locked}
              data-testid="dialogue-lock-toggle"
              onClick={() => props.onCommit(dialogue.id, dialogue.locked ? { locked: false } : { locked: true })}
            >
              {dialogue.locked ? <Unlock size={15} /> : <Lock size={15} />}
              {dialogue.locked ? t('dialogue.unlock') : t('dialogue.lock')}
            </button>
            <button
              type="button"
              className="secondary-button danger-button"
              data-testid="dialogue-delete"
              onClick={() => props.onDelete(dialogue.id)}
            >
              <Trash2 size={15} />
              {t('dialogue.delete')}
            </button>
          </div>
        </div>
      ) : (
        <p className="empty-text">{t('dialogue.empty')}</p>
      )}
    </div>
  )
}

function LayoutPanel(props: {
  mode: 'story' | 'translation'
  setMode: (mode: 'story' | 'translation') => void
  textDensity: number
  setTextDensity: (value: number) => void
  zoom: number
  setZoom: (value: number) => void
  selectedDialogue?: Dialogue
  onCommit: (id: string, patch: Partial<Dialogue>) => void
  onAvoidOverlap: () => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const dialogue = props.selectedDialogue
  return (
    <div className="inspector-body">
      <div className="segmented">
        <button type="button" className={props.mode === 'story' ? 'active' : ''} onClick={() => props.setMode('story')}>
          {t('mode.story')}
        </button>
        <button type="button" className={props.mode === 'translation' ? 'active' : ''} onClick={() => props.setMode('translation')}>
          {t('mode.translation')}
        </button>
      </div>
      <label className="range-row">
        <span>{t('layout.textDensity')}</span>
        <input type="range" min="0" max="1" step="0.05" value={props.textDensity} onChange={(event) => props.setTextDensity(Number(event.target.value))} />
        <strong>{props.textDensity.toFixed(2)}</strong>
      </label>
      <label className="range-row">
        <span>{t('layout.canvasZoom')}</span>
        <input
          type="range"
          min={WHITEBOARD_MIN_ZOOM}
          max={WHITEBOARD_MAX_ZOOM}
          step="0.05"
          value={props.zoom}
          onChange={(event) => props.setZoom(Number(event.target.value))}
        />
        <strong>{Math.round(props.zoom * 100)}%</strong>
      </label>
      <button type="button" className="secondary-button" disabled={props.disabled} onClick={props.onAvoidOverlap}>
        <PanelRight size={15} />
        {t('layout.avoidOverlap')}
      </button>

      {dialogue ? (
        <div className="edit-form compact">
          <div className="two-col">
            <NumberField label={t('layout.x')} value={dialogue.x} min={0} max={1} step={0.01} onCommit={(x) => props.onCommit(dialogue.id, { x })} />
            <NumberField label={t('layout.y')} value={dialogue.y} min={0} max={1} step={0.01} onCommit={(y) => props.onCommit(dialogue.id, { y })} />
          </div>
          <div className="two-col">
            <NumberField label={t('layout.scale')} value={dialogue.scale} min={0.5} max={2.5} step={0.05} onCommit={(scale) => props.onCommit(dialogue.id, { scale })} />
            <NumberField label={t('layout.rotation')} value={dialogue.rotation} min={-45} max={45} step={1} onCommit={(rotation) => props.onCommit(dialogue.id, { rotation })} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NumberField(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}) {
  return (
    <label>
      {props.label}
      <input
        key={props.value}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        defaultValue={Number(props.value.toFixed(3))}
        onBlur={(event) => props.onCommit(clampNumber(Number(event.target.value), props.min, props.max))}
      />
    </label>
  )
}

function SettingsPanel(props: {
  status: SecretStatus | null
  form: { apiBaseUrl: string; modelName: string; apiKey: string; pixivCookie: string }
  setForm: (value: { apiBaseUrl: string; modelName: string; apiKey: string; pixivCookie: string }) => void
  onSubmit: (event: FormEvent) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const update = (patch: Partial<typeof props.form>) => props.setForm({ ...props.form, ...patch })
  return (
    <form className="inspector-body settings-form" onSubmit={props.onSubmit}>
      <div className={`credential-status ${props.status?.keychainAvailable ? 'ok' : 'blocked'}`}>
        <strong>{props.status?.keychainAvailable ? t('settings.keychainOk') : t('settings.keychainBlocked')}</strong>
        <span>
          {t('settings.secretSummary', {
            apiKey: props.status?.hasApiKey ? t('settings.saved') : t('settings.notSaved'),
            cookie: props.status?.hasPixivCookie ? t('settings.saved') : t('settings.notSaved'),
          })}
        </span>
      </div>
      <label>
        {t('settings.baseUrl')}
        <input value={props.form.apiBaseUrl} onChange={(event) => update({ apiBaseUrl: event.target.value })} placeholder={t('settings.baseUrlPlaceholder')} />
      </label>
      <label>
        {t('settings.model')}
        <input value={props.form.modelName} onChange={(event) => update({ modelName: event.target.value })} placeholder={t('settings.modelPlaceholder')} />
      </label>
      <label>
        {t('settings.apiKey')}
        <input
          type="password"
          value={props.form.apiKey}
          onChange={(event) => update({ apiKey: event.target.value })}
          placeholder={props.status?.hasApiKey ? t('settings.savedInKeychain') : t('settings.notSavedPlaceholder')}
        />
      </label>
      <label>
        {t('settings.pixivCookie')}
        <textarea
          value={props.form.pixivCookie}
          onChange={(event) => update({ pixivCookie: event.target.value })}
          rows={4}
          placeholder={props.status?.hasPixivCookie ? t('settings.savedInKeychain') : t('settings.cookiePlaceholder')}
        />
      </label>
      <button type="submit" className="primary-button" disabled={props.disabled || props.status?.keychainAvailable === false}>
        <Save size={15} />
        {t('settings.save')}
      </button>
    </form>
  )
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
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

function cryptoId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
}

interface IconProps {
  size?: number
  strokeWidth?: number
}

export default App
