import { describe, expect, it } from 'vitest'
import { OpenAiStreamAccumulator } from '../server/ai'

function sseLine(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`
}

describe('OpenAiStreamAccumulator', () => {
  it('accumulates delta content across whole lines', () => {
    const accumulator = new OpenAiStreamAccumulator()
    accumulator.push(sseLine('第一') + sseLine('段'))
    accumulator.push(sseLine('文字'))
    accumulator.finish()
    expect(accumulator.sawDataLine).toBe(true)
    expect(accumulator.content).toBe('第一段文字')
  })

  it('handles chunks that split a data line mid-JSON', () => {
    const accumulator = new OpenAiStreamAccumulator()
    const line = sseLine('切成兩半')
    accumulator.push(line.slice(0, 18))
    expect(accumulator.content).toBe('')
    accumulator.push(line.slice(18))
    accumulator.finish()
    expect(accumulator.content).toBe('切成兩半')
  })

  it('ignores [DONE], keep-alive comments, and blank lines', () => {
    const accumulator = new OpenAiStreamAccumulator()
    accumulator.push(': ping\n\n' + sseLine('內容') + 'data: [DONE]\n')
    accumulator.finish()
    expect(accumulator.content).toBe('內容')
  })

  it('skips malformed data lines without losing later ones', () => {
    const accumulator = new OpenAiStreamAccumulator()
    accumulator.push('data: {broken json\n' + sseLine('後續'))
    accumulator.finish()
    expect(accumulator.content).toBe('後續')
  })

  it('flushes a trailing line with no final newline on finish', () => {
    const accumulator = new OpenAiStreamAccumulator()
    accumulator.push(sseLine('前段') + `data: ${JSON.stringify({ choices: [{ delta: { content: '尾段' } }] })}`)
    expect(accumulator.content).toBe('前段')
    accumulator.finish()
    expect(accumulator.content).toBe('前段尾段')
  })

  it('reads message.content when providers stream whole messages', () => {
    const accumulator = new OpenAiStreamAccumulator()
    accumulator.push(`data: ${JSON.stringify({ choices: [{ message: { content: '整句' } }] })}\n`)
    accumulator.finish()
    expect(accumulator.content).toBe('整句')
  })

  it('reports sawDataLine=false for plain JSON bodies', () => {
    const accumulator = new OpenAiStreamAccumulator()
    accumulator.push(JSON.stringify({ choices: [{ message: { content: '普通 JSON' } }] }))
    accumulator.finish()
    expect(accumulator.sawDataLine).toBe(false)
    expect(accumulator.content).toBe('')
  })
})
