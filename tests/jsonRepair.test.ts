import { describe, expect, it } from 'vitest'
import { extractJsonObject, parsePossiblyWrappedJson } from '../src/shared/jsonRepair'

describe('jsonRepair helpers', () => {
  it('extracts JSON objects from fenced model output', () => {
    const raw = '```json\n{"dialogues":[{"text":"你好"}]}\n```'
    expect(extractJsonObject(raw)).toBe('{"dialogues":[{"text":"你好"}]}')
  })

  it('parses JSON surrounded by prose', () => {
    const parsed = parsePossiblyWrappedJson<{ ok: boolean }>('Here is the result:\n{"ok":true}\nDone.')
    expect(parsed.ok).toBe(true)
  })

  it('throws when no JSON object is present', () => {
    expect(() => extractJsonObject('plain text only')).toThrow(/JSON object/)
  })
})
