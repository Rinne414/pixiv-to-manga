import { useCallback, useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { Frame, ImagePlus, Loader2, Minus, Plus, Scan, Upload } from 'lucide-react'
import type { Asset, Character, Dialogue, Page } from './shared/types'
import type { BatchProgress } from './useStudio'
import { computeTailTriangle, computeThoughtTrail, dialogueTailLocal, tailLocalToPage } from './shared/bubbleTail'
import { findDialogueCharacter } from './shared/characters'
import { DEFAULT_DIALOGUE_FONT } from './fonts'
import { clamp, clamp01, estimateVerticalTextBox } from './shared/layout'
import { toVerticalColumns, toVerticalGlyphs } from './shared/text'
import { useI18n } from './i18n/context'

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
  zoom: number
  onZoomChange: (zoom: number) => void
  selectedDialogueId: string
  onSelectDialogue: (id: string) => void
  onPatchDialogue: (id: string, patch: Partial<Dialogue>) => Promise<void>
  onAddDialogue: (x: number, y: number) => void
  batchProgress?: BatchProgress | null
  onImportLocal?: () => void
  onImportPixiv?: () => void
}

/**
 * Infinite pan/zoom whiteboard: the manga page sits on a draggable stage,
 * wheel zoom anchors at the cursor, and dialogue bubbles stay editable.
 */
export function WhiteboardCanvas(props: WhiteboardCanvasProps) {
  const { t } = useI18n()
  const { onZoomChange } = props
  // Callback ref: the whiteboard div mounts only after a page exists, so a
  // mount-time effect with a plain ref would never see it.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<ViewOffset>({ x: 0, y: 0 })
  const prevZoomRef = useRef(props.zoom)
  const fittedPageRef = useRef('')
  const image = useLoadedImage(props.asset?.url)

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
    if (fittedPageRef.current === props.page.id) return
    fittedPageRef.current = props.page.id
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

  // Double-clicking (or double-tapping) the page/background — not a bubble — drops a new dialogue there.
  function handleStageDblClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
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
    props.onZoomChange(next)
  }

  if (!props.page || !props.asset) {
    return (
      <div className="empty-canvas">
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
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      {viewport.width > 0 && viewport.height > 0 ? (
        <Stage
          width={viewport.width}
          height={viewport.height}
          x={view.x}
          y={view.y}
          scaleX={props.zoom}
          scaleY={props.zoom}
          draggable
          onWheel={handleWheel}
          onDblClick={handleStageDblClick}
          onDblTap={handleStageDblClick}
          onDragMove={handleStageDragMove}
          onDragEnd={handleStageDragEnd}
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
            {props.dialogues.map((dialogue) => (
              <BubbleNode
                key={dialogue.id}
                dialogue={dialogue}
                pageWidth={page.width}
                pageHeight={page.height}
                zoom={props.zoom}
                character={findDialogueCharacter(props.characters, dialogue)}
                selected={dialogue.id === props.selectedDialogueId}
                onSelect={() => props.onSelectDialogue(dialogue.id)}
                onDragEnd={(x, y) => props.onPatchDialogue(dialogue.id, { x, y })}
                onTailChange={(tailX, tailY) => props.onPatchDialogue(dialogue.id, { tailX, tailY })}
              />
            ))}
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

      <div className="whiteboard-controls">
        <button type="button" title={t('whiteboard.zoomOut')} aria-label={t('whiteboard.zoomOut')} onClick={() => zoomBy(-1)}>
          <Minus size={15} />
        </button>
        <span className="whiteboard-zoom-readout" data-testid="whiteboard-zoom">
          {Math.round(props.zoom * 100)}%
        </span>
        <button type="button" title={t('whiteboard.zoomIn')} aria-label={t('whiteboard.zoomIn')} onClick={() => zoomBy(1)}>
          <Plus size={15} />
        </button>
        <button
          type="button"
          title={t('whiteboard.fitPage')}
          aria-label={t('whiteboard.fitPage')}
          data-testid="whiteboard-fit"
          onClick={() => fitPage(page, viewport.width, viewport.height)}
        >
          <Scan size={15} />
        </button>
        <button
          type="button"
          title={t('whiteboard.actualSize')}
          aria-label={t('whiteboard.actualSize')}
          onClick={() => props.onZoomChange(clamp(1, WHITEBOARD_MIN_ZOOM, WHITEBOARD_MAX_ZOOM))}
        >
          <Frame size={15} />
        </button>
      </div>

      {props.batchProgress ? (
        <div className="canvas-progress" role="status" aria-live="polite">
          <Loader2 size={15} />
          <span>{t('canvas.generating', { current: props.batchProgress.current + 1, total: props.batchProgress.total })}</span>
        </div>
      ) : null}
    </div>
  )
}

function BubbleNode(props: {
  dialogue: Dialogue
  character?: Character
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
  const box = estimateVerticalTextBox(props.dialogue)
  const fontSize = Math.max(16, Math.round(34 * props.dialogue.scale))
  const columns = toVerticalColumns(props.dialogue.text, 11)
  const textWidth = Math.max(1, columns.length) * fontSize * 1.25
  const textHeight = Math.max(...columns.map((column) => column.length), 1) * fontSize * 1.08
  const bubbleWidth = Math.max(box.width * props.pageWidth, textWidth + 52)
  const bubbleHeight = Math.max(box.height * props.pageHeight, textHeight + 56)
  const stroke = props.selected ? '#c9282d' : props.dialogue.color || props.character?.color || '#111111'
  const fill = props.dialogue.bubbleStyle === 'caption' ? 'rgba(255,255,255,0.92)' : '#ffffff'
  const strokeWidth = props.selected ? 9 : 6
  const tailTip = tailDraft ?? dialogueTailLocal(props.dialogue, props.pageWidth, props.pageHeight)
  const tailTriangle =
    tailTip && (props.dialogue.bubbleStyle === 'speech' || props.dialogue.bubbleStyle === 'soft')
      ? computeTailTriangle({
          bubbleWidth,
          bubbleHeight,
          bubbleStyle: props.dialogue.bubbleStyle,
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
      {props.dialogue.bubbleStyle === 'soft' || props.dialogue.bubbleStyle === 'thought' ? (
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
            cornerRadius={props.dialogue.bubbleStyle === 'caption' ? 6 : 12}
          />
          {props.dialogue.bubbleStyle === 'speech' ? (
            tailTriangle ? (
              <Line points={[...tailTriangle.points]} closed fill="#ffffff" stroke={stroke} strokeWidth={5} />
            ) : (
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
            )
          ) : null}
        </>
      )}
      {props.selected && props.dialogue.bubbleStyle !== 'caption' ? (
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
      {columns.map((column, index) => {
        const x = (columns.length / 2 - index - 0.5) * fontSize * 1.15
        return (
          <Text
            key={`${props.dialogue.id}-${index}`}
            x={x - fontSize / 2}
            y={-(column.length * fontSize * 1.08) / 2}
            width={fontSize}
            text={Array.from(toVerticalGlyphs(column)).join('\n')}
            fontFamily={props.character?.fontFamily || DEFAULT_DIALOGUE_FONT}
            fontStyle="700"
            fontSize={fontSize}
            lineHeight={1.08}
            align="center"
            fill={props.dialogue.color || props.character?.color || '#111111'}
            listening={false}
          />
        )
      })}
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
