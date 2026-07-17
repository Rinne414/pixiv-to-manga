/**
 * Jagged burst outline for shout bubbles, as a flat [x0,y0,x1,y1,...] polygon
 * centered on the bubble origin. Deterministic (no randomness) so the Konva
 * editor and the PNG export rasterize the exact same shape.
 */
export function computeShoutPoints(bubbleWidth: number, bubbleHeight: number, spikes = 14): number[] {
  const points: number[] = []
  const radiusX = bubbleWidth / 2
  const radiusY = bubbleHeight / 2
  for (let index = 0; index < spikes * 2; index += 1) {
    const angle = (Math.PI * 2 * index) / (spikes * 2) - Math.PI / 2
    const factor = index % 2 === 0 ? 1.1 : 0.82
    points.push(Math.cos(angle) * radiusX * factor, Math.sin(angle) * radiusY * factor)
  }
  return points
}

export const WHISPER_DASH: [number, number] = [10, 7]
