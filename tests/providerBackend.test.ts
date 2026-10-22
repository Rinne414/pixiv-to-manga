import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { registerProviderLabRoutes, parseProviderModels } from '../server/providers'
import { deriveModelCapabilities } from '../server/modelCapabilities'
import { normalizeBaseUrl } from '../server/providerResolution'
import { SecretStore, normalizeKeytarModule, type KeytarModule } from '../server/secrets'
import { evaluateRouteSafety } from '../src/shared/routeSafety'

class MemoryKeytar implements KeytarModule {
  values = new Map<string, string>()

  async getPassword(service: string, account: string): Promise<string | null> {
    return this.values.get(`${service}:${account}`) || null
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    this.values.set(`${service}:${account}`, password)
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.values.delete(`${service}:${account}`)
  }
}

class FailingKeytar extends MemoryKeytar {
  override async setPassword(): Promise<void> {
    throw new Error('keytar unavailable')
  }
}

class TestSecretStore extends SecretStore {
  private testKeytar: KeytarModule

  constructor(db: StudioDatabase, keytar: KeytarModule) {
    super(db)
    this.testKeytar = keytar
  }

  override async getKeytar(): Promise<KeytarModule | null> {
    return this.testKeytar
  }
}

function createDb(): StudioDatabase {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-provider-test-'))
  return new StudioDatabase(path.join(dir, 'studio.sqlite'), false)
}

