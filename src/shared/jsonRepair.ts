export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')

  if (first === -1 || last === -1 || last <= first) {
    throw new Error('AI response did not contain a JSON object')
  }

  return trimmed.slice(first, last + 1)
}

export function parsePossiblyWrappedJson<T>(raw: string): T {
  return JSON.parse(extractJsonObject(raw)) as T
}
