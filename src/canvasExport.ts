import { estimateVerticalTextBox } from './shared/layout'
import { toVerticalColumns } from './shared/text'
import type { Asset, Dialogue, Page, ProjectDetail } from './shared/types'

export async function renderProjectPages(detail: ProjectDetail): Promise<Array<{ pageId: string; dataUrl: string }>> {
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
      dataUrl: await renderPage(page, asset, dialogues),
    })
  }

  return rendered
}

async function renderPage(page: Page, asset: Asset, dialogues: Dialogue[]): Promise<string> {
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

  for (const dialogue of dialogues) {
    drawDialogue(context, dialogue, width, height)
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

function drawDialogue(context: CanvasRenderingContext2D, dialogue: Dialogue, pageWidth: number, pageHeight: number): void {
  const box = estimateVerticalTextBox(dialogue)
  const fontSize = Math.round(34 * dialogue.scale)
  const columns = toVerticalColumns(dialogue.text, 11)
  const textWidth = Math.max(1, columns.length) * fontSize * 1.25
  const textHeight = Math.max(...columns.map((column) => column.length), 1) * fontSize * 1.08
  const bubbleWidth = Math.max(box.width * pageWidth, textWidth + 52)
  const bubbleHeight = Math.max(box.height * pageHeight, textHeight + 56)

  context.save()
  context.translate(dialogue.x * pageWidth, dialogue.y * pageHeight)
  context.rotate((dialogue.rotation * Math.PI) / 180)
  context.lineWidth = 6
  context.strokeStyle = dialogue.color || '#111111'
  context.fillStyle = dialogue.bubbleStyle === 'caption' ? 'rgba(255, 255, 255, 0.92)' : '#ffffff'

  if (dialogue.bubbleStyle === 'soft' || dialogue.bubbleStyle === 'thought') {
    context.beginPath()
    context.ellipse(0, 0, bubbleWidth / 2, bubbleHeight / 2, 0, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    if (dialogue.bubbleStyle === 'thought') {
      context.beginPath()
      context.arc(bubbleWidth * 0.28, bubbleHeight * 0.38, 12, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
  } else {
    roundedRect(context, -bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 12)
    context.fill()
    context.stroke()
    if (dialogue.bubbleStyle === 'speech') {
      context.beginPath()
      context.moveTo(bubbleWidth * 0.22, bubbleHeight / 2 - 8)
      context.lineTo(bubbleWidth * 0.34, bubbleHeight / 2 + 34)
      context.lineTo(bubbleWidth * 0.08, bubbleHeight / 2 - 4)
      context.closePath()
      context.fill()
      context.stroke()
    }
  }

  context.fillStyle = dialogue.color || '#111111'
  context.font = `700 ${fontSize}px "Noto Serif SC", SimSun, serif`
  context.textAlign = 'center'
  context.textBaseline = 'top'

  const columnGap = fontSize * 1.15
  columns.forEach((column, columnIndex) => {
    const x = (columns.length / 2 - columnIndex - 0.5) * columnGap
    const startY = -(column.length * fontSize * 1.08) / 2
    Array.from(column).forEach((character, characterIndex) => {
      context.fillText(character, x, startY + characterIndex * fontSize * 1.08)
    })
  })
  context.restore()
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
