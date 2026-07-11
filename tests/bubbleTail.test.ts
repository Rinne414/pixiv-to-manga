import { describe, expect, it } from 'vitest'
import { computeTailTriangle, computeThoughtTrail, dialogueTailLocal, tailLocalToPage } from '../src/shared/bubbleTail'
import { dialogueSchema } from '../src/shared/schemas'

describe('bubble tail geometry', () => {
  it('returns null without a stored tip', () => {
    expect(dialogueTailLocal({ x: 0.5, y: 0.5, rotation: 0 }, 1000, 1000)).toBeNull()
  })

  it('converts the page tip to bubble-local space and back, honoring rotation', () => {
    const dialogue = { x: 0.5, y: 0.5, rotation: 90, tailX: 0.6, tailY: 0.5 }
    const local = dialogueTailLocal(dialogue, 1000, 1000)
    expect(local).not.toBeNull()
    // Tip 100px right of center; with the bubble rotated 90° that is locally "up".
    expect(local!.x).toBeCloseTo(0, 5)
    expect(local!.y).toBeCloseTo(-100, 5)

    const roundTrip = tailLocalToPage(dialogue, local!, 1000, 1000)
    expect(roundTrip.tailX).toBeCloseTo(0.6, 5)
    expect(roundTrip.tailY).toBeCloseTo(0.5, 5)
  })

  it('builds a speech triangle from the rect edge only when the tip is outside', () => {
    const inside = computeTailTriangle({ bubbleWidth: 200, bubbleHeight: 100, bubbleStyle: 'speech', tipX: 20, tipY: 10 })
    expect(inside).toBeNull()

    const outside = computeTailTriangle({ bubbleWidth: 200, bubbleHeight: 100, bubbleStyle: 'speech', tipX: 0, tipY: 200 })
    expect(outside).not.toBeNull()
    // Straight down: edge at halfHeight 50, base inset 6, spread 18 → [-18,44, 0,200, 18,44].
    expect(outside!.points[0]).toBeCloseTo(-18, 5)
    expect(outside!.points[1]).toBeCloseTo(44, 5)
    expect(outside!.points[2]).toBe(0)
    expect(outside!.points[3]).toBe(200)
    expect(outside!.points[4]).toBeCloseTo(18, 5)
    expect(outside!.points[5]).toBeCloseTo(44, 5)
  })

  it('never returns a triangle for captions or thought bubbles', () => {
    expect(computeTailTriangle({ bubbleWidth: 200, bubbleHeight: 100, bubbleStyle: 'caption', tipX: 0, tipY: 200 })).toBeNull()
    expect(computeTailTriangle({ bubbleWidth: 200, bubbleHeight: 100, bubbleStyle: 'thought', tipX: 0, tipY: 200 })).toBeNull()
  })

  it('lays shrinking thought dots between the ellipse edge and the tip', () => {
    const trail = computeThoughtTrail({ bubbleWidth: 200, bubbleHeight: 100, tipX: 0, tipY: 200 })
    expect(trail).not.toBeNull()
    expect(trail).toHaveLength(3)
    expect(trail![0].radius).toBeGreaterThan(trail![2].radius)
    // Dots march outward from the edge (y=50) toward the tip (y=200) without reaching it.
    expect(trail![0].y).toBeGreaterThan(50)
    expect(trail![0].y).toBeLessThan(trail![1].y)
    expect(trail![2].y).toBeLessThan(200)
  })

  it('dialogueSchema bounds tail coordinates to the page', () => {
    expect(dialogueSchema.parse({ text: 'hi', tailX: 0.4, tailY: 0.9 })).toMatchObject({ tailX: 0.4, tailY: 0.9 })
    expect(() => dialogueSchema.parse({ text: 'hi', tailX: 1.4 })).toThrow()
    expect(() => dialogueSchema.parse({ text: 'hi', tailY: -0.1 })).toThrow()
  })
})
