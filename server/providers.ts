import type { FastifyInstance } from 'fastify'
import type { ModelCapability, ProviderProfile } from '../src/shared/types'
import {
  discoverModelsSchema,
  modelCapabilityIdParamSchema,
  modelCapabilityPatchSchema,
  providerIdParamSchema,
  providerProfileCreateSchema,
  providerProfilePatchSchema,
  providerTestSchema,
} from '../src/shared/schemas'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'

export interface ProviderLabContext {
  db: StudioDatabase
  secrets: SecretStore
  fetchImpl?: typeof fetch
}

interface ProviderModelCandidate {
  id: string
  ownedBy?: string
  rawType?: string
}

interface SensitiveValue {
  value: string
  replacement: string
}

export function registerProviderLabRoutes(server: FastifyInstance, context: ProviderLabContext): void {
  const service = new ProviderLabService(context)

  server.get('/api/providers', async () => ({ providers: await service.listProviders() }))

  server.post('/api/providers', async (request) => {
    const input = providerProfileCreateSchema.parse(request.body)
    return { provider: await service.createProvider(input) }
  })

  server.patch('/api/providers/:id', async (request) => {
    const params = providerIdParamSchema.parse(request.params)
    const input = providerProfilePatchSchema.parse(request.body)
    return { provider: await service.updateProvider(params.id, input) }
  })

  server.delete('/api/providers/:id', async (request) => {
    const params = providerIdParamSchema.parse(request.params)
    await service.deleteProvider(params.id)
    return { ok: true }
  })

  server.post('/api/providers/:id/models/discover', async (request) => {
    const params = providerIdParamSchema.parse(request.params)
    const input = discoverModelsSchema.parse(request.body ?? {})
    return service.discoverModels(params.id, input.path)
  })

  server.post('/api/providers/:id/test', async (request) => {
    const params = providerIdParamSchema.parse(request.params)
    const input = providerTestSchema.parse(request.body ?? {})
    return service.testProvider(params.id, input)
  })

  server.get('/api/model-capabilities', async (request) => {
    const providerId =
      typeof (request.query as { providerId?: unknown }).providerId === 'string'
        ? (request.query as { providerId: string }).providerId
        : undefined
    return { capabilities: context.db.listModelCapabilities(providerId) }
  })

  server.patch('/api/model-capabilities/:id', async (request) => {
    const params = modelCapabilityIdParamSchema.parse(request.params)
    const input = modelCapabilityPatchSchema.parse(request.body)
    return {
      capability: context.db.updateModelCapability(params.id, {
        ...input,
        contextWindow: input.contextWindow === null ? undefined : input.contextWindow,
        source: input.source || 'user',
      }),
    }
  })
}

export class ProviderLabService {
  private db: StudioDatabase
  private secrets: SecretStore
  private fetchImpl: typeof fetch

  constructor(context: ProviderLabContext) {
    this.db = context.db
    this.secrets = context.secrets
    this.fetchImpl = context.fetchImpl || fetch
  }

  async listProviders(): Promise<ProviderProfile[]> {
    const providers = this.db.listProviders()
    return Promise.all(providers.map((provider) => this.withSecretStatus(provider)))
  }

  async createProvider(input: {
    name: string
    baseUrl: string
    defaultModel: string
    isLocal: boolean
    apiKey?: string
  }): Promise<ProviderProfile> {
    const provider = this.db.createProvider({
      name: input.name.trim(),
      baseUrl: normalizeProviderBaseUrl(input.baseUrl, input.isLocal),
      defaultModel: input.defaultModel.trim(),
      isLocal: input.isLocal,
    })
    if (input.apiKey) {
      try {
        await this.secrets.setProviderApiKey(provider.id, input.apiKey)
      } catch (error) {
        this.db.deleteProvider(provider.id)
        throw error
      }
    }
    return this.withSecretStatus(provider)
  }

