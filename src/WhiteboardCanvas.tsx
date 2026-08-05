import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type Konva from 'konva'
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { Brush, Eraser, Frame, Grid3X3, ImagePlus, LayoutGrid, Loader2, Minus, Plus, Scan, Trash2, Upload, X } from 'lucide-react'
import type { Asset, Character, CleanupStroke, Dialogue, LetteringDefaults, Page, PanelBox } from './shared/types'
import type { BatchProgress } from './useStudio'
import { computeShoutPoints, WHISPER_DASH } from './shared/bubbleShapes'
import { computeTailTriangle, computeThoughtTrail, dialogueTailLocal, tailLocalToPage } from './shared/bubbleTail'
import { findDialogueCharacter } from './shared/characters'
import { DEFAULT_DIALOGUE_FONT } from './fonts'
import { clamp, clamp01, dialogueFontScale, estimateVerticalTextBox } from './shared/layout'
import { toVerticalColumns, toVerticalGlyphs } from './shared/text'
import { useI18n } from './i18n/context'
import { ActiveIndicator, MotionIcon } from './MotionUI'
import { softSpring } from './motionTokens'
import { eraseCleanupStrokes } from './shared/cleanup'

export const WHITEBOARD_MIN_ZOOM = 0.1
export const WHITEBOARD_MAX_ZOOM = 4

const FIT_MARGIN = 48
const WHEEL_ZOOM_FACTOR = 1.08
const GRID_BASE_SIZE = 28

interface ViewOffset {
  x: number
  y: number
}

interface WhiteboardCanvasProps {
  page?: Page
  asset?: Asset
  dialogues: Dialogue[]
  characters: Character[]
  letteringDefaults?: LetteringDefaults
  zoom: number
  onZoomChange: (zoom: number) => void
  selectedDialogueId: string
  onSelectDialogue: (id: string) => void
  onPatchDialogue: (id: string, patch: Partial<Dialogue>) => Promise<void>
  onAddDialogue: (x: number, y: number) => void
  batchProgress?: BatchProgress | null
  onImportLocal?: () => void
  onImportPixiv?: () => void
  onDropFiles?: (files: File[]) => void
  onPatchPanels?: (panels: PanelBox[]) => void
  onPatchCleanup?: (cleanupStrokes: CleanupStroke[]) => void
}

/**
 * Infinite pan/zoom whiteboard: the manga page sits on a draggable stage,
 * wheel zoom anchors at the cursor, and dialogue bubbles stay editable.
 */
