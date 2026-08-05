import { DEFAULT_DIALOGUE_FONT } from './fonts'
import { computeShoutPoints, WHISPER_DASH } from './shared/bubbleShapes'
import { computeTailTriangle, computeThoughtTrail, dialogueTailLocal } from './shared/bubbleTail'
import { findDialogueCharacter } from './shared/characters'
import { dialogueFontScale, estimateVerticalTextBox } from './shared/layout'
import { toVerticalColumns, toVerticalGlyphs } from './shared/text'
import type { Asset, Character, CleanupStroke, Dialogue, LetteringDefaults, Page, ProjectDetail } from './shared/types'

export async function renderProjectPages(detail: ProjectDetail): Promise<Array<{ pageId: string; dataUrl: string }>> {
  await waitForCustomFonts()
  const rendered: Array<{ pageId: string; dataUrl: string }> = []
  const assetsById = new Map(detail.assets.map((asset) => [asset.id, asset]))

  for (const page of detail.pages) {
    const asset = assetsById.get(page.originalAssetId)
    if (!asset) {
      continue
    }

    const dialogues = detail.dialogues.filter((dialogue) => dialogue.pageId === page.id)
    rendered.push({
      pageId: page.id,
      dataUrl: await renderPage(page, asset, dialogues, detail.characters, detail.project.letteringDefaults),
    })
  }

  return rendered
}

/** Renders one page to a PNG data URL, or null when the page/asset is missing. */
export async function renderPageToDataUrl(detail: ProjectDetail, pageId: string): Promise<string | null> {
  const page = detail.pages.find((item) => item.id === pageId)
  if (!page) {
    return null
  }
  const asset = detail.assets.find((item) => item.id === page.originalAssetId)
  if (!asset) {
    return null
  }
  await waitForCustomFonts()
  const dialogues = detail.dialogues.filter((dialogue) => dialogue.pageId === page.id)
  return renderPage(page, asset, dialogues, detail.characters, detail.project.letteringDefaults)
}

/** Uploaded fonts register asynchronously; exports must not rasterize before they load. */
async function waitForCustomFonts(): Promise<void> {
  try {
    await document.fonts?.ready
  } catch {
    // Font readiness is best-effort; export proceeds with fallback fonts.
  }
}

async function renderPage(
  page: Page,
  asset: Asset,
  dialogues: Dialogue[],
  characters: Character[],
  letteringDefaults?: LetteringDefaults,
): Promise<string> {
  const width = page.width || asset.width || 1200
  const height = page.height || asset.height || 1600
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)

  const image = await loadImage(asset.url)
  context.drawImage(image, 0, 0, width, height)
  drawCleanupStrokes(context, page.cleanupStrokes || [], width, height)

  for (const dialogue of dialogues) {
    const character = findDialogueCharacter(characters, dialogue)
    drawDialogue(context, dialogue, width, height, character?.fontFamily, letteringDefaults)
  }

  return canvas.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    image.src = src
  })
}