  async updateProvider(
    providerId: string,
    patch: Partial<{ name: string; baseUrl: string; defaultModel: string; isLocal: boolean; apiKey: string }>,
  ): Promise<ProviderProfile> {
    const providerPatch = {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.defaultModel !== undefined ? { defaultModel: patch.defaultModel.trim() } : {}),
      ...(patch.isLocal !== undefined ? { isLocal: patch.isLocal } : {}),
    }
    if (patch.apiKey) {
      await this.secrets.setProviderApiKey(providerId, patch.apiKey)
    }
    if (Object.keys(providerPatch).length > 0) {
      const current = this.db.getProvider(providerId)
      this.db.updateProvider(providerId, {
        ...providerPatch,
        ...(patch.baseUrl !== undefined || patch.isLocal !== undefined
          ? { baseUrl: normalizeProviderBaseUrl(patch.baseUrl ?? current.baseUrl, patch.isLocal ?? current.isLocal) }
          : {}),
      })
    } else {
      this.db.getProvider(providerId)
    }
    return this.withSecretStatus(this.db.getProvider(providerId))
  }

  async deleteProvider(providerId: string): Promise<void> {
    this.db.getProvider(providerId)
    this.db.deleteProvider(providerId)
    await this.secrets.deleteProviderApiKey(providerId)
  }

  async discoverModels(providerId: string, discoverPath = '/models'): Promise<{
    models: ModelCapability[]
    trace: RedactedTrace
  }> {
    const provider = this.db.getProvider(providerId, await this.secrets.hasProviderApiKey(providerId))
    const apiKey = await this.secrets.getProviderApiKey(providerId)
    const url = joinProviderUrl(provider.baseUrl, normalizeDiscoverPath(discoverPath))
    const headers = providerHeaders(apiKey)
    const startedAt = Date.now()
    const response = await this.fetchImpl(url, { method: 'GET', headers })
    const rawText = await response.text()
    const trace = redactedTrace({
      url,
      method: 'GET',
      headers,
      body: undefined,
      status: response.status,
      responseBody: rawText,
      latencyMs: Date.now() - startedAt,
    })

    if (!response.ok) {
      throw new Error(`Provider model discovery failed: HTTP ${response.status}`)
    }

    const candidates = parseProviderModels(rawText)
    const models = candidates.map((candidate) => {
      const inferred = inferCapabilities(candidate.id)
      return this.db.upsertModelCapability({
        providerId: provider.id,
        modelId: candidate.id,
        supportsVision: inferred.supportsVision,
        supportsStreaming: inferred.supportsStreaming,
        supportsJsonSchema: inferred.supportsJsonSchema,
        allowsAdultInput: false,
        allowsAdultGeneration: false,
        contextWindow: inferred.contextWindow,
        notes: candidate.ownedBy ? `owned_by=${candidate.ownedBy}` : '',
        source: 'discovered',
      })
    })

    return { models, trace }
  }

  async testProvider(
    providerId: string,
    input: { modelId?: string; tests: Array<'text' | 'vision' | 'json' | 'streaming'>; imageDataUrl?: string },
  ): Promise<{
    providerId: string
    modelId: string
    ok: boolean
    results: Array<{ kind: string; ok: boolean; status?: number; error?: string; latencyMs: number }>
    inferredCapabilities: Omit<ModelCapability, 'id' | 'providerId' | 'createdAt' | 'updatedAt'>
    trace: RedactedTrace[]
  }> {
    const provider = this.db.getProvider(providerId, await this.secrets.hasProviderApiKey(providerId))
    const apiKey = await this.secrets.getProviderApiKey(providerId)
    const modelId = input.modelId || provider.defaultModel
    if (!modelId) {
      throw new Error('Provider test requires a modelId or provider defaultModel')
    }

    const results = []
    const traces: RedactedTrace[] = []

    for (const kind of input.tests) {
      const requestBody = buildChatTestBody(modelId, kind, input.imageDataUrl)
      const url = joinProviderUrl(provider.baseUrl, '/chat/completions')
      const headers = providerHeaders(apiKey)
      const startedAt = Date.now()
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        })
        const rawText = await response.text()
        const latencyMs = Date.now() - startedAt
        traces.push(
          redactedTrace({
            url,
            method: 'POST',
            headers,
            body: requestBody,
            status: response.status,
            responseBody: rawText,
            latencyMs,
          }),
        )
        results.push({ kind, ok: response.ok, status: response.status, latencyMs })
      } catch (error) {
        const latencyMs = Date.now() - startedAt
        traces.push(
          redactedTrace({
            url,
            method: 'POST',
            headers,
            body: requestBody,
            status: 0,
            responseBody: '',
            latencyMs,
          }),
        )
        results.push({
          kind,
          ok: false,
          error: error instanceof Error ? error.message : 'Provider test failed',
          latencyMs,
        })
      }
    }

    const inferredCapabilities = {
      modelId,
      supportsVision: input.tests.includes('vision') && results.some((result) => result.kind === 'vision' && result.ok),
      supportsStreaming:
        input.tests.includes('streaming') && results.some((result) => result.kind === 'streaming' && result.ok),
      supportsJsonSchema: input.tests.includes('json') && results.some((result) => result.kind === 'json' && result.ok),
      allowsAdultInput: false,
      allowsAdultGeneration: false,
      contextWindow: inferCapabilities(modelId).contextWindow,
      notes: 'Updated from provider test endpoint. Adult capability remains user-confirmed only.',
      source: 'tested' as const,
    }

    this.db.upsertModelCapability({
      providerId: provider.id,
      ...inferredCapabilities,
    })

    return {
      providerId,
      modelId,
      ok: results.every((result) => result.ok),
      results,
      inferredCapabilities,
      trace: traces,
    }
  }

  private async withSecretStatus(provider: ProviderProfile): Promise<ProviderProfile> {
    return { ...provider, hasApiKey: await this.secrets.hasProviderApiKey(provider.id) }
  }
}