export function WhiteboardCanvas(props: WhiteboardCanvasProps) {
  const { t } = useI18n()
  const { onZoomChange, onDropFiles } = props
  // Callback ref: the whiteboard div mounts only after a page exists, so a
  // mount-time effect with a plain ref would never see it.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<ViewOffset>({ x: 0, y: 0 })
  const [isDragOver, setIsDragOver] = useState(false)
  // Panel-frame editing: drag draws a frame, badges delete; panning is paused meanwhile.
  const [panelMode, setPanelMode] = useState(false)
  const [panelDraft, setPanelDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [cleanupTool, setCleanupTool] = useState<'mosaic' | 'paint' | 'erase' | null>(null)
  const [cleanupDraft, setCleanupDraft] = useState<CleanupStroke | null>(null)
  const [cleanupSize, setCleanupSize] = useState(48)
  const [cleanupIntensity, setCleanupIntensity] = useState(0.85)
  const [cleanupColor, setCleanupColor] = useState('#ffffff')
  const prevZoomRef = useRef(props.zoom)
  const fittedPageRef = useRef('')
  const fittedViewportRef = useRef({ width: 0, height: 0 })
  const image = useLoadedImage(props.asset?.url)

  // Shared drop-target behavior for both the empty state and the live whiteboard.
  const dropHandlers = onDropFiles
    ? {
        onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) {
            event.preventDefault()
            setIsDragOver(true)
          }
        },
        onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDragOver(false)
          }
        },
        onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
          event.preventDefault()
          setIsDragOver(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length) {
            onDropFiles(files)
          }
        },
      }
    : {}

  useEffect(() => {
    if (!container) return

    const applySize = () => {
      setViewport({ width: container.clientWidth, height: container.clientHeight })
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  const fitPage = useCallback(
    (page: Page, viewportWidth: number, viewportHeight: number) => {
      const scale = clamp(
        Math.min((viewportWidth - FIT_MARGIN * 2) / page.width, (viewportHeight - FIT_MARGIN * 2) / page.height),
        WHITEBOARD_MIN_ZOOM,
        WHITEBOARD_MAX_ZOOM,
      )
      prevZoomRef.current = scale
      setView({
        x: (viewportWidth - page.width * scale) / 2,
        y: (viewportHeight - page.height * scale) / 2,
      })
      onZoomChange(scale)
    },
    [onZoomChange],
  )

  // Auto-fit whenever a different page becomes active and the viewport is measured.
  useEffect(() => {
    if (!props.page || !viewport.width || !viewport.height) return
    const samePage = fittedPageRef.current === props.page.id
    const viewportChanged = fittedViewportRef.current.width !== viewport.width || fittedViewportRef.current.height !== viewport.height
    if (samePage && !viewportChanged) return
    fittedPageRef.current = props.page.id
    fittedViewportRef.current = viewport
    fitPage(props.page, viewport.width, viewport.height)
  }, [props.page, viewport, fitPage])

  // Zoom changes that arrive from outside (Layout slider) keep the viewport center stable.
  // Wheel zoom pre-writes prevZoomRef so this effect skips its own updates.
  useEffect(() => {
    const previous = prevZoomRef.current
    if (previous === props.zoom || !viewport.width || !viewport.height) return
    prevZoomRef.current = props.zoom
    const ratio = props.zoom / previous
    const centerX = viewport.width / 2
    const centerY = viewport.height / 2
    setView((current) => ({
      x: centerX - (centerX - current.x) * ratio,
      y: centerY - (centerY - current.y) * ratio,
    }))
  }, [props.zoom, viewport])

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault()
    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    // prevZoomRef always holds the latest applied zoom, so rapid wheel events in the
    // same frame compound correctly instead of reading a stale props.zoom.
    const oldScale = prevZoomRef.current
    const next = clamp(
      event.evt.deltaY > 0 ? oldScale / WHEEL_ZOOM_FACTOR : oldScale * WHEEL_ZOOM_FACTOR,
      WHITEBOARD_MIN_ZOOM,
      WHITEBOARD_MAX_ZOOM,
    )
    if (next === oldScale) return
    const ratio = next / oldScale
    prevZoomRef.current = next
    setView((current) => ({
      x: pointer.x - (pointer.x - current.x) * ratio,
      y: pointer.y - (pointer.y - current.y) * ratio,
    }))
    props.onZoomChange(next)
  }

  /** Pointer position in page-normalized coordinates, or null when unavailable. */
  function pagePointFromEvent(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): { x: number; y: number } | null {
    const stage = event.target.getStage()
    const page = props.page
    if (!stage || !page) return null
    const pointer = stage.getPointerPosition()
    if (!pointer) return null
    const worldX = (pointer.x - stage.x()) / stage.scaleX()
    const worldY = (pointer.y - stage.y()) / stage.scaleY()
    return { x: clamp01(worldX / page.width), y: clamp01(worldY / page.height) }
  }

  function handleCleanupMouseDown(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (!cleanupTool) return
    event.evt.preventDefault()
    const point = pagePointFromEvent(event)
    if (!point) return
    setCleanupDraft({
      mode: cleanupTool === 'erase' ? 'paint' : cleanupTool,
      points: [point],
      size: cleanupSize,
      intensity: cleanupIntensity,
      color: cleanupColor,
    })
  }

  function handleCleanupMouseMove(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (!cleanupTool || !cleanupDraft) return
    const point = pagePointFromEvent(event)
    if (!point) return
    setCleanupDraft((current) => (current ? { ...current, points: [...current.points, point] } : current))
  }

  function handleCleanupMouseUp(): void {
    if (!cleanupTool || !cleanupDraft || !props.page || !props.onPatchCleanup) return
    const points = cleanupDraft.points
    setCleanupDraft(null)
    if (points.length < 1) return
    const current = props.page.cleanupStrokes || []
    const next = cleanupTool === 'erase'
      ? eraseCleanupStrokes(current, points, cleanupSize / Math.max(props.page.width, props.page.height))
      : [...current, cleanupDraft]
    props.onPatchCleanup(next)
  }

  function handleCanvasMouseDown(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (cleanupTool) {
      handleCleanupMouseDown(event)
      return
    }
    handlePanelMouseDown(event)
  }

  function handleCanvasMouseMove(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (cleanupTool) {
      handleCleanupMouseMove(event)
      return
    }
    handlePanelMouseMove(event)
  }

  function handleCanvasMouseUp(): void {
    if (cleanupTool) {
      handleCleanupMouseUp()
      return
    }
    handlePanelMouseUp()
  }

  function handlePanelMouseDown(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!panelMode) return
    const point = pagePointFromEvent(event)
    if (point) {
      setPanelDraft({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
    }
  }

  function handlePanelMouseMove(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!panelMode || !panelDraft) return
    const point = pagePointFromEvent(event)
    if (point) {
      setPanelDraft((current) => (current ? { ...current, x1: point.x, y1: point.y } : current))
    }
  }

  function handlePanelMouseUp() {
    if (!panelMode || !panelDraft) return
    const box: PanelBox = {
      x: Math.min(panelDraft.x0, panelDraft.x1),
      y: Math.min(panelDraft.y0, panelDraft.y1),
      width: Math.abs(panelDraft.x1 - panelDraft.x0),
      height: Math.abs(panelDraft.y1 - panelDraft.y0),
    }
    setPanelDraft(null)
    if (box.width < 0.03 || box.height < 0.03 || !props.onPatchPanels) return
    props.onPatchPanels([...(props.page?.panels || []), box])
  }

  // Double-clicking (or double-tapping) the page/background — not a bubble — drops a new dialogue there.
  function handleStageDblClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (panelMode || cleanupTool) return
    const stage = event.target.getStage()
    const page = props.page
    if (!stage || !page) return
    // Bubble shapes live inside draggable Groups; page image/backdrop are direct Layer children.
    const isBackground = event.target === stage || event.target.getParent()?.getType() === 'Layer'
    if (!isBackground) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const worldX = (pointer.x - stage.x()) / stage.scaleX()
    const worldY = (pointer.y - stage.y()) / stage.scaleY()
    props.onAddDialogue(clamp01(worldX / page.width), clamp01(worldY / page.height))
  }

  // Sync during the drag (not just at the end) so the grid pans live and a mid-drag
  // re-render can't reconcile a stale stage position.
  function handleStageDragMove(event: Konva.KonvaEventObject<DragEvent>) {
    const stage = event.target.getStage()
    if (event.target !== stage || !stage) return
    setView({ x: stage.x(), y: stage.y() })
  }

  function handleStageDragEnd(event: Konva.KonvaEventObject<DragEvent>) {
    const stage = event.target.getStage()
    if (event.target !== stage || !stage) return
    setView({ x: stage.x(), y: stage.y() })
  }

  function zoomBy(direction: 1 | -1) {
    const oldScale = prevZoomRef.current
    const next = clamp(
      direction > 0 ? oldScale * WHEEL_ZOOM_FACTOR : oldScale / WHEEL_ZOOM_FACTOR,
      WHITEBOARD_MIN_ZOOM,
      WHITEBOARD_MAX_ZOOM,
    )
    if (next === oldScale) return
    const ratio = next / oldScale
    const centerX = viewport.width / 2
    const centerY = viewport.height / 2
    prevZoomRef.current = next
    setView((current) => ({
      x: centerX - (centerX - current.x) * ratio,
      y: centerY - (centerY - current.y) * ratio,
    }))
    props.onZoomChange(next)
  }

  function toggleCleanupTool(tool: 'mosaic' | 'paint' | 'erase'): void {
    setPanelMode(false)
    setCleanupTool((current) => (current === tool ? null : tool))
  }

  if (!props.page || !props.asset) {
    return (
      <div className="empty-canvas" data-drag-over={isDragOver} data-testid="empty-canvas" {...dropHandlers}>
        <ImagePlus size={40} />
        <strong className="empty-canvas-title">{t('canvas.emptyTitle')}</strong>
        <span className="empty-canvas-hint">{t('canvas.emptyHint')}</span>
        <div className="empty-canvas-actions">
          {props.onImportPixiv ? (
            <button type="button" className="primary-button" data-testid="empty-import-pixiv" onClick={props.onImportPixiv}>
              <ImagePlus size={15} />
              {t('toolbar.importPixiv')}
            </button>
          ) : null}
          {props.onImportLocal ? (
            <button type="button" className="secondary-button" data-testid="empty-import-local" onClick={props.onImportLocal}>
              <Upload size={15} />
              {t('toolbar.localImages')}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const page = props.page
  const gridSize = GRID_BASE_SIZE * props.zoom

  return (
    <div
      ref={setContainer}
      className="whiteboard"
      data-testid="manga-stage"
      data-drag-over={isDragOver}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: panelMode ? 'crosshair' : undefined,
      }}
      {...dropHandlers}
    >
      {viewport.width > 0 && viewport.height > 0 ? (
        <Stage
          width={viewport.width}
          height={viewport.height}
          x={view.x}
          y={view.y}
          scaleX={props.zoom}
          scaleY={props.zoom}
          draggable={!panelMode && !cleanupTool}
          onWheel={handleWheel}
          onDblClick={handleStageDblClick}
          onDblTap={handleStageDblClick}
          onDragMove={handleStageDragMove}
          onDragEnd={handleStageDragEnd}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        >
          <Layer>
            <Rect
              width={page.width}
              height={page.height}
              fill="#ffffff"
              shadowColor="rgba(15, 20, 30, 0.35)"
              shadowBlur={30 / props.zoom}
              shadowOffsetY={10 / props.zoom}
            />
            {image ? <KonvaImage image={image} width={page.width} height={page.height} /> : null}
            {(page.cleanupStrokes || []).map((stroke, index) => (
              <CleanupLine key={`cleanup-${index}`} stroke={stroke} pageWidth={page.width} pageHeight={page.height} zoom={props.zoom} />
            ))}
            {cleanupDraft ? (
              <CleanupLine
                stroke={cleanupDraft}
                pageWidth={page.width}
                pageHeight={page.height}
                zoom={props.zoom}
                preview={cleanupTool === 'erase'}
              />
            ) : null}
            {props.dialogues.map((dialogue, index) => (
              <BubbleNode
                key={dialogue.id}
                dialogue={dialogue}
                orderIndex={index}
                pageWidth={page.width}
                pageHeight={page.height}
                zoom={props.zoom}
                character={findDialogueCharacter(props.characters, dialogue)}
                letteringDefaults={props.letteringDefaults}
                selected={dialogue.id === props.selectedDialogueId}
                onSelect={() => props.onSelectDialogue(dialogue.id)}
                onDragEnd={(x, y) => props.onPatchDialogue(dialogue.id, { x, y })}
                onTailChange={(tailX, tailY) => props.onPatchDialogue(dialogue.id, { tailX, tailY })}
              />
            ))}
            {panelMode
              ? (page.panels || []).map((panel, index) => (
                  <Group key={`panel-${index}`}>
                    <Rect
                      x={panel.x * page.width}
                      y={panel.y * page.height}
                      width={panel.width * page.width}
                      height={panel.height * page.height}
                      stroke="#c9282d"
                      strokeWidth={3 / props.zoom}
                      dash={[12 / props.zoom, 8 / props.zoom]}
                      listening={false}
                    />
                    <Group
                      x={panel.x * page.width}
                      y={panel.y * page.height}
                      onClick={() => props.onPatchPanels?.((page.panels || []).filter((_, i) => i !== index))}
                      onTap={() => props.onPatchPanels?.((page.panels || []).filter((_, i) => i !== index))}
                    >
                      <Rect width={30 / props.zoom} height={30 / props.zoom} fill="#c9282d" cornerRadius={4 / props.zoom} />
                      <Text
                        width={30 / props.zoom}
                        height={30 / props.zoom}
                        text={String(index + 1)}
                        fontSize={17 / props.zoom}
                        fontStyle="700"
                        fill="#ffffff"
                        align="center"
                        verticalAlign="middle"
                      />
                    </Group>
                  </Group>
                ))
              : null}
            {panelMode && panelDraft ? (
              <Rect
                x={Math.min(panelDraft.x0, panelDraft.x1) * page.width}
                y={Math.min(panelDraft.y0, panelDraft.y1) * page.height}
                width={Math.abs(panelDraft.x1 - panelDraft.x0) * page.width}
                height={Math.abs(panelDraft.y1 - panelDraft.y0) * page.height}
                stroke="#c9282d"
                strokeWidth={2 / props.zoom}
                fill="rgba(201, 40, 45, 0.08)"
                listening={false}
              />
            ) : null}
          </Layer>
        </Stage>
      ) : null}

      <div className="canvas-meta">
        <span>{t('studio.pageLabel', { n: page.index + 1 })}</span>
        <span>
          {page.width}x{page.height}
        </span>
        <span className="canvas-hint">{t('whiteboard.hint')}</span>
      </div>

      <motion.div className="whiteboard-controls" layout transition={softSpring}>
        <motion.button type="button" title={t('whiteboard.zoomOut')} aria-label={t('whiteboard.zoomOut')} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.82 }} onClick={() => zoomBy(-1)}>
          <Minus size={15} />
        </motion.button>
        <span className="whiteboard-zoom-readout" data-testid="whiteboard-zoom">
          {Math.round(props.zoom * 100)}%
        </span>
        <motion.button type="button" title={t('whiteboard.zoomIn')} aria-label={t('whiteboard.zoomIn')} whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.82 }} onClick={() => zoomBy(1)}>
          <Plus size={15} />
        </motion.button>
        <motion.button
          type="button"
          title={t('whiteboard.fitPage')}
          aria-label={t('whiteboard.fitPage')}
          data-testid="whiteboard-fit"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.82 }}
          onClick={() => {
            fitPage(page, viewport.width, viewport.height)
          }}
        >
          <Scan size={15} />
        </motion.button>
        <motion.button
          type="button"
          title={t('whiteboard.actualSize')}
          aria-label={t('whiteboard.actualSize')}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.82 }}
          onClick={() => {
            props.onZoomChange(clamp(1, WHITEBOARD_MIN_ZOOM, WHITEBOARD_MAX_ZOOM))
          }}
        >
          <Frame size={15} />
        </motion.button>
        {props.onPatchPanels ? (
          <motion.button
            type="button"
            className={panelMode ? 'active' : ''}
            title={t('whiteboard.panelMode')}
            aria-label={t('whiteboard.panelMode')}
            aria-pressed={panelMode}
            data-testid="panel-mode-toggle"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.82 }}
            onClick={() => {
              setCleanupTool(null)
              setPanelMode((current) => !current)
            }}
          >
            {panelMode ? <ActiveIndicator layoutId="canvas-tool-active" className="canvas-tool-indicator" /> : null}
            <MotionIcon icon={panelMode ? X : LayoutGrid} state={panelMode ? 'close' : 'panels'} size={15} spin={false} />
          </motion.button>
        ) : null}
        {panelMode && (page.panels?.length || 0) > 0 ? (
          <motion.button
            type="button"
            title={t('whiteboard.clearPanels')}
            aria-label={t('whiteboard.clearPanels')}
            data-testid="panel-clear"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.82 }}
            onClick={() => props.onPatchPanels?.([])}
          >
            <Trash2 size={15} />
          </motion.button>
        ) : null}
        {props.onPatchCleanup ? (
          <>
            <motion.button
              type="button"
              className={cleanupTool === 'mosaic' ? 'active' : ''}
              title={t('whiteboard.cleanupMosaic')}
              aria-label={t('whiteboard.cleanupMosaic')}
              aria-pressed={cleanupTool === 'mosaic'}
              data-testid="cleanup-mosaic"
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.82 }}
              onClick={() => toggleCleanupTool('mosaic')}
            >
              {cleanupTool === 'mosaic' ? <ActiveIndicator layoutId="canvas-tool-active" className="canvas-tool-indicator" /> : null}
              <Grid3X3 size={15} />
            </motion.button>
            <motion.button
              type="button"
              className={cleanupTool === 'paint' ? 'active' : ''}
              title={t('whiteboard.cleanupPaint')}
              aria-label={t('whiteboard.cleanupPaint')}
              aria-pressed={cleanupTool === 'paint'}
              data-testid="cleanup-paint"
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.82 }}
              onClick={() => toggleCleanupTool('paint')}
            >
              {cleanupTool === 'paint' ? <ActiveIndicator layoutId="canvas-tool-active" className="canvas-tool-indicator" /> : null}
              <Brush size={15} />
            </motion.button>
            <motion.button
              type="button"
              className={cleanupTool === 'erase' ? 'active' : ''}
              title={t('whiteboard.cleanupErase')}
              aria-label={t('whiteboard.cleanupErase')}
              aria-pressed={cleanupTool === 'erase'}
              data-testid="cleanup-erase"
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.82 }}
              onClick={() => toggleCleanupTool('erase')}
            >
              {cleanupTool === 'erase' ? <ActiveIndicator layoutId="canvas-tool-active" className="canvas-tool-indicator" /> : null}
              <Eraser size={15} />
            </motion.button>
            {(page.cleanupStrokes?.length || 0) > 0 ? (
              <motion.button
                type="button"
                title={t('whiteboard.cleanupClear')}
                aria-label={t('whiteboard.cleanupClear')}
                data-testid="cleanup-clear"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.82 }}
                onClick={() => props.onPatchCleanup?.([])}
              >
                <Trash2 size={15} />
              </motion.button>
            ) : null}
          </>
        ) : null}
      </motion.div>

      {cleanupTool ? (
        <div className="cleanup-params" data-testid="cleanup-params">
          <label>
            <span>{t('whiteboard.cleanupSize')}</span>
            <input
              type="range"
              min="4"
              max="240"
              step="2"
              value={cleanupSize}
              aria-label={t('whiteboard.cleanupSize')}
              onChange={(event) => setCleanupSize(Number(event.target.value))}
            />
            <strong>{cleanupSize}px</strong>
          </label>
          <label>
            <span>{t('whiteboard.cleanupIntensity')}</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={cleanupIntensity}
              aria-label={t('whiteboard.cleanupIntensity')}
              onChange={(event) => setCleanupIntensity(Number(event.target.value))}
            />
            <strong>{Math.round(cleanupIntensity * 100)}%</strong>
          </label>
          <label className="cleanup-color-control">
            <span>{t('whiteboard.cleanupColor')}</span>
            <input type="color" value={cleanupColor} aria-label={t('whiteboard.cleanupColor')} onChange={(event) => setCleanupColor(event.target.value)} />
          </label>
        </div>
      ) : null}

      <AnimatePresence>
      {props.batchProgress ? (
        <motion.div className="canvas-progress" role="status" aria-live="polite" initial={{ opacity: 0, y: -10, scale: 0.88 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.9 }} transition={softSpring}>
          <MotionIcon icon={Loader2} state="generating" size={15} spin />
          <span>{t('canvas.generating', { current: props.batchProgress.current + 1, total: props.batchProgress.total })}</span>
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  )
}

