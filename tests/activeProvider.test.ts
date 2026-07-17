import { describe, expect, it } from 'vitest'
import { resolveActiveEngine, type ActiveProviderLike } from '../src/shared/activeProvider'

function provider(overrides: Partial<ActiveProviderLike>): ActiveProviderLike {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com/v1',
    defaultModel: 'test-model',
    isLocal: false,
    hasApiKey: false,
    ...overrides,
  }
}

describe('resolveActiveEngine', () => {
  it('returns the global route when a global API key exists', () => {
    const engine = resolveActiveEngine(
      { apiBaseUrl: 'https://api.example.com/v1', modelName: 'gpt-x', hasApiKey: true },
      [],
    )
    expect(engine).toMatchObject({
      apiBaseUrl: 'https://api.example.com/v1',
      modelName: 'gpt-x',
      isLocal: false,
      hasApiKey: true,
      source: 'global',
    })
    expect(engine?.provider).toBeUndefined()
  })

  it('accepts a keyless global route that matches a local provider', () => {
    const local = provider({ id: 'ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3', isLocal: true })
    const engine = resolveActiveEngine(
      { apiBaseUrl: 'http://localhost:11434/v1', modelName: 'llama3', hasApiKey: false },
      [local],
    )
    expect(engine).toMatchObject({ isLocal: true, source: 'global' })
    expect(engine?.provider?.id).toBe('ollama')
  })

  it('accepts a keyless global route when the matched provider holds its own key (backend parity)', () => {
    // server/ai.ts resolveAiTarget: apiKey = globalApiKey || providerApiKey — the
    // provider's stored key keeps the global route usable without a global key.
    const first = provider({ id: 'other-first', baseUrl: 'https://other.example.com/v1', defaultModel: 'other', hasApiKey: true })
    const matched = provider({ id: 'matched', hasApiKey: true })
    const engine = resolveActiveEngine(
      { apiBaseUrl: 'https://api.example.com/v1', modelName: 'test-model', hasApiKey: false },
      [first, matched],
    )
    expect(engine?.source).toBe('global')
    expect(engine?.provider?.id).toBe('matched')
    expect(engine?.hasApiKey).toBe(true)
  })

  it('matches providers through base URL and model normalization', () => {
    const matched = provider({ id: 'normalized', baseUrl: 'api.example.com/v1/', defaultModel: 'Test-Model' })
    const engine = resolveActiveEngine(
      { apiBaseUrl: 'https://api.example.com/v1', modelName: 'test-model', hasApiKey: true },
      [matched],
    )
    expect(engine?.provider?.id).toBe('normalized')
  })

  it('falls back to the first usable provider profile when the global route is unusable', () => {
    const keyless = provider({ id: 'keyless' })
    const keyed = provider({ id: 'keyed', baseUrl: 'https://keyed.example.com/v1', defaultModel: 'keyed-model', hasApiKey: true })
    const engine = resolveActiveEngine(
      { apiBaseUrl: 'https://unmatched.example.com/v1', modelName: 'missing', hasApiKey: false },
      [keyless, keyed],
    )
    expect(engine).toMatchObject({
      apiBaseUrl: 'https://keyed.example.com/v1',
      modelName: 'keyed-model',
      hasApiKey: true,
      source: 'provider',
    })
  })

  it('skips fallback providers missing a base URL or model', () => {
    const incomplete = provider({ id: 'incomplete', baseUrl: '', hasApiKey: true })
    const usable = provider({ id: 'usable', baseUrl: 'https://usable.example.com/v1', hasApiKey: true })
    const engine = resolveActiveEngine(null, [incomplete, usable])
    expect(engine?.provider?.id).toBe('usable')
  })

  it('returns null when nothing is usable', () => {
    expect(resolveActiveEngine(null, [])).toBeNull()
    expect(
      resolveActiveEngine({ apiBaseUrl: 'https://api.example.com/v1', modelName: 'gpt-x', hasApiKey: false }, [
        provider({ id: 'keyless' }),
      ]),
    ).toBeNull()
  })
})