export interface RedactedTrace {
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body?: unknown
  }
  response: {
    status: number
    body: unknown
  }
  latencyMs: number
}

export function parseProviderModels(rawText: string): ProviderModelCandidate[] {
  const payload = JSON.parse(rawText) as unknown
  let items: unknown[] = []
  if (Array.isArray(payload)) {
    items = payload
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) {
      items = record.data
    } else if (Array.isArray(record.models)) {
      items = record.models
    }
  }

  return items
    .map((item): ProviderModelCandidate | null => {
      if (typeof item === 'string') return { id: item }
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : typeof record.name === 'string' ? record.name : ''
      if (!id) return null
      return {
        id,
        ownedBy: typeof record.owned_by === 'string' ? record.owned_by : undefined,
        rawType: typeof record.object === 'string' ? record.object : undefined,
      }
    })
    .filter((candidate): candidate is ProviderModelCandidate => Boolean(candidate))
}

function normalizeProviderBaseUrl(value: string, isLocal: boolean): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`
  const parsed = new URL(withScheme)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Provider base URL must use http or https.')
  }
  if (!isLocal && parsed.protocol !== 'https:') {
    throw new Error('External provider base URL must use https.')
  }
  if (!isLocal && isLocalHostname(parsed.hostname)) {
    throw new Error('External provider base URL must not target localhost or private network hosts.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function joinProviderUrl(baseUrl: string, routePath: string): string {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`
  return `${baseUrl.replace(/\/+$/, '')}${normalizedPath}`
}

function normalizeDiscoverPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) {
    throw new Error('Model discovery path must be a relative path starting with /.')
  }
  if (trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error('Model discovery path must not be an absolute URL.')
  }
  return trimmed
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  )
}

function providerHeaders(apiKey: string | null): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
  }
}

function inferCapabilities(modelId: string): {
  supportsVision: boolean
  supportsStreaming: boolean
  supportsJsonSchema: boolean
  contextWindow?: number
} {
  const normalized = modelId.toLowerCase()
  return {
    supportsVision: /\b(vision|vlm|gpt-4o|gpt-5|gemini|qwen-vl|llava|pixtral)\b/.test(normalized),
    supportsStreaming: true,
    supportsJsonSchema: /(gpt-4o|gpt-5|json|structured|gemini|qwen)/.test(normalized),
    contextWindow: normalized.includes('32k') ? 32768 : normalized.includes('128k') ? 128000 : undefined,
  }
}