describe('Provider Lab backend', () => {
  let db: StudioDatabase | undefined

  afterEach(() => {
    db = undefined
    delete process.env.PTM_TEST_MEMORY_KEYTAR
  })

  it('normalizes the AIHubMix website root to its OpenAI-compatible API prefix', () => {
    expect(normalizeBaseUrl('https://aihubmix.com')).toBe('https://aihubmix.com/v1')
    expect(normalizeBaseUrl('https://aihubmix.com/v1/')).toBe('https://aihubmix.com/v1')
  })

  it('does not infer external capabilities from model names', () => {
    for (const modelId of ['grok-4-20-reasoning', 'gpt-4o', 'qwen3-vl:8b', 'vendor/model-uncensored']) {
      expect(deriveModelCapabilities({ id: modelId, declaredCapabilities: {} }, false)).toMatchObject({
        supportsVision: false,
        supportsImageGeneration: false,
        supportsJsonSchema: false,
        allowsAdultInput: false,
        allowsAdultGeneration: false,
        capabilitySources: {
          supportsVision: 'unknown',
          supportsImageGeneration: 'unknown',
          supportsJsonSchema: 'unknown',
          allowsAdultInput: 'unknown',
          allowsAdultGeneration: 'unknown',
        },
      })
    }
  })

  it('stores provider metadata in SQLite and API keys in keytar only', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets })

    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'OpenAI compatible',
        baseUrl: 'https://api.example.test/v1/',
        defaultModel: 'gpt-4o-mini',
        apiKey: 'provider-secret-value',
      },
    })

    expect(created.statusCode).toBe(200)
    const createdBody = created.json()
    expect(createdBody.provider.baseUrl).toBe('https://api.example.test/v1')
    expect(createdBody.provider.hasApiKey).toBe(true)
    expect(JSON.stringify(createdBody)).not.toContain('provider-secret-value')

    const listed = await server.inject({ method: 'GET', url: '/api/providers' })
    const listBody = listed.json()
    expect(listBody.providers).toHaveLength(1)
    expect(listBody.providers[0].hasApiKey).toBe(true)
    expect(JSON.stringify(listBody)).not.toContain('provider-secret-value')
  })

  it('discovers and tests legacy settings without persisting a provider or leaking the key', async () => {
    db = createDb()
    const keytar = new MemoryKeytar()
    const secrets = new TestSecretStore(db, keytar)
    await secrets.save({ apiKey: 'legacy-secret' })
    const server = fastify()
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'legacy-model', owned_by: 'test-provider' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer legacy-secret' })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })

    const models = await server.inject({
      method: 'POST',
      url: '/api/settings/models',
      payload: { apiBaseUrl: 'https://api.example.test/v1' },
    })
    expect(models.statusCode).toBe(200)
    expect(models.json().models).toMatchObject([{ id: 'legacy-model', ownedBy: 'test-provider' }])

    const test = await server.inject({
      method: 'POST',
      url: '/api/settings/test',
      payload: { apiBaseUrl: 'https://api.example.test/v1', modelName: 'legacy-model' },
    })
    expect(test.statusCode).toBe(200)
    expect(test.json()).toMatchObject({ providerId: 'legacy-settings', modelId: 'legacy-model', ok: true })
    expect(test.body).not.toContain('legacy-secret')
    expect(db.listProviders()).toHaveLength(0)
  })

  it('deletes provider metadata and associated keytar secret', async () => {
    db = createDb()
    const keytar = new MemoryKeytar()
    const secrets = new TestSecretStore(db, keytar)
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets })

    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1', isLocal: true, apiKey: 'local-secret' },
    })
    const providerId = created.json().provider.id

    const deleted = await server.inject({ method: 'DELETE', url: `/api/providers/${providerId}` })
    expect(deleted.statusCode).toBe(200)
    expect(await secrets.hasProviderApiKey(providerId)).toBe(false)
    expect(db.listProviders()).toHaveLength(0)
  })

  it('fails closed without leaving provider metadata when keytar cannot save a new API key', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new FailingKeytar())
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets })

    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Remote', baseUrl: 'https://api.example.test/v1', apiKey: 'provider-secret-should-not-persist' },
    })

    expect(created.statusCode).toBe(500)
    expect(db.listProviders()).toHaveLength(0)
    expect(created.body).not.toContain('provider-secret-should-not-persist')
  })

  it('requires external providers to use public HTTPS URLs', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'Misconfigured local',
        baseUrl: 'http://127.0.0.1:11434/v1',
        defaultModel: 'llava',
        isLocal: false,
      },
    })

    expect(response.statusCode).not.toBe(200)
    expect(db.listProviders()).toHaveLength(0)
  })

  it('rejects public endpoints marked as local providers', async () => {
    db = createDb()
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets: new TestSecretStore(db, new MemoryKeytar()) })

    const response = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'Public endpoint marked local',
        baseUrl: 'https://api.example.test/v1',
        defaultModel: 'gpt-4o',
        isLocal: true,
      },
    })

    expect(response.statusCode).not.toBe(200)
    expect(response.body).toContain('must target localhost or a private network host')
    expect(db.listProviders()).toHaveLength(0)
  })

  it('parses OpenAI-compatible and simple model discovery responses', () => {
    expect(parseProviderModels(JSON.stringify({ data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'text-only' }] }))).toEqual([
      { id: 'gpt-4o', ownedBy: 'openai', rawType: undefined, declaredCapabilities: {}, contextWindow: undefined },
      { id: 'text-only', ownedBy: undefined, rawType: undefined, declaredCapabilities: {}, contextWindow: undefined },
    ])
    expect(parseProviderModels(JSON.stringify({ models: ['llava', { name: 'qwen-vl' }] }))).toEqual([
      { id: 'llava', declaredCapabilities: {} },
      { id: 'qwen-vl', ownedBy: undefined, rawType: undefined, declaredCapabilities: {}, contextWindow: undefined },
    ])
  })

  it('parses explicit provider capability metadata', () => {
    const [model] = parseProviderModels(
      JSON.stringify({
        data: [
          {
            id: 'gateway/model',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['response_format', 'stream'],
            allows_adult_input: true,
            allows_adult_generation: true,
            context_length: 131072,
          },
        ],
      }),
    )

    expect(model).toMatchObject({
      id: 'gateway/model',
      contextWindow: 131072,
      declaredCapabilities: {
        supportsVision: true,
        supportsImageGeneration: false,
        supportsStreaming: true,
        supportsJsonSchema: true,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
      },
    })
  })

  it('uses unmoderated external provider metadata as positive adult-route evidence', () => {
    const [model] = parseProviderModels(
      JSON.stringify({
        data: [
          {
            id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition',
            top_provider: { is_moderated: false },
          },
        ],
      }),
    )

    expect(model).toMatchObject({
      providerModerated: false,
      declaredCapabilities: {
        allowsAdultInput: true,
        allowsAdultGeneration: true,
      },
    })
    expect(deriveModelCapabilities(model, false).capabilitySources).toMatchObject({
      allowsAdultInput: 'provider',
      allowsAdultGeneration: 'provider',
    })
  })

  it('does not trust adult-looking model names without provider evidence', () => {
    const externalAdultModel = deriveModelCapabilities(
      { id: 'vendor/model-uncensored', declaredCapabilities: {} },
      false,
    )
    const moderatedAdultModel = deriveModelCapabilities(
      { id: 'vendor/model-uncensored', declaredCapabilities: {}, providerModerated: true },
      false,
    )
    const deniedAdultModel = deriveModelCapabilities(
      {
        id: 'vendor/model-uncensored',
        declaredCapabilities: { allowsAdultInput: false, allowsAdultGeneration: false },
      },
      false,
    )

    expect(externalAdultModel).toMatchObject({
      allowsAdultInput: false,
      allowsAdultGeneration: false,
      capabilitySources: {
        allowsAdultInput: 'unknown',
        allowsAdultGeneration: 'unknown',
      },
    })
    expect(moderatedAdultModel).toMatchObject({
      allowsAdultInput: false,
      allowsAdultGeneration: false,
      capabilitySources: {
        allowsAdultInput: 'unknown',
        allowsAdultGeneration: 'unknown',
      },
    })
    expect(deniedAdultModel).toMatchObject({
      allowsAdultInput: false,
      allowsAdultGeneration: false,
      capabilitySources: {
        allowsAdultInput: 'provider',
        allowsAdultGeneration: 'provider',
      },
    })
  })

  it('discovers models, stores capabilities, and returns a redacted trace', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Response(JSON.stringify({ data: [{ id: 'gpt-4o', owned_by: 'provider' }] }), {
        status: init?.headers && 'Authorization' in (init.headers as Record<string, string>) ? 200 : 401,
      })
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })

    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Remote', baseUrl: 'https://api.example.test/v1', apiKey: 'provider-discover-secret' },
    })
    const providerId = created.json().provider.id

    const response = await server.inject({ method: 'POST', url: `/api/providers/${providerId}/models/discover`, payload: {} })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.models[0].modelId).toBe('gpt-4o')
    expect(body.models[0].supportsVision).toBe(false)
    expect(body.models[0].capabilitySources.supportsVision).toBe('unknown')
    expect(body.trace.request.headers.Authorization).toBe('[redacted]')
    expect(JSON.stringify(body)).not.toContain('provider-discover-secret')
  })

  it('uses unmoderated discovery metadata to enable external adult routing without manual confirmation', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'provider/model-alias',
              capabilities: {
                supports_vision: true,
              },
              top_provider: { is_moderated: false },
            },
          ],
        }),
        { status: 200 },
      )
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })
    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'Metadata Provider',
        baseUrl: 'https://api.example.test/v1',
        defaultModel: 'provider/model-alias',
      },
    })

    await server.inject({ method: 'POST', url: `/api/providers/${created.json().provider.id}/models/discover`, payload: {} })
    const [capability] = db.listModelCapabilities(created.json().provider.id)

    expect(capability).toMatchObject({
      supportsVision: true,
      allowsAdultInput: true,
      allowsAdultGeneration: true,
      capabilitySources: {
        supportsVision: 'provider',
        allowsAdultInput: 'provider',
        allowsAdultGeneration: 'provider',
      },
    })
  })

  it('gives explicit provider denial precedence over unmoderated route metadata', () => {
    const [model] = parseProviderModels(
      JSON.stringify({
        data: [
          {
            id: 'vendor/model-uncensored',
            allows_adult_content: false,
            top_provider: { is_moderated: false },
          },
        ],
      }),
    )

    expect(deriveModelCapabilities(model, false)).toMatchObject({
      allowsAdultInput: false,
      allowsAdultGeneration: false,
      capabilitySources: {
        allowsAdultInput: 'provider',
        allowsAdultGeneration: 'provider',
      },
    })
  })

  it('rejects absolute model discovery URLs', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const fetchImpl = (() => {
      throw new Error('fetch should not be called')
    }) as typeof fetch
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })

    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'llava', isLocal: true },
    })
    const providerId = created.json().provider.id

    const response = await server.inject({
      method: 'POST',
      url: `/api/providers/${providerId}/models/discover`,
      payload: { path: 'https://metadata.example.test/models' },
    })

    expect(response.statusCode).not.toBe(200)
  })

  it('provider test redacts authorization and image payloads', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const fetchImpl: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body || '{}')) as { stream?: boolean; response_format?: unknown }
      if (request.stream) {
        return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: request.response_format ? '{"ok":true}' : 'OK' } }],
          echoed: 'provider-vision-secret',
          imageEcho: 'secret-image-payload',
          request,
        }),
        { status: 200 },
      )
    }
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })

    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'Vision',
        baseUrl: 'https://api.example.test/v1',
        defaultModel: 'gpt-4o',
        apiKey: 'provider-vision-secret',
      },
    })
    const providerId = created.json().provider.id

    const response = await server.inject({
      method: 'POST',
      url: `/api/providers/${providerId}/test`,
      payload: {
        tests: ['vision', 'json', 'streaming'],
        imageDataUrl: 'data:image/png;base64,secret-image-payload',
      },
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.inferredCapabilities.supportsVision).toBe(true)
    expect(body.inferredCapabilities.supportsJsonSchema).toBe(true)
    expect(body.inferredCapabilities.supportsStreaming).toBe(true)
    expect(JSON.stringify(body)).not.toContain('provider-vision-secret')
    expect(JSON.stringify(body)).not.toContain('secret-image-payload')
    expect(JSON.stringify(body)).toContain('[redacted image payload]')
  })

  it('stops capability probes after an authentication failure and reports one connection error', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const requestUrls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      requestUrls.push(String(url))
      return new Response(
        "<?xml version='1.0' encoding='UTF-8'?><Error><Code>AuthenticationRequired</Code></Error>",
        { status: 401 },
      )
    }
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })
    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'AIHubMix',
        baseUrl: 'https://aihubmix.com',
        defaultModel: 'grok-4-20-reasoning',
        apiKey: 'expired-key',
      },
    })

    const response = await server.inject({
      method: 'POST',
      url: `/api/providers/${created.json().provider.id}/test`,
      payload: { tests: ['text', 'vision', 'json', 'streaming'] },
    })
    const body = response.json()

    expect(requestUrls).toEqual(['https://aihubmix.com/v1/chat/completions'])
    expect(body.results).toHaveLength(1)
    expect(body.connectionError).toEqual({
      code: 'authentication_or_base_url',
      message: 'Authentication failed. Check the API key and confirm the Base URL points to the provider API.',
      status: 401,
    })
    expect(body.trace).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('expired-key')
  })

  it('keeps an inconclusive vision check unknown instead of recording unsupported', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    let visionProbeUrl = ''
    const fetchImpl: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: Array<{ image_url?: { url?: string } }> }>
      }
      visionProbeUrl = request.messages[0].content.find((part) => part.image_url)?.image_url?.url || ''
      return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 })
    }
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })
    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Busy', baseUrl: 'https://api.example.test/v1', defaultModel: 'custom-alias' },
    })

    const response = await server.inject({
      method: 'POST',
      url: `/api/providers/${created.json().provider.id}/test`,
      payload: { tests: ['vision'] },
    })
    const [capability] = db.listModelCapabilities(created.json().provider.id)

    expect(response.json().results[0]).toMatchObject({ ok: false, outcome: 'indeterminate', status: 429 })
    expect(capability.supportsVision).toBe(false)
    expect(capability.capabilitySources.supportsVision).toBe('unknown')
    expect(visionProbeUrl).toMatch(/^data:image\/png;base64,.{80,}$/)
  })

  it('records unsupported only when the provider explicitly rejects the capability', async () => {
    db = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'vision image input is not supported' }), { status: 400 })
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets, fetchImpl })
    const created = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: { name: 'Text only', baseUrl: 'https://api.example.test/v1', defaultModel: 'custom-alias' },
    })

    const response = await server.inject({
      method: 'POST',
      url: `/api/providers/${created.json().provider.id}/test`,
      payload: { tests: ['vision'] },
    })
    const [capability] = db.listModelCapabilities(created.json().provider.id)

    expect(response.json().results[0]).toMatchObject({ ok: false, outcome: 'unsupported', status: 400 })
    expect(capability.supportsVision).toBe(false)
    expect(capability.capabilitySources.supportsVision).toBe('tested')
  })

  it('keeps local Vision unknown while applying local adult routing policy', async () => {
    db = createDb()
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets: new TestSecretStore(db, new MemoryKeytar()) })

    const response = await server.inject({
      method: 'POST',
      url: '/api/providers',
      payload: {
        name: 'Local Qwen',
        baseUrl: 'http://127.0.0.1:11434/v1',
        defaultModel: 'qwen3-vl:8b',
        isLocal: true,
      },
    })
    const [capability] = db.listModelCapabilities(response.json().provider.id)

    expect(capability).toMatchObject({
      supportsVision: false,
      allowsAdultInput: true,
      allowsAdultGeneration: true,
      capabilitySources: {
        supportsVision: 'unknown',
        allowsAdultInput: 'local-policy',
        allowsAdultGeneration: 'local-policy',
      },
    })
  })

  it('removes legacy model-name evidence while preserving local adult policy', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-provider-legacy-test-'))
    const dbPath = path.join(dir, 'studio.sqlite')
    db = new StudioDatabase(dbPath, false)
    const provider = db.createProvider({
      name: 'Stored Local Qwen',
      baseUrl: 'http://127.0.0.1:11434/v1',
      defaultModel: 'qwen3-vl:8b',
      isLocal: true,
    })
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: provider.defaultModel,
      supportsVision: true,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    })
    const legacyDb = new DatabaseSync(dbPath)
    legacyDb
      .prepare('UPDATE model_capabilities SET capabilitySourcesJson = ? WHERE providerId = ? AND modelId = ?')
      .run(JSON.stringify({ supportsVision: 'model-id' }), provider.id, provider.defaultModel)
    legacyDb.close()

    registerProviderLabRoutes(fastify(), { db, secrets: new TestSecretStore(db, new MemoryKeytar()) })
    const [capability] = db.listModelCapabilities(provider.id)

    expect(capability.supportsVision).toBe(false)
    expect(capability.capabilitySources.supportsVision).toBe('unknown')
    expect(capability.allowsAdultInput).toBe(true)
    expect(capability.allowsAdultGeneration).toBe(true)
  })

  it('allows user updates to model capability records', async () => {
    db = createDb()
    const capability = db.createProvider({
      name: 'Remote',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'gpt-4o',
      isLocal: false,
    })
    const stored = db.upsertModelCapability({ providerId: capability.id, modelId: 'gpt-4o' })
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/model-capabilities/${stored.id}`,
      payload: { supportsVision: true, supportsImageGeneration: true, allowsAdultInput: true, notes: 'User confirmed.' },
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.capability.supportsVision).toBe(true)
    expect(body.capability.supportsImageGeneration).toBe(true)
    expect(body.capability.allowsAdultInput).toBe(true)
    expect(body.capability.source).toBe('user')
    expect(body.capability.capabilitySources.supportsVision).toBe('user')
    expect(body.capability.capabilitySources.supportsImageGeneration).toBe('user')
    expect(body.capability.capabilitySources.allowsAdultInput).toBe('user')
    expect(body.capability.capabilitySources.supportsStreaming).not.toBe('user')
    expect(body.capability.capabilitySources.allowsAdultGeneration).not.toBe('user')
  })

  it('changes only the provider fields a patch sends', async () => {
    db = createDb()
    const local = db.createProvider({ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen3-vl:8b', isLocal: true })
    const remote = db.createProvider({ name: 'Remote', baseUrl: 'https://api.example.test/v1', defaultModel: 'gpt-4o', isLocal: false })
    const server = fastify()
    registerProviderLabRoutes(server, { db, secrets: new TestSecretStore(db, new MemoryKeytar()) })

    const renamed = await server.inject({ method: 'PATCH', url: `/api/providers/${local.id}`, payload: { name: 'Ollama (desk)' } })
    expect(renamed.statusCode).toBe(200)
    expect(db.getProvider(local.id)).toMatchObject({ name: 'Ollama (desk)', defaultModel: 'qwen3-vl:8b', isLocal: true })

    const moved = await server.inject({ method: 'PATCH', url: `/api/providers/${remote.id}`, payload: { baseUrl: 'https://api.other.test/v1/' } })
    expect(moved.statusCode).toBe(200)
    expect(db.getProvider(remote.id)).toMatchObject({ name: 'Remote', baseUrl: 'https://api.other.test/v1', defaultModel: 'gpt-4o' })
  })
})

describe('SecretStore keytar module normalization', () => {
  it('accepts CommonJS and ESM default keytar shapes only when credential methods exist', () => {
    const keytar = new MemoryKeytar()

    expect(normalizeKeytarModule(keytar)).toBe(keytar)
    expect(normalizeKeytarModule({ default: keytar })).toBe(keytar)
    expect(normalizeKeytarModule({ default: {} })).toBeNull()
    expect(normalizeKeytarModule({ setPassword: keytar.setPassword })).toBeNull()
  })

  it('can use an explicit in-memory keytar for isolated E2E processes', async () => {
    process.env.PTM_TEST_MEMORY_KEYTAR = '1'
    const db = createDb()
    const secrets = new SecretStore(db)

    await secrets.setProviderApiKey('provider-1', 'provider-e2e-secret')

    await expect(secrets.getProviderApiKey('provider-1')).resolves.toBe('provider-e2e-secret')
  })
})

describe('evaluateRouteSafety', () => {
  it('fails closed for illegal or unsupported image routes', () => {
    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
        r18: true,
        imagePresent: false,
        safetyClass: 'illegal',
      }),
    ).toEqual({ allow: false, reason: 'illegal_content' })

    expect(
      evaluateRouteSafety({
        supportsVision: false,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
        r18: false,
        imagePresent: true,
        safetyClass: 'safe',
      }),
    ).toEqual({ allow: false, reason: 'vision_required' })
  })

  it('requires r18 and adult input support for explicit image input', () => {
    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
        r18: false,
        imagePresent: true,
        safetyClass: 'explicit',
      }),
    ).toEqual({ allow: false, reason: 'r18_disabled' })

    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: false,
        allowsAdultGeneration: true,
        r18: true,
        imagePresent: true,
        safetyClass: 'explicit',
      }),
    ).toEqual({ allow: false, reason: 'explicit_image_not_allowed' })
  })

  it('fails closed when image safety classification is unknown or failed', () => {
    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
        r18: true,
        imagePresent: true,
        safetyClass: 'unknown',
      }),
    ).toEqual({ allow: false, reason: 'safety_unknown' })

    expect(
      evaluateRouteSafety({
        supportsVision: false,
        allowsAdultInput: false,
        allowsAdultGeneration: false,
        r18: false,
        imagePresent: false,
        safetyClass: 'unknown',
      }),
    ).toEqual({ allow: false, reason: 'safety_unknown' })

    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
        r18: true,
        imagePresent: true,
        safetyClass: 'failed',
      }),
    ).toEqual({ allow: false, reason: 'safety_classification_failed' })
  })

  it('requires explicit opt-in for suggestive image routes and adult generation', () => {
    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: true,
        allowsAdultGeneration: true,
        r18: false,
        imagePresent: true,
        safetyClass: 'suggestive',
      }),
    ).toEqual({ allow: false, reason: 'r18_disabled' })

    expect(
      evaluateRouteSafety({
        supportsVision: true,
        allowsAdultInput: true,
        allowsAdultGeneration: false,
        r18: true,
        imagePresent: false,
        safetyClass: 'safe',
      }),
    ).toEqual({ allow: false, reason: 'adult_generation_not_allowed' })
  })
})
