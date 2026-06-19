import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentType, FormEvent } from 'react'
import {
  BookOpen,
  Download,
  ImagePlus,
  Images,
  Loader2,
  Lock,
  MessageSquare,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Upload,
  Users,
  WandSparkles,
  Unlock,
} from 'lucide-react'
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { Asset, BubbleStyle, Character, Dialogue, Page, Project, ProjectDetail, SecretStatus } from './shared/types'
import { estimateVerticalTextBox, resolveDialogueCollisions } from './shared/layout'
import { renderProjectPages } from './canvasExport'
import { ProviderLabPanel } from './ProviderLabPanel'
import * as api from './api'

type InspectorTab = 'story' | 'characters' | 'dialogue' | 'layout' | 'settings'
type LogLevel = 'info' | 'success' | 'error'

interface LogEntry {
  id: string
  time: string
  level: LogLevel
  message: string
}

const tabItems: Array<{ id: InspectorTab; label: string; icon: ComponentType<IconProps> }> = [
  { id: 'story', label: 'Story Bible', icon: BookOpen },
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'dialogue', label: 'Dialogue', icon: MessageSquare },
  { id: 'layout', label: 'Layout', icon: PanelRight },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const bubbleStyles: BubbleStyle[] = ['speech', 'soft', 'thought', 'caption']

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [selectedDialogueId, setSelectedDialogueId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<InspectorTab>('story')
  const [busy, setBusy] = useState<string>('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [createTitle, setCreateTitle] = useState('Untitled Manga')
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
        pushLog('Studio ready. Local database loaded.', 'success')
      } catch (error) {
        pushLog(errorMessage(error), 'error')
      }
    }

    boot()
    return () => {
      cancelled = true
    }
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
      .catch((error) => pushLog(errorMessage(error), 'error'))
      .finally(() => {
        if (!cancelled) {
          setBusy('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedProjectId])

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
    setBusy(label)
    pushLog(label)
    try {
      await task()
    } catch (error) {
      pushLog(errorMessage(error), 'error')
    } finally {
      setBusy('')
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

  async function commitDialogue(id: string, patch: Partial<Dialogue>) {
    updateDialogueLocal(id, patch)
    try {
      const updated = await api.patchDialogue(id, patch)
      updateDialogueLocal(id, updated)
      pushLog('Dialogue saved.', 'success')
    } catch (error) {
      pushLog(errorMessage(error), 'error')
      if (detail) {
        acceptDetail(await api.getProject(detail.project.id))
      }
    }
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    await runTask('Creating project', async () => {
      const next = await api.createProject({ title: createTitle.trim() || 'Untitled Manga', mode: createMode })
      acceptDetail(next)
      pushLog('Project created.', 'success')
    })
  }

  async function handleLocalFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    if (!files.length) return

    await runTask('Importing local images', async () => {
      const next = await api.importLocal(files, detail?.project.id)
      acceptDetail(next)
      pushLog(`${files.length} image(s) imported.`, 'success')
    })
  }

  async function handlePixivImport(event: FormEvent) {
    event.preventDefault()
    if (!pixivUrl.trim()) {
      pushLog('Pixiv artwork URL or ID is required.', 'error')
      return
    }

    await runTask('Importing Pixiv artwork', async () => {
      const next = await api.importPixiv({
        projectId: detail?.project.id,
        url: pixivUrl.trim(),
        r18Enabled,
      })
      acceptDetail(next)
      setPixivUrl('')
      pushLog('Pixiv artwork imported.', 'success')
    })
  }

  async function handleAnalyzeStory() {
    if (!detail) return
    await runTask('Analyze Story', async () => {
      const next = await api.analyzeStory({ projectId: detail.project.id, userBrief, r18Enabled })
      acceptDetail(next)
      pushLog(next.usedMock ? 'Story Bible generated with local mock engine.' : 'Story Bible generated.', 'success')
    })
  }

  async function handleGenerateActivePage() {
    if (!activePage) return
    await runTask(`Generate Page ${activePage.index + 1}`, async () => {
      const next = await api.generatePage(activePage.id, { mode: generateMode, textDensity })
      acceptDetail(next)
      pushLog(`Page ${activePage.index + 1} dialogue generated.`, 'success')
    })
  }

  async function handleGenerateAll() {
    if (!detail) return
    await runTask('Generate All', async () => {
      for (const page of detail.pages) {
        pushLog(`Generating page ${page.index + 1}`)
        const next = await api.generatePage(page.id, { mode: generateMode, textDensity })
        acceptDetail(next)
      }
      pushLog('All pages generated.', 'success')
    })
  }

  async function handleAvoidOverlap() {
    if (!activePage || !activeDialogues.length) return
    await runTask('Resolving layout collisions', async () => {
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
      pushLog('Layout adjusted.', 'success')
    })
  }

  async function handleExportZip() {
    if (!detail) return
    await runTask('Export ZIP', async () => {
      const pages = await renderProjectPages(detail)
      if (!pages.length) {
        throw new Error('No pages to export')
      }
      const result = await api.exportZip({ projectId: detail.project.id, pages })
      pushLog(`Exported ${result.fileName}`, 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  async function handleExportBackup() {
    if (!detail) return
    await runTask('Export project backup', async () => {
      const result = await api.exportProjectBackup({ projectId: detail.project.id })
      pushLog(`Backup exported ${result.fileName}`, 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault()
    await runTask('Saving settings', async () => {
      const status = await api.saveSecrets({
        apiBaseUrl: settingsForm.apiBaseUrl,
        modelName: settingsForm.modelName,
        apiKey: settingsForm.apiKey,
        pixivCookie: settingsForm.pixivCookie,
      })
      setSecretStatus(status)
      setSettingsForm((current) => ({ ...current, apiKey: '', pixivCookie: '' }))
      pushLog('Settings saved to system credential store.', 'success')
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
            <span>{detail ? `${detail.pages.length} pages / ${detail.project.mode}` : 'Local creative workspace'}</span>
          </div>
        </div>
        <div className="toolbar">
          <ToolbarButton icon={ImagePlus} label="Import Pixiv" disabled={!canRun} onClick={() => setActiveTab('story')} />
          <ToolbarButton icon={Upload} label="Local Images" disabled={Boolean(busy)} onClick={() => fileInputRef.current?.click()} />
          <ToolbarButton icon={WandSparkles} label="Analyze Story" disabled={!canRun} onClick={handleAnalyzeStory} />
          <ToolbarButton icon={Play} label="Generate Page" disabled={!canRun || !activePage} onClick={handleGenerateActivePage} />
          <ToolbarButton icon={Sparkles} label="Generate All" disabled={!canRun} onClick={handleGenerateAll} />
          <ToolbarButton icon={Download} label="Export ZIP" disabled={!canRun || !detail?.pages.length} onClick={handleExportZip} />
          <ToolbarButton icon={Save} label="Export Backup" disabled={!canRun} onClick={handleExportBackup} />
        </div>
        <div className="status-pill" data-busy={Boolean(busy)}>
          {busy ? <Loader2 size={15} /> : <span />}
          {busy || 'Ready'}
        </div>
        <input ref={fileInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple onChange={handleLocalFiles} />
      </header>

      <main className="workspace-grid">
        <aside className="left-rail panel">
          <form className="create-form" onSubmit={handleCreateProject}>
            <div className="panel-heading">
              <Plus size={16} />
              <span>New Project</span>
            </div>
            <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} aria-label="Project title" />
            <div className="segmented">
              <button type="button" className={createMode === 'story' ? 'active' : ''} onClick={() => setCreateMode('story')}>
                Story
              </button>
              <button type="button" className={createMode === 'translation' ? 'active' : ''} onClick={() => setCreateMode('translation')}>
                Translation
              </button>
            </div>
            <button type="submit" className="primary-button" disabled={Boolean(busy)}>
              Create
            </button>
          </form>

          <section className="project-list">
            <div className="panel-heading">
              <Images size={16} />
              <span>Projects</span>
            </div>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`project-row ${project.id === selectedProjectId ? 'active' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <strong>{project.title}</strong>
                <span>{project.source} / {project.mode}</span>
              </button>
            ))}
          </section>

          <section className="page-list">
            <div className="panel-heading">
              <BookOpen size={16} />
              <span>Pages</span>
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
          <CanvasWorkspace
            page={activePage}
            asset={activeAsset}
            dialogues={activeDialogues}
            characters={detail?.characters || []}
            zoom={zoom}
            selectedDialogueId={selectedDialogueId}
            onSelectDialogue={(id) => {
              setSelectedDialogueId(id)
              setActiveTab('dialogue')
            }}
            onPatchDialogue={commitDialogue}
          />
        </section>

        <aside className="right-rail panel">
          <div className="inspector-tabs">
            {tabItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={activeTab === item.id ? 'active' : ''}
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
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
              disabled={Boolean(busy)}
            />
          )}
          {activeTab === 'characters' && <CharactersPanel characters={detail?.characters || []} />}
          {activeTab === 'dialogue' && (
            <DialoguePanel
              dialogues={activeDialogues}
              selectedDialogue={selectedDialogue}
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

      <footer className="log-panel">
        <div className="panel-heading">
          <RefreshCw size={16} />
          <span>Generation Log</span>
        </div>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="empty-text">No events yet.</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className={`log-row ${entry.level}`}>
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </footer>
    </div>
  )
}

function ToolbarButton(props: {
  icon: ComponentType<IconProps>
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button type="button" className="toolbar-button" disabled={props.disabled} onClick={props.onClick} title={props.label}>
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
  return (
    <button type="button" className={`page-thumb ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <div className="thumb-image">{props.asset ? <img src={props.asset.url} alt={`Page ${props.page.index + 1}`} /> : null}</div>
      <div>
        <strong>Page {props.page.index + 1}</strong>
        <span>{props.dialogueCount} lines / {props.page.status}</span>
      </div>
    </button>
  )
}

function CanvasWorkspace(props: {
  page?: Page
  asset?: Asset
  dialogues: Dialogue[]
  characters: Character[]
  zoom: number
  selectedDialogueId: string
  onSelectDialogue: (id: string) => void
  onPatchDialogue: (id: string, patch: Partial<Dialogue>) => Promise<void>
}) {
  const image = useLoadedImage(props.asset?.url)

  if (!props.page || !props.asset) {
    return (
      <div className="empty-canvas">
        <ImagePlus size={34} />
        <span>Import pages to start.</span>
      </div>
    )
  }

  const fitScale = Math.min(760 / props.page.width, 690 / props.page.height)
  const stageScale = fitScale * props.zoom
  const stageWidth = Math.round(props.page.width * stageScale)
  const stageHeight = Math.round(props.page.height * stageScale)

  return (
    <div className="canvas-wrap">
      <div className="canvas-meta">
        <span>Page {props.page.index + 1}</span>
        <span>{props.page.width}x{props.page.height}</span>
      </div>
      <div className="stage-shell">
        <Stage width={stageWidth} height={stageHeight}>
          <Layer>
            {image ? <KonvaImage image={image} width={stageWidth} height={stageHeight} /> : <Rect width={stageWidth} height={stageHeight} fill="#ffffff" />}
            {props.dialogues.map((dialogue) => (
              <BubbleNode
                key={dialogue.id}
                dialogue={dialogue}
                stageWidth={stageWidth}
                stageHeight={stageHeight}
                character={props.characters.find((character) => character.id === dialogue.characterId)}
                selected={dialogue.id === props.selectedDialogueId}
                onSelect={() => props.onSelectDialogue(dialogue.id)}
                onDragEnd={(x, y) => props.onPatchDialogue(dialogue.id, { x, y })}
              />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}

function BubbleNode(props: {
  dialogue: Dialogue
  character?: Character
  stageWidth: number
  stageHeight: number
  selected: boolean
  onSelect: () => void
  onDragEnd: (x: number, y: number) => void
}) {
  const box = estimateVerticalTextBox(props.dialogue)
  const fontSize = Math.max(15, Math.round(19 * props.dialogue.scale))
  const columns = toVerticalColumns(props.dialogue.text, 11)
  const bubbleWidth = Math.max(box.width * props.stageWidth, columns.length * fontSize * 1.18 + 34)
  const bubbleHeight = Math.max(
    box.height * props.stageHeight,
    Math.max(...columns.map((column) => column.length), 1) * fontSize * 1.1 + 38,
  )
  const stroke = props.selected ? '#c9282d' : props.dialogue.color || props.character?.color || '#111111'
  const fill = props.dialogue.bubbleStyle === 'caption' ? 'rgba(255,255,255,0.9)' : '#ffffff'

  return (
    <Group
      x={props.dialogue.x * props.stageWidth}
      y={props.dialogue.y * props.stageHeight}
      rotation={props.dialogue.rotation}
      draggable={!props.dialogue.locked}
      onClick={props.onSelect}
      onTap={props.onSelect}
      onDragEnd={(event) => {
        props.onDragEnd(clamp01(event.target.x() / props.stageWidth), clamp01(event.target.y() / props.stageHeight))
      }}
    >
      {props.dialogue.bubbleStyle === 'soft' || props.dialogue.bubbleStyle === 'thought' ? (
        <>
          <Ellipse radiusX={bubbleWidth / 2} radiusY={bubbleHeight / 2} fill={fill} stroke={stroke} strokeWidth={props.selected ? 4 : 2.5} />
          {props.dialogue.bubbleStyle === 'thought' ? (
            <Circle x={bubbleWidth * 0.3} y={bubbleHeight * 0.38} radius={5} fill="#ffffff" stroke={stroke} strokeWidth={2} />
          ) : null}
        </>
      ) : (
        <>
          <Rect
            x={-bubbleWidth / 2}
            y={-bubbleHeight / 2}
            width={bubbleWidth}
            height={bubbleHeight}
            fill={fill}
            stroke={stroke}
            strokeWidth={props.selected ? 4 : 2.5}
            cornerRadius={props.dialogue.bubbleStyle === 'caption' ? 4 : 12}
          />
          {props.dialogue.bubbleStyle === 'speech' ? (
            <Line
              points={[bubbleWidth * 0.2, bubbleHeight / 2 - 4, bubbleWidth * 0.32, bubbleHeight / 2 + 20, bubbleWidth * 0.04, bubbleHeight / 2 - 2]}
              closed
              fill="#ffffff"
              stroke={stroke}
              strokeWidth={2.5}
            />
          ) : null}
        </>
      )}
      {columns.map((column, index) => {
        const x = (columns.length / 2 - index - 0.5) * fontSize * 1.12
        return (
          <Text
            key={`${props.dialogue.id}-${index}`}
            x={x - fontSize / 2}
            y={-(column.length * fontSize * 1.1) / 2}
            width={fontSize}
            text={Array.from(column).join('\n')}
            fontFamily={props.character?.fontFamily || 'Noto Serif SC, SimSun, serif'}
            fontStyle="700"
            fontSize={fontSize}
            lineHeight={1.1}
            align="center"
            fill={props.dialogue.color || props.character?.color || '#111111'}
            listening={false}
          />
        )
      })}
    </Group>
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
  disabled: boolean
}) {
  const story = props.detail?.project.storyBible
  return (
    <div className="inspector-body">
      <form className="pixiv-form" onSubmit={props.onPixivImport}>
        <label>
          Pixiv Artwork URL / ID
          <input value={props.pixivUrl} onChange={(event) => props.setPixivUrl(event.target.value)} placeholder="https://www.pixiv.net/artworks/..." />
        </label>
        <button type="submit" className="secondary-button" disabled={props.disabled}>
          <ImagePlus size={15} />
          Import Pixiv
        </button>
      </form>

      <label className="field-block">
        User Brief
        <textarea value={props.userBrief} onChange={(event) => props.setUserBrief(event.target.value)} rows={5} placeholder="故事方向、角色关系、语气或限制..." />
      </label>

      <label className="toggle-row danger">
        <input type="checkbox" checked={props.r18Enabled} onChange={(event) => props.setR18Enabled(event.target.checked)} />
        <span>R-18 enabled locally</span>
      </label>

      {story ? (
        <div className="story-readout">
          <h2>{story.synopsis}</h2>
          <p>{story.tone}</p>
          <div className="beat-list">
            {story.pageBeats.map((beat) => (
              <div key={`${beat.pageIndex}-${beat.summary}`} className="beat-row">
                <strong>P{beat.pageIndex + 1}</strong>
                <span>{beat.summary}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty-text">Run Analyze Story to create the Story Bible.</p>
      )}
    </div>
  )
}

function CharactersPanel(props: { characters: Character[] }) {
  return (
    <div className="inspector-body">
      {props.characters.length ? (
        props.characters.map((character) => (
          <div key={character.id} className="character-row">
            <span className="swatch" style={{ background: character.color }} />
            <div>
              <strong>{character.name}</strong>
              <p>{character.description}</p>
              <small>{character.voice}</small>
            </div>
          </div>
        ))
      ) : (
        <p className="empty-text">No characters yet.</p>
      )}
    </div>
  )
}

function DialoguePanel(props: {
  dialogues: Dialogue[]
  selectedDialogue?: Dialogue
  onSelect: (id: string) => void
  onLocalChange: (id: string, patch: Partial<Dialogue>) => void
  onCommit: (id: string, patch: Partial<Dialogue>) => void
}) {
  const dialogue = props.selectedDialogue
  return (
    <div className="inspector-body">
      <div className="dialogue-stack">
        {props.dialogues.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dialogue-chip ${item.id === dialogue?.id ? 'active' : ''}`}
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
            Text
            <textarea
              value={dialogue.text}
              rows={5}
              onChange={(event) => props.onLocalChange(dialogue.id, { text: event.target.value })}
              onBlur={() => props.onCommit(dialogue.id, { text: dialogue.text })}
            />
          </label>
          <label>
            Character
            <input
              value={dialogue.characterName || ''}
              onChange={(event) => props.onLocalChange(dialogue.id, { characterName: event.target.value })}
              onBlur={() => props.onCommit(dialogue.id, { characterName: dialogue.characterName })}
            />
          </label>
          <div className="two-col">
            <label>
              Color
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
              Bubble
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
                    {style}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => props.onCommit(dialogue.id, dialogue.locked ? { locked: false } : { locked: true })}
          >
            {dialogue.locked ? <Unlock size={15} /> : <Lock size={15} />}
            {dialogue.locked ? 'Unlock' : 'Lock'}
          </button>
        </div>
      ) : (
        <p className="empty-text">Generate or select dialogue.</p>
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
  const dialogue = props.selectedDialogue
  return (
    <div className="inspector-body">
      <div className="segmented">
        <button type="button" className={props.mode === 'story' ? 'active' : ''} onClick={() => props.setMode('story')}>
          Story
        </button>
        <button type="button" className={props.mode === 'translation' ? 'active' : ''} onClick={() => props.setMode('translation')}>
          Translation
        </button>
      </div>
      <label className="range-row">
        <span>Text density</span>
        <input type="range" min="0" max="1" step="0.05" value={props.textDensity} onChange={(event) => props.setTextDensity(Number(event.target.value))} />
        <strong>{props.textDensity.toFixed(2)}</strong>
      </label>
      <label className="range-row">
        <span>Canvas zoom</span>
        <input type="range" min="0.65" max="1.45" step="0.05" value={props.zoom} onChange={(event) => props.setZoom(Number(event.target.value))} />
        <strong>{Math.round(props.zoom * 100)}%</strong>
      </label>
      <button type="button" className="secondary-button" disabled={props.disabled} onClick={props.onAvoidOverlap}>
        <PanelRight size={15} />
        Avoid overlap
      </button>

      {dialogue ? (
        <div className="edit-form compact">
          <div className="two-col">
            <NumberField label="X" value={dialogue.x} min={0} max={1} step={0.01} onCommit={(x) => props.onCommit(dialogue.id, { x })} />
            <NumberField label="Y" value={dialogue.y} min={0} max={1} step={0.01} onCommit={(y) => props.onCommit(dialogue.id, { y })} />
          </div>
          <div className="two-col">
            <NumberField label="Scale" value={dialogue.scale} min={0.5} max={2.5} step={0.05} onCommit={(scale) => props.onCommit(dialogue.id, { scale })} />
            <NumberField label="Rotation" value={dialogue.rotation} min={-45} max={45} step={1} onCommit={(rotation) => props.onCommit(dialogue.id, { rotation })} />
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
        onBlur={(event) => props.onCommit(clamp(Number(event.target.value), props.min, props.max))}
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
  const update = (patch: Partial<typeof props.form>) => props.setForm({ ...props.form, ...patch })
  return (
    <form className="inspector-body settings-form" onSubmit={props.onSubmit}>
      <div className={`credential-status ${props.status?.keychainAvailable ? 'ok' : 'blocked'}`}>
        <strong>{props.status?.keychainAvailable ? 'System keychain available' : 'System keychain blocked'}</strong>
        <span>API key: {props.status?.hasApiKey ? 'saved' : 'not saved'} / Pixiv cookie: {props.status?.hasPixivCookie ? 'saved' : 'not saved'}</span>
      </div>
      <label>
        OpenAI-compatible Base URL
        <input value={props.form.apiBaseUrl} onChange={(event) => update({ apiBaseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
      </label>
      <label>
        Model
        <input value={props.form.modelName} onChange={(event) => update({ modelName: event.target.value })} placeholder="gpt-4.1-mini" />
      </label>
      <label>
        API Key
        <input type="password" value={props.form.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={props.status?.hasApiKey ? 'Saved in keychain' : 'Not saved'} />
      </label>
      <label>
        Pixiv Cookie
        <textarea value={props.form.pixivCookie} onChange={(event) => update({ pixivCookie: event.target.value })} rows={4} placeholder={props.status?.hasPixivCookie ? 'Saved in keychain' : 'Required for private/R-18 imports'} />
      </label>
      <button type="submit" className="primary-button" disabled={props.disabled || props.status?.keychainAvailable === false}>
        <Save size={15} />
        Save Settings
      </button>
    </form>
  )
}

function useLoadedImage(src?: string) {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null)

  useEffect(() => {
    if (!src) {
      return
    }

    let cancelled = false
    const next = new Image()
    next.onload = () => {
      if (!cancelled) setLoaded({ src, image: next })
    }
    next.onerror = () => {
      if (!cancelled) setLoaded(null)
    }
    next.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  return loaded && loaded.src === src ? loaded.image : null
}

function toVerticalColumns(text: string, rowsPerColumn: number): string[] {
  const chars = Array.from(text.replace(/\s+/g, ''))
  const columns: string[] = []
  for (let index = 0; index < chars.length; index += rowsPerColumn) {
    columns.push(chars.slice(index, index + rowsPerColumn).join(''))
  }
  return columns.length ? columns : ['']
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function cryptoId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
}

interface IconProps {
  size?: number
  strokeWidth?: number
}

export default App
