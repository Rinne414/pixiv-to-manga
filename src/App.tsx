import { useState } from 'react'
import type { ComponentType } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Download,
  Eye,
  FileText,
  ArchiveRestore,
  CircleHelp,
  ImageDown,
  ImagePlus,
  Images,
  Loader2,
  MessageSquare,
  Moon,
  PanelRight,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Sun,
  Undo2,
  Upload,
  Users,
  WandSparkles,
} from 'lucide-react'
import { OnboardingChecklist } from './OnboardingChecklist'
import { GuideModal } from './GuideModal'
import { ProviderLabPanel } from './ProviderLabPanel'
import { ReaderOverlay } from './ReaderOverlay'
import { StoryContinuePanel } from './StoryContinuePanel'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { CharactersPanel } from './panels/CharactersPanel'
import { DialoguePanel } from './panels/DialoguePanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { LetteringDefaultsPanel } from './panels/LetteringDefaultsPanel'
import { PageThumb } from './panels/PageThumb'
import { SettingsPanel } from './panels/SettingsPanel'
import { StoryPanel } from './panels/StoryPanel'
import { modeKeys, sourceKeys } from './panels/labels'
import { useI18n } from './i18n/context'
import { UpdatePanel } from './panels/UpdatePanel'
import { useUpdates } from './useUpdates'
import type { MessageKey } from './i18n/messages'
import { useTheme } from './theme'
import type { IconProps } from './uiUtils'
import type { ConnectionMode } from './shared/types'
import { useStudio, type InspectorTab } from './useStudio'
import { ActiveIndicator, MotionIcon } from './MotionUI'
import { quickTransition, softSpring } from './motionTokens'

const tabItems: Array<{ id: InspectorTab; labelKey: MessageKey; icon: ComponentType<IconProps> }> = [
  { id: 'story', labelKey: 'tab.story', icon: BookOpen },
  { id: 'characters', labelKey: 'tab.characters', icon: Users },
  { id: 'dialogue', labelKey: 'tab.dialogue', icon: MessageSquare },
  { id: 'layout', labelKey: 'tab.layout', icon: PanelRight },
  { id: 'settings', labelKey: 'tab.settings', icon: Settings },
]

