import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProvider,
  discoverProviderModels,
  exportProjectBackup,
  testProvider,
  updateModelCapability,
  type ModelCapability,
} from '../src/api'

const capability: ModelCapability = {
  id: 'cap-1',
  providerId: 'provider-1',
  modelId: 'gpt-4o',
  supportsVision: true,
  supportsStreaming: true,
  supportsJsonSchema: true,
  allowsAdultInput: false,
  allowsAdultGeneration: false,
  source: 'discovered',
  updatedAt: '2026-06-20T00:00:00.000Z',
}

describe('Provider Lab API client adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('unwraps provider mutation responses', async () => {
    stubFetch({
      provider: {
        id: 'provider-1',
        name: 'OpenAI',
        baseUrl: 'https://api.example.test/v1',
        defaultModel: 'gpt-4o',
        isLocal: false,
        hasApiKey: true,
      },
    })

    const provider = await createProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'gpt-4o',
      isLocal: false,
      apiKey: 'provider-form-secret',
    })

    expect(provider.id).toBe('provider-1')
    expect(provider.hasApiKey).toBe(true)
  })

  it('maps discovered backend capability records into frontend model rows', async () => {
    stubFetch({ models: [capability], trace: { request: { headers: { Authorization: '[redacted]' } } } })

    const models = await discoverProviderModels('provider-1')

    expect(models).toEqual([
      {
        id: 'gpt-4o',
        name: 'gpt-4o',
        capabilityStatus: 'detected',
        capabilities: {
          supportsVision: true,
          supportsStreaming: true,
          supportsJsonSchema: true,
          allowsAdultInput: false,
          allowsAdultGeneration: false,
        },
      },
    ])
  })

  it('converts checkbox tests into backend test arrays and normalizes traces', async () => {
    const fetchMock = stubFetch({
      providerId: 'provider-1',
      modelId: 'gpt-4o',
      ok: true,
      results: [
        { kind: 'text', ok: true, status: 200, latencyMs: 10 },
        { kind: 'vision', ok: true, status: 200, latencyMs: 20 },
      ],
      trace: [{ request: { headers: { Authorization: '[redacted]' } } }],
      inferredCapabilities: { supportsVision: true },
    })

    const result = await testProvider('provider-1', {
      modelId: 'gpt-4o',
      tests: { text: true, vision: true, json: false, streaming: false },
    })
    const [, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>
    const requestBody = JSON.parse(String(requestInit?.body))

    expect(requestBody.tests).toEqual(['text', 'vision'])
    expect(result.passed).toBe(true)
    expect(result.latencyMs).toBe(30)
    expect(result.results[0]).toEqual({ kind: 'text', passed: true, message: 'HTTP 200 / 10 ms' })
    expect(result.redactedTrace[0]).toContain('[redacted]')
  })

  it('unwraps capability update responses', async () => {
    stubFetch({ capability: { ...capability, allowsAdultInput: true, source: 'user' } })

    const updated = await updateModelCapability('cap-1', {
      supportsVision: true,
      supportsStreaming: true,
      supportsJsonSchema: true,
      allowsAdultInput: true,
      allowsAdultGeneration: false,
    })

    expect(updated.id).toBe('cap-1')
    expect(updated.allowsAdultInput).toBe(true)
    expect(updated.source).toBe('user')
  })

  it('rejects provider tests with no selected probes before making a request', async () => {
    const fetchMock = stubFetch({})

    await expect(
      testProvider('provider-1', {
        modelId: 'gpt-4o',
        tests: { text: false, vision: false, json: false, streaming: false },
      }),
    ).rejects.toThrow(/Select at least one provider test/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts project backup export requests', async () => {
    const fetchMock = stubFetch({ fileName: 'backup.zip', absolutePath: 'C:/tmp/backup.zip', url: '/assets/exports/backup.zip' })

    const result = await exportProjectBackup({ projectId: 'project-1' })
    const [path, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>

    expect(path).toBe('/api/export/project-backup')
    expect(requestInit?.method).toBe('POST')
    expect(JSON.parse(String(requestInit?.body))).toEqual({ projectId: 'project-1' })
    expect(result.fileName).toBe('backup.zip')
  })
})

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
