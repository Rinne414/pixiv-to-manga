import { describe, expect, it } from 'vitest'
import { eraseCleanupStrokes } from '../src/shared/cleanup'
import type { CleanupStroke } from '../src/shared/types'

describe('cleanup stroke helpers', () => {
  it('erases a stroke when the erase path crosses a segment between saved points', () => {
    const strokes: CleanupStroke[] = [
      {
        mode: 'paint',
        points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
        size: 40,
        intensity: 1,
        color: '#ffffff',
      },
    ]

    const remaining = eraseCleanupStrokes(strokes, [{ x: 0.5, y: 0.51 }], 0.04)

    expect(remaining).toEqual([])
    expect(strokes[0].points).toHaveLength(2)
  })

  it('keeps unrelated strokes and does not mutate the input array', () => {
    const strokes: CleanupStroke[] = [
      {
        mode: 'mosaic',
        points: [{ x: 0.1, y: 0.1 }],
        size: 24,
        intensity: 0.7,
        color: '#ffffff',
      },
    ]

    const remaining = eraseCleanupStrokes(strokes, [{ x: 0.8, y: 0.8 }], 0.04)

    expect(remaining).toEqual(strokes)
    expect(remaining).not.toBe(strokes)
  })
})