function App() {
  const { locale, setLocale, t } = useI18n()
  const updates = useUpdates()
  const { theme, toggleTheme } = useTheme()
  const studio = useStudio()
  const [logCollapsed, setLogCollapsed] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('external')
  const {
    fileInputRef,
    backupInputRef,
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
    assetsById,
    activePage,
    activeAsset,
    activeDialogues,
    selectedDialogue,
    secretStatus,
    providers,
    customFonts,
    hasExported,
    batchProgress,
    canUndo,
    canRedo,
    zoom,
    setZoom,
  } = studio

  const canRun = Boolean(detail && !busy)

  return (
    <div className="studio-shell" data-log-collapsed={logCollapsed}>
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
          <LayoutGroup id="entry-mode">
            <div className="entry-switch" role="tablist" aria-label={t('header.workspaceEntries')}>
              <motion.button type="button" className={entryMode === 'studio' ? 'active' : ''} whileTap={{ scale: 0.96 }} onClick={() => setEntryMode('studio')}>
                {entryMode === 'studio' ? <ActiveIndicator layoutId="entry-mode-active" className="switch-indicator" /> : null}
                <span className="switch-label">{t('header.entryStudio')}</span>
              </motion.button>
              <motion.button type="button" className={entryMode === 'continue' ? 'active' : ''} whileTap={{ scale: 0.96 }} data-testid="entry-story-continue" onClick={() => setEntryMode('continue')}>
                {entryMode === 'continue' ? <ActiveIndicator layoutId="entry-mode-active" className="switch-indicator" /> : null}
                <span className="switch-label">{t('header.entryContinue')}</span>
              </motion.button>
            </div>
          </LayoutGroup>
          {entryMode === 'studio' ? (
            <>
              <ToolbarButton icon={ImagePlus} label={t('toolbar.importPixiv')} testId="toolbar-import-pixiv" disabled={!canRun} onClick={() => setActiveTab('story')} />
              <ToolbarButton icon={Upload} label={t('toolbar.localImages')} testId="toolbar-import-local" disabled={Boolean(busy)} onClick={() => fileInputRef.current?.click()} />
              <span className="toolbar-divider" />
              <ToolbarButton icon={WandSparkles} label={t('toolbar.analyzeStory')} testId="toolbar-analyze-story" disabled={!canRun} onClick={studio.handleAnalyzeStory} />
              <ToolbarButton icon={Play} label={t('toolbar.generatePage')} testId="toolbar-generate-page" priority="primary" disabled={!canRun || !activePage} onClick={studio.handleGenerateActivePage} />
              <ToolbarButton icon={Sparkles} label={t('toolbar.generateAll')} testId="toolbar-generate-all" priority="primary" disabled={!canRun} onClick={studio.handleGenerateAll} />
              <span className="toolbar-divider" />
              <ToolbarButton icon={Undo2} label={t('toolbar.undo')} testId="toolbar-undo" variant="ghost" iconOnly disabled={!canUndo || Boolean(busy)} onClick={studio.handleUndo} />
              <ToolbarButton icon={Redo2} label={t('toolbar.redo')} testId="toolbar-redo" variant="ghost" iconOnly disabled={!canRedo || Boolean(busy)} onClick={studio.handleRedo} />
              <ToolbarButton icon={CircleStop} label={t('toolbar.cancel')} testId="toolbar-cancel-job" variant="ghost" iconOnly disabled={!currentJobId} onClick={studio.handleCancelCurrentJob} />
              <span className="toolbar-divider" />
              <ToolbarButton icon={Eye} label={t('toolbar.reader')} testId="toolbar-reader" iconOnly disabled={!detail?.pages.length} onClick={() => setReaderOpen(true)} />
              <ToolbarButton icon={Download} label={t('toolbar.exportZip')} testId="toolbar-export-zip" iconOnly disabled={!canRun || !detail?.pages.length} onClick={studio.handleExportZip} />
              <ToolbarButton icon={Archive} label={t('toolbar.exportCbz')} testId="toolbar-export-cbz" iconOnly disabled={!canRun || !detail?.pages.length} onClick={studio.handleExportCbz} />
              <ToolbarButton icon={FileText} label={t('toolbar.exportPdf')} testId="toolbar-export-pdf" iconOnly disabled={!canRun || !detail?.pages.length} onClick={studio.handleExportPdf} />
              <ToolbarButton icon={ImageDown} label={t('toolbar.exportPage')} testId="toolbar-export-page" iconOnly disabled={!canRun || !activePage} onClick={studio.handleExportActivePage} />
              <ToolbarButton icon={Save} label={t('toolbar.exportBackup')} testId="toolbar-export-backup" variant="ghost" iconOnly disabled={!canRun} onClick={studio.handleExportBackup} />
              <ToolbarButton icon={ArchiveRestore} label={t('toolbar.restoreBackup')} testId="toolbar-restore-backup" variant="ghost" iconOnly disabled={Boolean(busy)} onClick={() => backupInputRef.current?.click()} />
            </>
          ) : null}
        </div>
        <div className="topbar-controls">
          {updates.status?.latest?.available ? (
            <button
              type="button"
              className="update-badge"
              data-testid="update-badge"
              title={t('update.badgeTitle')}
              onClick={() => {
                setEntryMode('studio')
                setActiveTab('settings')
              }}
            >
              <Download size={14} />
              {t('update.badge', { version: updates.status.latest.version })}
            </button>
          ) : null}
          <div className="lang-switch" role="group" aria-label={t('header.language')}>
            <button type="button" className={locale === 'en' ? 'active' : ''} data-testid="lang-en" onClick={() => setLocale('en')}>
              EN
            </button>
            <button type="button" className={locale === 'zh-TW' ? 'active' : ''} data-testid="lang-zh" onClick={() => setLocale('zh-TW')}>
              中文
            </button>
          </div>
          <ToolbarButton icon={CircleHelp} label={t('header.openGuide')} testId="open-guide" variant="ghost" iconOnly onClick={() => setGuideOpen(true)} />
          <motion.button
            type="button"
            className="icon-button"
            data-testid="theme-toggle"
            title={theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
            aria-label={theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
            whileHover={{ rotate: 8, scale: 1.05 }}
            whileTap={{ rotate: -8, scale: 0.9 }}
            onClick={toggleTheme}
          >
            <MotionIcon icon={theme === 'dark' ? Sun : Moon} state={theme} size={16} spin={false} />
          </motion.button>
          <StudioStatus busy={busy} ready={t('status.ready')} />
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
          onChange={studio.handleLocalFiles}
        />
        <input
          ref={backupInputRef}
          id="project-backup-input"
          className="hidden-input"
          type="file"
          accept="application/zip,.zip"
          aria-label={t('header.projectBackupZip')}
          data-testid="project-backup-input"
          onChange={studio.handleBackupFile}
        />
      </header>

      {entryMode === 'continue' ? (
        <StoryContinuePanel disabled={Boolean(busy)} busyLabel={busy} runTask={studio.runTask} onLog={studio.pushLog} />
      ) : (
      <main className="workspace-grid">
        <aside className="left-rail panel">
          <OnboardingChecklist
            hasPages={Boolean(detail?.pages.length)}
            hasProvider={Boolean(
              secretStatus?.hasApiKey ||
                secretStatus?.apiBaseUrl ||
                providers.some((provider) => provider.hasApiKey || provider.isLocal),
            )}
            hasStoryBible={Boolean(detail?.project.storyBible)}
            hasDialogues={Boolean(detail?.dialogues.length)}
            hasExported={hasExported}
          />
          <form className="create-form" onSubmit={studio.handleCreateProject}>
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
              <motion.button
                layout
                key={project.id}
                type="button"
                className={`project-row ${project.id === selectedProjectId ? 'active' : ''}`}
                data-testid="project-row"
                data-project-id={project.id}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.985 }}
                transition={quickTransition}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <strong>{project.title}</strong>
                <span>
                  {t('studio.projectRowSummary', { source: t(sourceKeys[project.source]), mode: t(modeKeys[project.mode]) })}
                </span>
              </motion.button>
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
                pageCount={detail.pages.length}
                disabled={Boolean(busy)}
                onClick={() => setSelectedPageId(page.id)}
                onMoveUp={() => studio.handleMovePage(page.id, -1)}
                onMoveDown={() => studio.handleMovePage(page.id, 1)}
                onDelete={() => studio.handleDeletePage(page.id)}
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
            letteringDefaults={studio.letteringDefaults}
            zoom={zoom}
            onZoomChange={setZoom}
            selectedDialogueId={selectedDialogueId}
            onSelectDialogue={(id) => {
              setSelectedDialogueId(id)
              setActiveTab('dialogue')
            }}
            onPatchDialogue={studio.commitDialogue}
            onAddDialogue={(x, y) => studio.handleAddDialogue({ x, y })}
            batchProgress={batchProgress}
            onImportLocal={() => fileInputRef.current?.click()}
            onImportPixiv={() => setActiveTab('story')}
            onDropFiles={studio.importLocalFiles}
            onPatchPanels={(panels) => {
              if (activePage) void studio.handleSetPanels(activePage.id, panels)
            }}
            onPatchCleanup={(cleanupStrokes) => {
              if (activePage) void studio.handleSetCleanup(activePage.id, cleanupStrokes)
            }}
          />
        </section>

        <aside className="right-rail panel">
          <LayoutGroup id="inspector-tabs">
          <div className="inspector-tabs" role="tablist" aria-label={t('tab.inspectorPanels')}>
            {tabItems.map((item) => {
              const Icon = item.icon
              const label = t(item.labelKey)
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === item.id}
                  data-testid={`tab-${item.id}`}
                  className={activeTab === item.id ? 'active' : ''}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.94 }}
                  transition={quickTransition}
                  onClick={() => setActiveTab(item.id)}
                  title={label}
                >
                  {activeTab === item.id ? <ActiveIndicator layoutId="inspector-tab-active" className="inspector-tab-indicator" /> : null}
                  <motion.span
                    className="inspector-tab-icon"
                    animate={activeTab === item.id ? { scale: 1.08, y: -1 } : { scale: 1, y: 0 }}
                    transition={softSpring}
                  >
                    <Icon size={17} strokeWidth={1.9} />
                  </motion.span>
                  <span className="inspector-tab-label">{label}</span>
                </motion.button>
              )
            })}
          </div>
          </LayoutGroup>

          <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={activeTab}
            className="inspector-panel-transition"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={quickTransition}
          >
          {activeTab === 'story' && (
            <StoryPanel
              detail={detail}
              userBrief={studio.userBrief}
              setUserBrief={studio.setUserBrief}
              r18Enabled={studio.r18Enabled}
              setR18Enabled={studio.setR18Enabled}
              pixivUrl={studio.pixivUrl}
              setPixivUrl={studio.setPixivUrl}
              onPixivImport={studio.handlePixivImport}
              onPixivBatchImported={studio.handlePixivBatchImported}
              onPixivBatchError={studio.handlePixivBatchError}
              onStoryBibleChange={studio.updateStoryBibleLocal}
              onStoryBibleCommit={studio.commitStoryBible}
              disabled={Boolean(busy)}
            />
          )}
          {activeTab === 'characters' && (
            <CharactersPanel
              storyBible={detail?.project.storyBible}
              customFonts={customFonts}
              disabled={Boolean(busy)}
              onUploadFont={studio.handleUploadFont}
              onDeleteFont={studio.handleDeleteCustomFont}
              onStoryBibleChange={studio.updateStoryBibleLocal}
              onStoryBibleCommit={studio.commitStoryBible}
            />
          )}
          {activeTab === 'dialogue' && (
            <DialoguePanel
              dialogues={activeDialogues}
              selectedDialogue={selectedDialogue}
              customFonts={customFonts}
              canAdd={Boolean(activePage) && !busy}
              canRegenerate={canRun}
              onAdd={() => studio.handleAddDialogue()}
              onDelete={studio.handleDeleteDialogue}
              onSelect={setSelectedDialogueId}
              onLocalChange={studio.updateDialogueLocal}
              onCommit={studio.commitDialogue}
              onRegenerate={studio.handleRegenerateDialogue}
            />
          )}
          {activeTab === 'layout' && (
            <LayoutPanel
              mode={studio.generateMode}
              setMode={studio.setGenerateMode}
              textDensity={studio.textDensity}
              setTextDensity={studio.setTextDensity}
              zoom={zoom}
              setZoom={setZoom}
              pageCount={detail?.pages.length || 0}
              rangeFrom={studio.rangeFromInput}
              rangeTo={studio.rangeToInput}
              setRangeFrom={studio.setRangeFromInput}
              setRangeTo={studio.setRangeToInput}
              onGenerateRange={studio.handleGenerateRange}
              readingDirection={detail?.project.readingDirection}
              onReadingDirectionChange={studio.handleSetReadingDirection}
              selectedDialogue={selectedDialogue}
              onCommit={studio.commitDialogue}
              onAvoidOverlap={studio.handleAvoidOverlap}
              disabled={Boolean(busy)}
            />
          )}
          {activeTab === 'settings' && (
            <div className="connection-workspace">
              <LayoutGroup id="connection-mode">
              <div className="connection-mode-switch" role="tablist" aria-label={t('settings.connectionMode')}>
                <motion.button type="button" role="tab" aria-selected={connectionMode === 'local'} className={connectionMode === 'local' ? 'active' : ''} whileTap={{ scale: 0.97 }} onClick={() => setConnectionMode('local')} data-testid="connection-mode-local">
                  {connectionMode === 'local' ? <ActiveIndicator layoutId="connection-mode-active" className="switch-indicator" /> : null}
                  <span className="switch-label">{t('settings.modeLocal')}</span>
                </motion.button>
                <motion.button type="button" role="tab" aria-selected={connectionMode === 'external'} className={connectionMode === 'external' ? 'active' : ''} whileTap={{ scale: 0.97 }} onClick={() => setConnectionMode('external')} data-testid="connection-mode-external">
                  {connectionMode === 'external' ? <ActiveIndicator layoutId="connection-mode-active" className="switch-indicator" /> : null}
                  <span className="switch-label">{t('settings.modeExternal')}</span>
                </motion.button>
              </div>
              </LayoutGroup>
              <ProviderLabPanel key={connectionMode} secretStatus={secretStatus} providers={providers} onProvidersChanged={studio.setProviders} mode={connectionMode} />
              <SettingsPanel
                status={secretStatus}
                form={studio.settingsForm}
                setForm={studio.setSettingsForm}
                onSubmit={studio.handleSaveSettings}
                disabled={Boolean(busy)}
                mode={connectionMode}
                hasProviderConnection={providers.some((provider) => !provider.isLocal && provider.hasApiKey)}
              />
              <UpdatePanel updates={updates} />
              {detail ? (
                <LetteringDefaultsPanel
                  key={detail.project.id}
                  defaults={studio.letteringDefaults}
                  customFonts={customFonts}
                  disabled={Boolean(busy)}
                  onSave={studio.handleSaveLettering}
                  onColorByCharacter={studio.handleColorDialoguesByCharacter}
                />
              ) : null}
            </div>
          )}
          </motion.div>
          </AnimatePresence>
        </aside>
      </main>
      )}

      <footer className="log-panel" data-collapsed={logCollapsed}>
        <button
          type="button"
          className="log-toggle"
          aria-expanded={!logCollapsed}
          aria-label={t('logPanel.title')}
          onClick={() => setLogCollapsed((current) => !current)}
        >
          <RefreshCw size={16} />
          <span>{t('logPanel.title')}</span>
          {logCollapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {!logCollapsed ? (
          <>
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
          </>
        ) : null}
      </footer>

      {guideOpen ? <GuideModal onClose={() => setGuideOpen(false)} /> : null}

      <AnimatePresence>
        {readerOpen && detail?.pages.length ? (
          <ReaderOverlay detail={detail} initialPageIndex={activePage?.index ?? 0} onClose={() => setReaderOpen(false)} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ToolbarButton(props: {
  icon: ComponentType<IconProps>
  label: string
  testId: string
  priority?: 'primary'
  variant?: 'ghost'
  iconOnly?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const reducedMotion = useReducedMotion()
  const Icon = props.icon
  return (
    <motion.button
      type="button"
      className="toolbar-button"
      data-priority={props.priority || undefined}
      data-variant={props.variant || undefined}
      data-icon-only={props.iconOnly || undefined}
      disabled={props.disabled}
      whileHover={props.disabled || reducedMotion ? undefined : { y: -1 }}
      whileTap={props.disabled || reducedMotion ? undefined : { scale: 0.94, y: 0 }}
      transition={quickTransition}
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
    >
      <motion.span className="toolbar-icon-slot" whileHover={reducedMotion ? undefined : { rotate: -4, scale: 1.08 }}>
        <Icon size={16} strokeWidth={1.9} />
      </motion.span>
      {props.iconOnly ? <span className="toolbar-label sr-only">{props.label}</span> : <span className="toolbar-label">{props.label}</span>}
    </motion.button>
  )
}

function StudioStatus(props: { busy: string; ready: string }) {
  const reducedMotion = useReducedMotion()
  const isBusy = Boolean(props.busy)
  const label = props.busy || props.ready

  return (
    <motion.div
      layout
      className="status-pill"
      data-busy={isBusy}
      data-testid="studio-status"
      role="status"
      aria-live="polite"
      transition={reducedMotion ? { duration: 0 } : softSpring}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {isBusy ? (
          <motion.span key="busy" className="status-glyph" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
            <MotionIcon icon={Loader2} state="busy" size={15} spin />
          </motion.span>
        ) : (
          <motion.span key="ready" className="status-dot" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          className="status-label"
          initial={reducedMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
          transition={quickTransition}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  )
}

export default App
