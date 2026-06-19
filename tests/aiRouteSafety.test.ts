import { describe, expect, it } from 'vitest'
import { evaluateAiGenerationRoute } from '../server/ai'
import type { ModelCapability, ProviderProfile } from '../src/shared/types'

const provider: ProviderProfile = {
  id: 'provider-1',
  name: 'Remote',
  baseUrl: 'https://api.example.test/v1',
  defaultModel: 'gpt-4o',
  isLocal: false,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  hasApiKey: true,
}

const capability: ModelCapability = {
  id: 'capability-1',
  providerId: provider.id,
  modelId: provider.defaultModel,
  supportsVision: true,
  supportsStreaming: true,
  supportsJsonSchema: true,
  allowsAdultInput: false,
  allowsAdultGeneration: false,
  contextWindow: 128000,
  notes: '',
  source: 'user',
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
}

describe('evaluateAiGenerationRoute', () => {
  it('allows normal safe text generation without capability metadata', () => {
    expect(
      evaluateAiGenerationRoute({
        apiBaseUrl: 'https://api.example.test/v1',
        modelName: 'gpt-4o',
        r18Enabled: false,
        imagePresent: false,
        safetyClass: 'safe',
        providers: [],
        capabilities: [],
      }),
    ).toEqual({ allow: true, reason: 'allowed' })
  })

  it('blocks R-18 generation without a matching user-confirmed capability record', () => {
    expect(
      evaluateAiGenerationRoute({
        apiBaseUrl: 'https://api.example.test/v1/',
        modelName: 'gpt-4o',
        r18Enabled: true,
        imagePresent: false,
        safetyClass: 'safe',
        providers: [provider],
        capabilities: [capability],
      }),
    ).toEqual({ allow: false, reason: 'adult_generation_not_allowed' })
  })

  it('allows R-18 generation only when the matching model allows adult generation', () => {
    expect(
      evaluateAiGenerationRoute({
        apiBaseUrl: 'https://api.example.test/v1/',
        modelName: 'gpt-4o',
        r18Enabled: true,
        imagePresent: false,
        safetyClass: 'safe',
        providers: [provider],
        capabilities: [{ ...capability, allowsAdultGeneration: true }],
      }),
    ).toEqual({ allow: true, reason: 'allowed' })
  })

  it('blocks image routes when matching capability is not vision-capable', () => {
    expect(
      evaluateAiGenerationRoute({
        apiBaseUrl: 'https://api.example.test/v1',
        modelName: 'gpt-4o',
        r18Enabled: false,
        imagePresent: true,
        safetyClass: 'safe',
        providers: [provider],
        capabilities: [{ ...capability, supportsVision: false }],
      }),
    ).toEqual({ allow: false, reason: 'vision_required' })
  })
})
