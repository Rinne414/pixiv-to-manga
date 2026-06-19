import { describe, expect, it } from 'vitest'
import { estimateVerticalTextBox, resolveDialogueCollisions } from '../src/shared/layout'
import type { Dialogue } from '../src/shared/types'

describe('layout helpers', () => {
  it('estimates vertical text bounds inside normalized coordinates', () => {
    const box = estimateVerticalTextBox(makeDialogue({ text: '这一句话会被排成竖排对白。', x: 0.5, y: 0.5 }))
    expect(box.width).toBeGreaterThan(0.08)
    expect(box.height).toBeGreaterThan(0.16)
    expect(box.x).toBe(0.5)
  })

  it('moves overlapping unlocked dialogues apart', () => {
    const adjusted = resolveDialogueCollisions([
      makeDialogue({ id: 'a', x: 0.5, y: 0.5 }),
      makeDialogue({ id: 'b', x: 0.5, y: 0.5 }),
    ])

    expect(Math.abs(adjusted[0].x - adjusted[1].x) + Math.abs(adjusted[0].y - adjusted[1].y)).toBeGreaterThan(0.05)
    for (const dialogue of adjusted) {
      expect(dialogue.x).toBeGreaterThanOrEqual(0)
      expect(dialogue.x).toBeLessThanOrEqual(1)
      expect(dialogue.y).toBeGreaterThanOrEqual(0)
      expect(dialogue.y).toBeLessThanOrEqual(1)
    }
  })

  it('keeps locked dialogue positions stable when resolving one-sided collisions', () => {
    const adjusted = resolveDialogueCollisions([
      makeDialogue({ id: 'locked', x: 0.5, y: 0.5, locked: true }),
      makeDialogue({ id: 'free', x: 0.5, y: 0.5 }),
    ])

    expect(adjusted[0].x).toBe(0.5)
    expect(adjusted[0].y).toBe(0.5)
    expect(Math.abs(adjusted[1].x - 0.5) + Math.abs(adjusted[1].y - 0.5)).toBeGreaterThan(0.02)
  })
})

function makeDialogue(patch: Partial<Dialogue> = {}): Dialogue {
  return {
    id: 'dialogue',
    pageId: 'page',
    text: '如果现在出发，还能赶上海边的落日。',
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    bubbleStyle: 'speech',
    color: '#141414',
    locked: false,
    ...patch,
  }
}
