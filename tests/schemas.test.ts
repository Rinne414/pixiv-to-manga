import { describe, expect, it } from 'vitest'
import { dialogueListSchema, storyBibleSchema } from '../src/shared/schemas'

describe('AI output schemas', () => {
  it('accepts story bible output and fills defaults', () => {
    const parsed = storyBibleSchema.parse({
      synopsis: '两人在车站相遇。',
      tone: '清爽',
      characters: [{ name: '夏海' }],
      pageBeats: [{ pageIndex: 0, summary: '相遇', intent: '建立关系' }],
    })

    expect(parsed.r18Enabled).toBe(false)
    expect(parsed.characters[0].bubbleStyle).toBe('speech')
    expect(parsed.characters[0].color).toBe('#141414')
  })

  it('rejects unsafe dialogue coordinates and invalid colors', () => {
    expect(() =>
      dialogueListSchema.parse({
        dialogues: [{ text: 'hello', x: 2, y: 0.5, color: 'red' }],
      }),
    ).toThrow()
  })

  it('accepts sfx bubble style for onomatopoeia lines', () => {
    const parsed = dialogueListSchema.parse({
      dialogues: [{ text: '轰——！', bubbleStyle: 'sfx' }],
    })
    expect(parsed.dialogues[0].bubbleStyle).toBe('sfx')
  })

  it('accepts shout/whisper styles and per-line direction and font', () => {
    const parsed = dialogueListSchema.parse({
      dialogues: [
        { text: '住手！！', bubbleStyle: 'shout' },
        { text: 'hey…', bubbleStyle: 'whisper', textDirection: 'horizontal', fontFamily: '"KaiTi", serif' },
      ],
    })
    expect(parsed.dialogues[0].bubbleStyle).toBe('shout')
    expect(parsed.dialogues[1].textDirection).toBe('horizontal')
    expect(parsed.dialogues[1].fontFamily).toContain('KaiTi')
  })
})