function CleanupLine(props: {
  stroke: CleanupStroke
  pageWidth: number
  pageHeight: number
  zoom: number
  preview?: boolean
}) {
  const points = props.stroke.points.flatMap((point) => [point.x * props.pageWidth, point.y * props.pageHeight])
  const mosaic = props.stroke.mode === 'mosaic'
  return (
    <Line
      points={points}
      stroke={props.preview ? '#c9282d' : props.stroke.color}
      strokeWidth={props.stroke.size}
      opacity={props.preview ? 0.65 : props.stroke.intensity}
      lineCap="round"
      lineJoin="round"
      dash={mosaic ? [Math.max(6, props.stroke.size * 0.55), Math.max(4, props.stroke.size * 0.3)] : props.preview ? [12 / props.zoom, 8 / props.zoom] : undefined}
      listening={false}
    />
  )
}

function BubbleNode(props: {
  dialogue: Dialogue
  /** Position within the page's dialogue list; shown as a reading-order badge (editor only). */
  orderIndex: number
  character?: Character
  letteringDefaults?: LetteringDefaults
  pageWidth: number
  pageHeight: number
  zoom: number
  selected: boolean
  onSelect: () => void
  onDragEnd: (x: number, y: number) => void
  onTailChange: (tailX: number, tailY: number) => void
}) {
  // Live tail preview while the handle drags; committed on drag end.
  const [tailDraft, setTailDraft] = useState<{ x: number; y: number } | null>(null)
  // Geometry mirrors canvasExport.drawDialogue so the whiteboard is WYSIWYG with PNG export.
  const isSfx = props.dialogue.bubbleStyle === 'sfx'
  const isHorizontal = props.dialogue.textDirection === 'horizontal'
  const box = estimateVerticalTextBox(props.dialogue)
  const fontSize = Math.max(16, Math.round(34 * dialogueFontScale(props.dialogue)))
  // The kinsoku line breaker yields columns for vertical text and lines for horizontal.
  const columns = toVerticalColumns(props.dialogue.text, 11)
  const longestRun = Math.max(...columns.map((column) => column.length), 1)
  const textWidth = isHorizontal ? longestRun * fontSize * 1.06 : Math.max(1, columns.length) * fontSize * 1.25
  const textHeight = isHorizontal ? columns.length * fontSize * 1.35 : longestRun * fontSize * 1.08
  const fontFamily = props.dialogue.fontFamily || props.character?.fontFamily || DEFAULT_DIALOGUE_FONT
  const bubbleWidth = Math.max(box.width * props.pageWidth, textWidth + 52)
  const bubbleHeight = Math.max(box.height * props.pageHeight, textHeight + 56)
  const stroke = props.selected ? '#c9282d' : props.dialogue.color || props.character?.color || '#111111'
  const fill = props.dialogue.bubbleStyle === 'caption' ? 'rgba(255,255,255,0.92)' : '#ffffff'
  const strokeWidth = props.selected ? 9 : 6
  const tailTip = tailDraft ?? dialogueTailLocal(props.dialogue, props.pageWidth, props.pageHeight)
  const hasStraightTail =
    props.dialogue.bubbleStyle === 'speech' ||
    props.dialogue.bubbleStyle === 'soft' ||
    props.dialogue.bubbleStyle === 'shout' ||
    props.dialogue.bubbleStyle === 'whisper'
  const tailTriangle =
    tailTip && hasStraightTail
      ? computeTailTriangle({
          bubbleWidth,
          bubbleHeight,
          // Shout and whisper reuse the rectangular speech-tail geometry.
          bubbleStyle: props.dialogue.bubbleStyle === 'soft' ? 'soft' : 'speech',
          tipX: tailTip.x,
          tipY: tailTip.y,
        })
      : null
  const thoughtTrail =
    tailTip && props.dialogue.bubbleStyle === 'thought'
      ? computeThoughtTrail({ bubbleWidth, bubbleHeight, tipX: tailTip.x, tipY: tailTip.y })
      : null
  const tailHandle = tailTip ?? { x: bubbleWidth * 0.34, y: bubbleHeight / 2 + 34 }
  const tailHandleRadius = clamp(11 / props.zoom, 7, 36)

  return (
    <Group
      x={props.dialogue.x * props.pageWidth}
      y={props.dialogue.y * props.pageHeight}
      rotation={props.dialogue.rotation}
      draggable={!props.dialogue.locked}
      onClick={props.onSelect}
      onTap={props.onSelect}
      onDragEnd={(event) => {
        // dragend bubbles up from the draggable tail handle; only the Group's own drag moves the bubble.
        if (event.target !== event.currentTarget) return
        props.onDragEnd(clamp01(event.target.x() / props.pageWidth), clamp01(event.target.y() / props.pageHeight))
      }}
    >
      {isSfx ? (
        // Bubble-less SFX text: the transparent rect keeps the group clickable and
        // draggable; the dashed outline is the only selection affordance.
        <Rect
          x={-textWidth / 2 - 10}
          y={-textHeight / 2 - 10}
          width={textWidth + 20}
          height={textHeight + 20}
          fill="rgba(0,0,0,0)"
          stroke={props.selected ? '#c9282d' : undefined}
          strokeWidth={2}
          dash={[7, 5]}
        />
      ) : props.dialogue.bubbleStyle === 'shout' ? (
        <>
          <Line
            points={computeShoutPoints(bubbleWidth, bubbleHeight)}
            closed
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            lineJoin="miter"
          />
          {tailTriangle ? <Line points={[...tailTriangle.points]} closed fill="#ffffff" stroke={stroke} strokeWidth={5} /> : null}
        </>
      ) : props.dialogue.bubbleStyle === 'soft' || props.dialogue.bubbleStyle === 'thought' ? (
        <>
          <Ellipse radiusX={bubbleWidth / 2} radiusY={bubbleHeight / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
          {props.dialogue.bubbleStyle === 'thought' ? (
            thoughtTrail ? (
              thoughtTrail.map((dot, index) => (
                <Circle key={index} x={dot.x} y={dot.y} radius={dot.radius} fill="#ffffff" stroke={stroke} strokeWidth={5} />
              ))
            ) : (
              <Circle x={bubbleWidth * 0.28} y={bubbleHeight * 0.38} radius={12} fill="#ffffff" stroke={stroke} strokeWidth={5} />
            )
          ) : tailTriangle ? (
            <Line points={[...tailTriangle.points]} closed fill="#ffffff" stroke={stroke} strokeWidth={5} />
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
            strokeWidth={strokeWidth}
            dash={props.dialogue.bubbleStyle === 'whisper' ? WHISPER_DASH : undefined}
            cornerRadius={props.dialogue.bubbleStyle === 'caption' ? 6 : props.dialogue.bubbleStyle === 'whisper' ? 18 : 12}
          />
          {props.dialogue.bubbleStyle === 'speech' || props.dialogue.bubbleStyle === 'whisper' ? (
            tailTriangle ? (
              <Line
                points={[...tailTriangle.points]}
                closed
                fill="#ffffff"
                stroke={stroke}
                strokeWidth={5}
                dash={props.dialogue.bubbleStyle === 'whisper' ? WHISPER_DASH : undefined}
              />
            ) : props.dialogue.bubbleStyle === 'speech' ? (
              <Line
                points={[
                  bubbleWidth * 0.22,
                  bubbleHeight / 2 - 8,
                  bubbleWidth * 0.34,
                  bubbleHeight / 2 + 34,
                  bubbleWidth * 0.08,
                  bubbleHeight / 2 - 4,
                ]}
                closed
                fill="#ffffff"
                stroke={stroke}
                strokeWidth={5}
              />
            ) : null
          ) : null}
        </>
      )}
      {props.selected && props.dialogue.bubbleStyle !== 'caption' && !isSfx ? (
        <Circle
          x={tailHandle.x}
          y={tailHandle.y}
          radius={tailHandleRadius}
          fill="rgba(201, 40, 45, 0.25)"
          stroke="#c9282d"
          strokeWidth={2}
          draggable
          onDragMove={(event) => {
            event.cancelBubble = true
            setTailDraft({ x: event.target.x(), y: event.target.y() })
          }}
          onDragEnd={(event) => {
            event.cancelBubble = true
            const local = { x: event.target.x(), y: event.target.y() }
            setTailDraft(null)
            const pagePoint = tailLocalToPage(props.dialogue, local, props.pageWidth, props.pageHeight)
            props.onTailChange(clamp01(pagePoint.tailX), clamp01(pagePoint.tailY))
          }}
        />
      ) : null}
      <Group x={-bubbleWidth / 2} y={-bubbleHeight / 2} listening={false}>
        <Circle radius={12 / props.zoom} fill="rgba(17, 20, 27, 0.78)" />
        <Text
          x={-12 / props.zoom}
          y={-12 / props.zoom}
          width={24 / props.zoom}
          height={24 / props.zoom}
          text={String(props.orderIndex + 1)}
          fontSize={13 / props.zoom}
          fontStyle="700"
          fill="#ffffff"
          align="center"
          verticalAlign="middle"
        />
      </Group>
      {isHorizontal ? (
        <Text
          x={-textWidth / 2}
          y={-textHeight / 2}
          width={textWidth}
          text={columns.join('\n')}
          fontFamily={fontFamily}
          fontStyle="700"
          fontSize={fontSize}
          lineHeight={1.35}
          align="center"
          fill={props.dialogue.color || props.character?.color || '#111111'}
          stroke={isSfx ? props.letteringDefaults?.sfxStrokeColor || '#ffffff' : undefined}
          strokeWidth={isSfx ? Math.max(5, Math.round(fontSize * (props.letteringDefaults?.sfxStrokeWidth || 0.18))) : undefined}
          fillAfterStrokeEnabled={isSfx}
          lineJoin="round"
          listening={false}
        />
      ) : (
        columns.map((column, index) => {
          const x = (columns.length / 2 - index - 0.5) * fontSize * 1.15
          return (
            <Text
              key={`${props.dialogue.id}-${index}`}
              x={x - fontSize / 2}
              y={-(column.length * fontSize * 1.08) / 2}
              width={fontSize}
              text={Array.from(toVerticalGlyphs(column)).join('\n')}
              fontFamily={fontFamily}
              fontStyle="700"
              fontSize={fontSize}
              lineHeight={1.08}
              align="center"
              fill={props.dialogue.color || props.character?.color || '#111111'}
              stroke={isSfx ? props.letteringDefaults?.sfxStrokeColor || '#ffffff' : undefined}
              strokeWidth={isSfx ? Math.max(5, Math.round(fontSize * (props.letteringDefaults?.sfxStrokeWidth || 0.18))) : undefined}
              fillAfterStrokeEnabled={isSfx}
              lineJoin="round"
              listening={false}
            />
          )
        })
      )}
    </Group>
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
