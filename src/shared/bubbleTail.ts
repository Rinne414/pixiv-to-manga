import type { BubbleStyle, Dialogue } from './types'

export interface TailTriangle {
  /** Base point A, tip, base point B — bubble-local (unrotated) pixels, flattened for canvas/Konva. */
  points: [number, number, number, number, number, number]
}

export interface ThoughtDot {
  x: number
  y: number
  radius: number
}

/**
 * Converts the stored page-normalized tail tip into bubble-local coordinates,
 * inverse-rotating so the tail keeps pointing at the same page spot when the
 * bubble is rotated. Returns null when no tail tip is set.
 */
export function dialogueTailLocal(
  dialogue: Pick<Dialogue, 'x' | 'y' | 'rotation' | 'tailX' | 'tailY'>,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number } | null {
  if (dialogue.tailX === undefined || dialogue.tailY === undefined) {
    return null
  }
  const dx = (dialogue.tailX - dialogue.x) * pageWidth
  const dy = (dialogue.tailY - dialogue.y) * pageHeight
  const theta = (-dialogue.rotation * Math.PI) / 180
  return {
    x: dx * Math.cos(theta) - dy * Math.sin(theta),
    y: dx * Math.sin(theta) + dy * Math.cos(theta),
  }
}

/** Inverse of dialogueTailLocal: bubble-local point → page-normalized coordinates. */
export function tailLocalToPage(
  dialogue: Pick<Dialogue, 'x' | 'y' | 'rotation'>,
  local: { x: number; y: number },
  pageWidth: number,
  pageHeight: number,
): { tailX: number; tailY: number } {
  const theta = (dialogue.rotation * Math.PI) / 180
  const dx = local.x * Math.cos(theta) - local.y * Math.sin(theta)
  const dy = local.x * Math.sin(theta) + local.y * Math.cos(theta)
  return {
    tailX: dialogue.x + dx / pageWidth,
    tailY: dialogue.y + dy / pageHeight,
  }
}

/**
 * Triangle tail from the bubble edge to the tip. Returns null for captions,
 * when the tip sits inside the bubble, or when the tip equals the center.
 */
export function computeTailTriangle(input: {
  bubbleWidth: number
  bubbleHeight: number
  bubbleStyle: BubbleStyle
  tipX: number
  tipY: number
}): TailTriangle | null {
  if (input.bubbleStyle === 'caption' || input.bubbleStyle === 'thought') {
    return null
  }
  const distance = Math.hypot(input.tipX, input.tipY)
  if (!distance) {
    return null
  }
  const ux = input.tipX / distance
  const uy = input.tipY / distance
  const edge = edgeDistance(input.bubbleWidth, input.bubbleHeight, input.bubbleStyle, ux, uy)
  if (distance <= edge) {
    return null
  }
  const spread = Math.min(Math.min(input.bubbleWidth, input.bubbleHeight) * 0.18, 40)
  // Base sits slightly inside the outline so the tail visually merges with the bubble.
  const baseDistance = Math.max(edge - 6, 0)
  const px = -uy
  const py = ux
  return {
    points: [
      ux * baseDistance + px * spread,
      uy * baseDistance + py * spread,
      input.tipX,
      input.tipY,
      ux * baseDistance - px * spread,
      uy * baseDistance - py * spread,
    ],
  }
}

/** Thought bubbles trail shrinking dots from the edge toward the tip instead of a triangle. */
export function computeThoughtTrail(input: {
  bubbleWidth: number
  bubbleHeight: number
  tipX: number
  tipY: number
}): ThoughtDot[] | null {
  const distance = Math.hypot(input.tipX, input.tipY)
  if (!distance) {
    return null
  }
  const ux = input.tipX / distance
  const uy = input.tipY / distance
  const edge = edgeDistance(input.bubbleWidth, input.bubbleHeight, 'thought', ux, uy)
  if (distance <= edge) {
    return null
  }
  const radii = [11, 8, 5]
  return radii.map((radius, index) => {
    const t = edge + ((distance - edge) * (index + 1)) / (radii.length + 0.5)
    return { x: ux * t, y: uy * t, radius }
  })
}

function edgeDistance(bubbleWidth: number, bubbleHeight: number, style: BubbleStyle, ux: number, uy: number): number {
  const halfWidth = bubbleWidth / 2
  const halfHeight = bubbleHeight / 2
  if (style === 'speech' || style === 'caption') {
    const alongX = ux !== 0 ? halfWidth / Math.abs(ux) : Number.POSITIVE_INFINITY
    const alongY = uy !== 0 ? halfHeight / Math.abs(uy) : Number.POSITIVE_INFINITY
    return Math.min(alongX, alongY)
  }
  return 1 / Math.sqrt((ux * ux) / (halfWidth * halfWidth) + (uy * uy) / (halfHeight * halfHeight))
}
