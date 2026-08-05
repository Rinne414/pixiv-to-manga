import type { CleanupPoint, CleanupStroke } from './types'

/** Removes mask strokes touched by an eraser path while keeping the input immutable. */
export function eraseCleanupStrokes(strokes: CleanupStroke[], erasePath: CleanupPoint[], eraseSizeNormalized: number): CleanupStroke[] {
  const threshold = eraseSizeNormalized / 2
  return strokes.filter((stroke) => !pathHitsStroke(stroke.points, erasePath, threshold))
}

function distance(a: CleanupPoint, b: CleanupPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pathHitsStroke(strokePoints: CleanupPoint[], erasePath: CleanupPoint[], threshold: number): boolean {
  for (const erasePoint of erasePath) {
    for (let index = 0; index < strokePoints.length; index += 1) {
      const start = strokePoints[index]
      const end = strokePoints[index + 1] || start
      if (distanceToSegment(erasePoint, start, end) <= threshold) {
        return true
      }
    }
  }
  return false
}

function distanceToSegment(point: CleanupPoint, start: CleanupPoint, end: CleanupPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return distance(point, start)
  }
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const ratio = Math.max(0, Math.min(1, projection))
  return distance(point, { x: start.x + dx * ratio, y: start.y + dy * ratio })
}
