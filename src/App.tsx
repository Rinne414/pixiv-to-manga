import { useState } from 'react'
import type { ComponentType } from 'react'
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Download,
  ArchiveRestore,
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
import { ProviderLabPanel } from './ProviderLabPanel'
import { StoryContinuePanel } from './StoryContinuePanel'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { CharactersPanel } from './panels/CharactersPanel'
import { DialoguePanel } from './panels/DialoguePanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { PageThumb } from './panels/PageThumb'
import { SettingsPanel } from './panels/SettingsPanel'
import { StoryPanel } from './panels/StoryPanel'
import { modeKeys, sourceKeys } from './panels/labels'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import { useTheme } from './theme'
import type { IconProps } from './uiUtils'
import { useStudio, type InspectorTab } from './useStudio'

const tabItems: Array<{ id: InspectorTab; labelKey: MessageKey; icon: ComponentType<IconProps> }> = [
  { id: 'story', labelKey: 'tab.story', icon: BookOpen },
  { id: 'characters', labelKey: 'tab.characters', icon: Users },
  { id: 'dialogue', labelKey: 'tab.dialogue', icon: MessageSquare },
  { id: 'layout', labelKey: 'tab.layout', icon: PanelRight },
  { id: 'settings', labelKey: 'tab.settings', icon: Settings },
]

function App() {
  const { locale, setLocale, t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const studio = useStudio()
  const [logCollapsed, setLogCollapsed] = useState(false)
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
              <span className="toolbar-divider" />
              <ToolbarButton icon={WandSparkles} label={t('toolbar.analyzeStory')} testId="toolbar-analyze-story" disabled={!canRun} onClick={studio.handleAnalyzeStory} />
              <ToolbarButton icon={Play} label={t('toolbar.generatePage')} testId="toolbar-generate-page" priority="primary" disabled={!canRun || !activePage} onClick={studio.handleGenerateActivePage} />
              <ToolbarButton icon={Sparkles} label={t('toolbar.generateAll')} testId="toolbar-generate-all" priority="primary" disabled={!canRun} onClick={studio.handleGenerateAll} />
              <span className="toolbar-divider" />
              <ToolbarButton icon={Undo2} label={t('toolbar.undo')} testId="toolbar-undo" variant="ghost" disabled={!canUndo || Boolean(busy)} onClick={studio.handleUndo} />
              <ToolbarButton icon={Redo2} label={t('toolbar.redo')} testId="toolbar-redo" variant="ghost" disabled={!canRedo || Boolean(busy)} onClick={studio.handleRedo} />
              <ToolbarButton icon={CircleStop} label={t('toolbar.cancel')} testId="toolbar-cancel-job" variant="ghost" disabled={!currentJobId} onClick={studio.handleCancelCurrentJob} />
              <span className="toolbar-divider" />
              <ToolbarButton icon={Download} label={t('toolbar.exportZip')} testId="toolbar-export-zip" disabled={!canRun || !detail?.pages.length} onClick={studio.handleExportZip} />
              <ToolbarButton icon={Archive} label={t('toolbar.exportCbz')} testId="toolbar-export-cbz" disabled={!canRun || !detail?.pages.length} onClick={studio.handleExportCbz} />
              <ToolbarButton icon={ImageDown} label={t('toolbar.exportPage')} testId="toolbar-export-page" disabled={!canRun || !activePage} onClick={studio.handleExportActivePage} />
              <ToolbarButton icon={Save} label={t('toolbar.exportBackup')} testId="toolbar-export-backup" variant="ghost" disabled={!canRun} onClick={studio.handleExportBackup} />
              <ToolbarButton icon={ArchiveRestore} label={t('toolbar.restoreBackup')} testId="toolbar-restore-backup" variant="ghost" disabled={Boolean(busy)} onClick={() => backupInputRef.current?.click()} />
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
              userBrief={studio.userBrief}
              setUserBrief={studio.setUserBrief}
              r18Enabled={studio.r18Enabled}
              setR18Enabled={studio.setR18Enabled}
              pixivUrl={studio.pixivUrl}
              setPixivUrl={studio.setPixivUrl}
              onPixivImport={studio.handlePixivImport}
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
              canAdd={Boolean(activePage) && !busy}
              onAdd={() => studio.handleAddDialogue()}
              onDelete={studio.handleDeleteDialogue}
              onSelect={setSelectedDialogueId}
              onLocalChange={studio.updateDialogueLocal}
              onCommit={studio.commitDialogue}
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
            <>
              <SettingsPanel
                status={secretStatus}
                form={studio.settingsForm}
                setForm={studio.setSettingsForm}
                onSubmit={studio.handleSaveSettings}
                disabled={Boolean(busy)}
              />
              <ProviderLabPanel secretStatus={secretStatus} providers={providers} onProvidersChanged={studio.setProviders} />
            </>
          )}
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
    </div>
  )
}

function ToolbarButton(props: {
  icon: ComponentType<IconProps>
  label: string
  testId: string
  priority?: 'primary'
  variant?: 'ghost'
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      className="toolbar-button"
      data-priority={props.priority || undefined}
      data-variant={props.variant || undefined}
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

export default App
