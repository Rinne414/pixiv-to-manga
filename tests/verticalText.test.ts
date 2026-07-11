import { describe, expect, it } from 'vitest'
import { toVerticalColumns, toVerticalGlyphs } from '../src/shared/text'

describe('toVerticalColumns kinsoku rules', () => {
  it('splits plain text into fixed-height columns', () => {
    expect(toVerticalColumns('あいうえお', 3)).toEqual(['あいう', 'えお'])
  })

  it('strips whitespace and returns a single empty column for empty text', () => {
    expect(toVerticalColumns('あい うえ', 4)).toEqual(['あいうえ'])
    expect(toVerticalColumns('', 3)).toEqual([''])
    expect(toVerticalColumns('   ', 3)).toEqual([''])
  })

  it('hangs line-start-prohibited punctuation at the bottom of the previous column', () => {
    expect(toVerticalColumns('あいう。えお', 3)).toEqual(['あいう。', 'えお'])
    expect(toVerticalColumns('あいう！えお', 3)).toEqual(['あいう！', 'えお'])
    expect(toVerticalColumns('あいう」えお', 3)).toEqual(['あいう」', 'えお'])
  })

  it('treats small kana as line-start prohibited', () => {
    expect(toVerticalColumns('あいうっえ', 3)).toEqual(['あいうっ', 'え'])
  })

  it('hangs at most two prohibited chars before wrapping anyway', () => {
    expect(toVerticalColumns('あいう。。。え', 3)).toEqual(['あいう。。', '。え'])
  })

  it('never lets an opening bracket end a column; it carries to the next', () => {
    expect(toVerticalColumns('あい「うえお', 3)).toEqual(['あい', '「うえ', 'お'])
  })

  it('keeps degenerate all-bracket input in one overlong column instead of looping', () => {
    expect(toVerticalColumns('「「「あ', 2)).toEqual(['「「「あ'])
  })
})

describe('toVerticalGlyphs', () => {
  it('swaps punctuation to vertical presentation forms', () => {
    expect(toVerticalGlyphs('你好，世界。')).toBe('你好︐世界︒')
    expect(toVerticalGlyphs('「加油！」')).toBe('﹁加油︕﹂')
    expect(toVerticalGlyphs('等等……')).toBe('等等︙︙')
  })

  it('rotates the long vowel mark to a vertical bar', () => {
    expect(toVerticalGlyphs('えーと')).toBe('え｜と')
  })

  it('keeps regular characters and the char count unchanged', () => {
    expect(toVerticalGlyphs('ABC漫画abc')).toBe('ABC漫画abc')
    expect(Array.from(toVerticalGlyphs('你好，世界。')).length).toBe(Array.from('你好，世界。').length)
  })
})