function buildChatTestBody(modelId: string, kind: string, imageDataUrl?: string): Record<string, unknown> {
  const content: unknown[] = [{ type: 'text', text: `Provider Lab ${kind} capability test. Reply with OK.` }]
  if (kind === 'vision') {
    content.push({
      type: 'image_url',
      image_url: { url: imageDataUrl || 'data:image/png;base64,iVBORw0KGgo=' },
    })
  }
  return {
    model: modelId,
    messages: [{ role: 'user', content }],
    stream: kind === 'streaming',
    ...(kind === 'json'
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'provider_lab_test',
              schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
            },
          },
        }
      : {}),
  }
}

function redactedTrace(input: {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  status: number
  responseBody: string
  latencyMs: number
}): RedactedTrace {
  const sensitiveValues = collectSensitiveValues(input.headers, input.body)
  return {
    request: {
      method: input.method,
      url: redactValue(input.url, sensitiveValues) as string,
      headers: redactValue(input.headers, sensitiveValues) as Record<string, string>,
      body: input.body === undefined ? undefined : redactValue(input.body, sensitiveValues),
    },
    response: {
      status: input.status,
      body: redactResponseBody(input.responseBody, sensitiveValues),
    },
    latencyMs: input.latencyMs,
  }
}

function redactResponseBody(value: string, sensitiveValues: SensitiveValue[]): unknown {
  if (!value) return ''
  try {
    return redactValue(JSON.parse(value), sensitiveValues)
  } catch {
    return redactValue(value, sensitiveValues)
  }
}

function redactValue(value: unknown, sensitiveValues: SensitiveValue[] = []): unknown {
  if (typeof value === 'string') {
    let redacted = value
    for (const sensitive of sensitiveValues) {
      if (sensitive.value && redacted.includes(sensitive.value)) {
        redacted = redacted.split(sensitive.value).join(sensitive.replacement)
      }
    }
    if (/^data:image\//.test(redacted)) return '[redacted image payload]'
    if (/secret-image-payload/i.test(redacted)) return '[redacted image payload]'
    if (/sk-[a-z0-9._-]+/i.test(redacted)) return '[redacted secret]'
    if (/bearer\s+[a-z0-9._-]+/i.test(redacted)) return 'Bearer [redacted]'
    return redacted.replace(/(api[_-]?key=)[^&\s]+/gi, '$1[redacted]')
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, sensitiveValues))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
        if (/authorization|api[-_]?key|cookie|secret|token/i.test(key)) {
          return [key, '[redacted]']
        }
        if (/image|dataurl|data_url/i.test(key)) {
          return [key, '[redacted image payload]']
        }
        return [key, redactValue(nestedValue, sensitiveValues)]
      }),
    )
  }
  return value
}

function collectSensitiveValues(headers: Record<string, string>, body: unknown): SensitiveValue[] {
  const values: SensitiveValue[] = []

  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|api[-_]?key|cookie|secret|token/i.test(key)) {
      addSensitiveValue(values, value, '[redacted]')
      const bearer = value.match(/^bearer\s+(.+)$/i)
      if (bearer?.[1]) {
        addSensitiveValue(values, bearer[1], '[redacted secret]')
      }
    }
  }

  collectSensitiveValuesFromBody(body, values)
  return values.sort((a, b) => b.value.length - a.value.length)
}

function collectSensitiveValuesFromBody(value: unknown, values: SensitiveValue[]): void {
  if (typeof value === 'string') {
    if (/^data:image\//.test(value)) {
      addSensitiveValue(values, value, '[redacted image payload]')
      const payload = value.split(',', 2)[1]
      if (payload) {
        addSensitiveValue(values, payload, '[redacted image payload]')
      }
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSensitiveValuesFromBody(item, values)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (/api[-_]?key|cookie|secret|token/i.test(key) && typeof nestedValue === 'string') {
        addSensitiveValue(values, nestedValue, '[redacted secret]')
      }
      collectSensitiveValuesFromBody(nestedValue, values)
    }
  }
}

function addSensitiveValue(values: SensitiveValue[], value: string, replacement: string): void {
  const trimmed = value.trim()
  if (trimmed.length < 6 || values.some((item) => item.value === trimmed)) {
    return
  }
  values.push({ value: trimmed, replacement })
}