function drawDialogue(
  context: CanvasRenderingContext2D,
  dialogue: Dialogue,
  pageWidth: number,
  pageHeight: number,
  fontFamily?: string,
  letteringDefaults?: LetteringDefaults,
): void {
  const box = estimateVerticalTextBox(dialogue)
  const isSfx = dialogue.bubbleStyle === 'sfx'
  const isHorizontal = dialogue.textDirection === 'horizontal'
  const fontSize = Math.round(34 * dialogueFontScale(dialogue))
  // The kinsoku line breaker yields columns for vertical text and lines for horizontal.
  const columns = toVerticalColumns(dialogue.text, 11)
  const longestRun = Math.max(...columns.map((column) => column.length), 1)
  const textWidth = isHorizontal ? longestRun * fontSize * 1.06 : Math.max(1, columns.length) * fontSize * 1.25
  const textHeight = isHorizontal ? columns.length * fontSize * 1.35 : longestRun * fontSize * 1.08
  const bubbleWidth = Math.max(box.width * pageWidth, textWidth + 52)
  const bubbleHeight = Math.max(box.height * pageHeight, textHeight + 56)

  context.save()
  context.translate(dialogue.x * pageWidth, dialogue.y * pageHeight)
  context.rotate((dialogue.rotation * Math.PI) / 180)
  context.lineWidth = 6
  context.strokeStyle = dialogue.color || '#111111'
  context.fillStyle = dialogue.bubbleStyle === 'caption' ? 'rgba(255, 255, 255, 0.92)' : '#ffffff'
  if (dialogue.bubbleStyle === 'whisper') {
    context.setLineDash(WHISPER_DASH)
  }

  // Tail geometry lives in bubble-local space; unset tips keep the legacy fixed shapes.
  const tailTip = dialogueTailLocal(dialogue, pageWidth, pageHeight)
  if (isSfx) {
    // Bubble-less SFX text: no shape, no tail — glyphs draw with a white contour below.
  } else if (dialogue.bubbleStyle === 'shout') {
    const shoutPoints = computeShoutPoints(bubbleWidth, bubbleHeight)
    context.beginPath()
    context.moveTo(shoutPoints[0], shoutPoints[1])
    for (let index = 2; index < shoutPoints.length; index += 2) {
      context.lineTo(shoutPoints[index], shoutPoints[index + 1])
    }
    context.closePath()
    context.fill()
    context.stroke()
    const triangle = tailTip
      ? computeTailTriangle({ bubbleWidth, bubbleHeight, bubbleStyle: 'speech', tipX: tailTip.x, tipY: tailTip.y })
      : null
    if (triangle) {
      fillTriangle(context, triangle.points)
    }
  } else if (dialogue.bubbleStyle === 'soft' || dialogue.bubbleStyle === 'thought') {
    context.beginPath()
    context.ellipse(0, 0, bubbleWidth / 2, bubbleHeight / 2, 0, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    if (dialogue.bubbleStyle === 'thought') {
      const trail = tailTip ? computeThoughtTrail({ bubbleWidth, bubbleHeight, tipX: tailTip.x, tipY: tailTip.y }) : null
      if (trail) {
        for (const dot of trail) {
          context.beginPath()
          context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2)
          context.fill()
          context.stroke()
        }
      } else {
        context.beginPath()
        context.arc(bubbleWidth * 0.28, bubbleHeight * 0.38, 12, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    } else if (tailTip) {
      const triangle = computeTailTriangle({ bubbleWidth, bubbleHeight, bubbleStyle: 'soft', tipX: tailTip.x, tipY: tailTip.y })
      if (triangle) {
        fillTriangle(context, triangle.points)
      }
    }
  } else {
    const cornerRadius = dialogue.bubbleStyle === 'caption' ? 6 : dialogue.bubbleStyle === 'whisper' ? 18 : 12
    roundedRect(context, -bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, cornerRadius)
    context.fill()
    context.stroke()
    if (dialogue.bubbleStyle === 'speech' || dialogue.bubbleStyle === 'whisper') {
      const triangle = tailTip
        ? computeTailTriangle({ bubbleWidth, bubbleHeight, bubbleStyle: 'speech', tipX: tailTip.x, tipY: tailTip.y })
        : null
      if (triangle) {
        fillTriangle(context, triangle.points)
      } else if (dialogue.bubbleStyle === 'speech') {
        context.beginPath()
        context.moveTo(bubbleWidth * 0.22, bubbleHeight / 2 - 8)
        context.lineTo(bubbleWidth * 0.34, bubbleHeight / 2 + 34)
        context.lineTo(bubbleWidth * 0.08, bubbleHeight / 2 - 4)
        context.closePath()
        context.fill()
        context.stroke()
      }
    }
  }
  context.setLineDash([])

  context.fillStyle = dialogue.color || '#111111'
  context.font = `700 ${fontSize}px ${dialogue.fontFamily || fontFamily || DEFAULT_DIALOGUE_FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  if (isSfx) {
    // Mirrors the whiteboard's Konva stroke: white contour drawn under the fill.
    context.strokeStyle = letteringDefaults?.sfxStrokeColor || '#ffffff'
    context.lineWidth = Math.max(5, Math.round(fontSize * (letteringDefaults?.sfxStrokeWidth || 0.18)))
    context.lineJoin = 'round'
  }

  if (isHorizontal) {
    const startY = -textHeight / 2
    columns.forEach((line, lineIndex) => {
      const y = startY + lineIndex * fontSize * 1.35
      if (isSfx) {
        context.strokeText(line, 0, y)
      }
      context.fillText(line, 0, y)
    })
  } else {
    const columnGap = fontSize * 1.15
    columns.forEach((column, columnIndex) => {
      const x = (columns.length / 2 - columnIndex - 0.5) * columnGap
      const startY = -(column.length * fontSize * 1.08) / 2
      Array.from(toVerticalGlyphs(column)).forEach((character, characterIndex) => {
        const y = startY + characterIndex * fontSize * 1.08
        if (isSfx) {
          context.strokeText(character, x, y)
        }
        context.fillText(character, x, y)
      })
    })
  }
  context.restore()
}

function drawCleanupStrokes(context: CanvasRenderingContext2D, strokes: CleanupStroke[], pageWidth: number, pageHeight: number): void {
  for (const stroke of strokes) {
    const points = stroke.points.map((point) => ({ x: point.x * pageWidth, y: point.y * pageHeight }))
    if (!points.length) continue
    context.save()
    context.globalAlpha = Math.max(0.1, Math.min(1, stroke.intensity))
    context.strokeStyle = stroke.color
    context.fillStyle = stroke.color
    context.lineWidth = stroke.size
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (stroke.mode === 'mosaic') {
      context.setLineDash([Math.max(6, stroke.size * 0.55), Math.max(4, stroke.size * 0.3)])
    }
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y)
    }
    context.stroke()
    if (points.length === 1) {
      context.beginPath()
      context.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }
}

function fillTriangle(context: CanvasRenderingContext2D, points: [number, number, number, number, number, number]): void {
  context.beginPath()
  context.moveTo(points[0], points[1])
  context.lineTo(points[2], points[3])
  context.lineTo(points[4], points[5])
  context.closePath()
  context.fill()
  context.stroke()
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}
