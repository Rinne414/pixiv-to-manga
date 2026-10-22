import type { FastifyInstance } from 'fastify'
import type { ModelCapability, ModelCapabilityFlag, ProviderProfile } from '../src/shared/types'
import {
  discoverModelsSchema,
  legacyModelDiscoverySchema,
  legacyProviderTestSchema,
  modelCapabilityIdParamSchema,
  modelCapabilityPatchSchema,
  providerIdParamSchema,
  providerProfileCreateSchema,
  providerProfilePatchSchema,
  providerTestSchema,
} from '../src/shared/schemas'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import { isPrivateProviderUrl, isTrustedLocalProvider, normalizeBaseUrl } from './providerResolution'
import {
  capabilitySeedPatch,
  deriveModelCapabilities,
  parseProviderModels,
  type ProviderModelCandidate,
} from './modelCapabilities'

export { parseProviderModels } from './modelCapabilities'

export interface ProviderLabContext {
  db: StudioDatabase
  secrets: SecretStore
  fetchImpl?: typeof fetch
}

interface SensitiveValue {
  value: string
  replacement: string
}

type ProviderTestKind = 'text' | 'vision' | 'json' | 'streaming'
type CapabilityProbeOutcome = 'supported' | 'unsupported' | 'indeterminate'
type ProviderConnectionErrorCode =
  | 'authentication_or_base_url'
  | 'endpoint_not_found'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'network_error'

interface CapabilityProbeResult {
  kind: ProviderTestKind
  ok: boolean
  outcome: CapabilityProbeOutcome
  status?: number
  error?: string
  latencyMs: number
}

interface ProviderConnectionError {
  code: ProviderConnectionErrorCode
  message: string
  status?: number
}

const LOCAL_ENGINE_CANDIDATES = ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:1234/v1']
const LOCAL_DETECT_TIMEOUT_MS = 1500

/** Probes well-known local OpenAI-compatible endpoints (Ollama, LM Studio). */
async function detectLocalEngine(fetchImpl: typeof fetch): Promise<{ found: boolean; baseUrl?: string; models?: string[] }> {
  const candidates = process.env.PTM_LOCAL_DETECT_URLS
    ? process.env.PTM_LOCAL_DETECT_URLS.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : LOCAL_ENGINE_CANDIDATES
  for (const baseUrl of candidates) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, {
        signal: AbortSignal.timeout(LOCAL_DETECT_TIMEOUT_MS),
      })
      if (!response.ok) continue
      const rawText = await response.text()
      const models = parseProviderModels(rawText).map((model) => model.id)
      if (models.length) {
        return { found: true, baseUrl, models }
      }
    } catch {
      // Endpoint not running — try the next candidate; "not found" is a normal outcome.
    }
  }
  return { found: false }
}

export function registerProviderLabRoutes(server: FastifyInstance, context: ProviderLabContext): void {
  const service = new ProviderLabService(context)
  service.reconcileStoredProviderUrls()
  service.reconcileStoredProviderCapabilities()

  server.get('/api/providers', async () => ({ providers: await service.listProviders() }))

  server.post('/api/providers/detect-local', async () => detectLocalEngine(context.fetchImpl || fetch))

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

  server.post('/api/settings/models', async (request) => {
    const input = legacyModelDiscoverySchema.parse(request.body)
    const discovered = await discoverProviderModelsFromConfig({
      baseUrl: input.apiBaseUrl,
      apiKey: input.apiKey?.trim() || await context.secrets.getApiKey(),
      fetchImpl: context.fetchImpl || fetch,
    })
    return {
      models: discovered.models.map((model) => ({ id: model.id, name: model.id, ownedBy: model.ownedBy })),
      trace: discovered.trace,
    }
  })

  server.post('/api/settings/test', async (request) => {
    const input = legacyProviderTestSchema.parse(request.body)
    const result = await testProviderConfig({
      baseUrl: input.apiBaseUrl,
      apiKey: input.apiKey?.trim() || await context.secrets.getApiKey(),
      modelId: input.modelName,
      tests: ['text'],
      fetchImpl: context.fetchImpl || fetch,
    })
    return {
      providerId: 'legacy-settings',
      modelId: input.modelName,
      ok: result.results.every((item) => item.ok),
      results: result.results,
      trace: result.trace,
      ...(result.connectionError ? { connectionError: result.connectionError } : {}),
    }
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
    const capabilitySources = Object.fromEntries(
      capabilityFlagNames.flatMap((flag) => (input[flag] === undefined ? [] : [[flag, 'user' as const]])),
    )
    return {
      capability: context.db.updateModelCapability(params.id, {
        ...input,
        contextWindow: input.contextWindow === null ? undefined : input.contextWindow,
        source: 'user',
        capabilitySources,
      }),
    }
  })
}

const capabilityFlagNames = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
] as const

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

  reconcileStoredProviderUrls(): void {
    for (const provider of this.db.listProviders()) {
      const normalizedBaseUrl = normalizeBaseUrl(provider.baseUrl)
      if (normalizedBaseUrl !== provider.baseUrl) {
        this.db.updateProvider(provider.id, { baseUrl: normalizedBaseUrl })
      }
    }
  }

  reconcileStoredProviderCapabilities(): void {
    for (const provider of this.db.listProviders()) {
      for (const capability of this.db.listModelCapabilities(provider.id)) {
        const staleFlags = capabilityFlagNames.filter(
          (flag) => capability.capabilitySources[flag] === 'unknown' && capability[flag],
        )
        if (staleFlags.length > 0) {
          const resetValues = Object.fromEntries(staleFlags.map((flag) => [flag, false])) as Partial<
            Record<ModelCapabilityFlag, boolean>
          >
          const resetSources = Object.fromEntries(staleFlags.map((flag) => [flag, 'unknown' as const]))
          this.db.upsertModelCapability({
            providerId: provider.id,
            modelId: capability.modelId,
            ...resetValues,
            capabilitySources: resetSources,
          })
        }
      }
      if (provider.defaultModel) {
        this.seedModelCapability(provider, { id: provider.defaultModel, declaredCapabilities: {} })
      }
    }
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
    if (provider.defaultModel) {
      this.seedModelCapability(provider, { id: provider.defaultModel, declaredCapabilities: {} })
    }
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
    // Looked up and validated before the key is stored, so a bad patch changes nothing.
    const current = this.db.getProvider(providerId)
    const providerPatch = {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.defaultModel !== undefined ? { defaultModel: patch.defaultModel.trim() } : {}),
      ...(patch.isLocal !== undefined ? { isLocal: patch.isLocal } : {}),
      ...(patch.baseUrl !== undefined || patch.isLocal !== undefined
        ? { baseUrl: normalizeProviderBaseUrl(patch.baseUrl ?? current.baseUrl, patch.isLocal ?? current.isLocal) }
        : {}),
    }
    if (patch.apiKey) {
      await this.secrets.setProviderApiKey(providerId, patch.apiKey)
    }
    if (Object.keys(providerPatch).length > 0) {
      this.db.updateProvider(providerId, providerPatch)
    }
    const updated = this.db.getProvider(providerId)
    if (updated.defaultModel) {
      this.seedModelCapability(updated, { id: updated.defaultModel, declaredCapabilities: {} })
    }
    return this.withSecretStatus(updated)
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
    const discovered = await discoverProviderModelsFromConfig({
      baseUrl: provider.baseUrl,
      apiKey,
      discoverPath,
      fetchImpl: this.fetchImpl,
    })
    const existingByModelId = new Map(
      this.db.listModelCapabilities(provider.id).map((capability) => [capability.modelId, capability]),
    )
    const models = discovered.models.map((candidate) => this.seedModelCapability(provider, candidate, existingByModelId.get(candidate.id)))

    return { models, trace: discovered.trace }
  }

  async testProvider(
    providerId: string,
    input: { modelId?: string; tests: ProviderTestKind[]; imageDataUrl?: string },
  ): Promise<{
    providerId: string
    modelId: string
    ok: boolean
    results: CapabilityProbeResult[]
    inferredCapabilities: Omit<ModelCapability, 'id' | 'providerId' | 'createdAt' | 'updatedAt'>
    trace: RedactedTrace[]
    connectionError?: ProviderConnectionError
  }> {
    const provider = this.db.getProvider(providerId, await this.secrets.hasProviderApiKey(providerId))
    const apiKey = await this.secrets.getProviderApiKey(providerId)
    const modelId = input.modelId || provider.defaultModel
    if (!modelId) {
      throw new Error('Provider test requires a modelId or provider defaultModel')
    }

    const probe = await testProviderConfig({
      baseUrl: provider.baseUrl,
      apiKey,
      modelId,
      tests: input.tests,
      imageDataUrl: input.imageDataUrl,
      fetchImpl: this.fetchImpl,
    })
    const { results, trace: traces, connectionError } = probe

    const existing = this.db
      .listModelCapabilities(provider.id)
      .find((capability) => capability.modelId === modelId)
    const baseline =
      existing || this.seedModelCapability(provider, { id: modelId, declaredCapabilities: {} })
    const probePatch = capabilityProbePatch(baseline, results)
    const capability = this.db.upsertModelCapability({
      providerId: provider.id,
      modelId,
      ...probePatch,
      notes: probePatch.capabilitySources ? 'Updated from provider capability checks.' : baseline.notes,
      source: baseline.source === 'user' ? 'user' : probePatch.capabilitySources ? 'tested' : baseline.source,
    })

    return {
      providerId,
      modelId,
      ok: results.every((result) => result.ok),
      results,
      inferredCapabilities: {
        modelId: capability.modelId,
        supportsVision: capability.supportsVision,
        supportsImageGeneration: capability.supportsImageGeneration,
        supportsStreaming: capability.supportsStreaming,
        supportsJsonSchema: capability.supportsJsonSchema,
        allowsAdultInput: capability.allowsAdultInput,
        allowsAdultGeneration: capability.allowsAdultGeneration,
        contextWindow: capability.contextWindow,
        notes: capability.notes,
        source: capability.source,
        capabilitySources: capability.capabilitySources,
      },
      trace: traces,
      ...(connectionError ? { connectionError } : {}),
    }
  }

  private async withSecretStatus(provider: ProviderProfile): Promise<ProviderProfile> {
    return { ...provider, hasApiKey: await this.secrets.hasProviderApiKey(provider.id) }
  }

  private seedModelCapability(
    provider: ProviderProfile,
    candidate: ProviderModelCandidate,
    knownCapability?: ModelCapability,
  ): ModelCapability {
    const seed = deriveModelCapabilities(candidate, isTrustedLocalProvider(provider))
    const existing = knownCapability || this.db.listModelCapabilities(provider.id).find((item) => item.modelId === candidate.id)
    const notes = candidate.ownedBy ? `owned_by=${candidate.ownedBy}` : ''
    if (existing) {
      return this.db.upsertModelCapability({
        providerId: provider.id,
        modelId: candidate.id,
        ...capabilitySeedPatch(existing, seed),
      })
    }
    return this.db.upsertModelCapability({
      providerId: provider.id,
      modelId: candidate.id,
      ...seed,
      notes,
      source: 'discovered',
    })
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

export interface ProviderProbeConfig {
  baseUrl: string
  apiKey: string | null
  modelId: string
  tests: ProviderTestKind[]
  imageDataUrl?: string
  fetchImpl: typeof fetch
}

export interface ProviderProbeResponse {
  results: CapabilityProbeResult[]
  trace: RedactedTrace[]
  connectionError?: ProviderConnectionError
}

export async function discoverProviderModelsFromConfig(input: {
  baseUrl: string
  apiKey: string | null
  discoverPath?: string
  fetchImpl: typeof fetch
}): Promise<{ models: ProviderModelCandidate[]; trace: RedactedTrace }> {
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl)
  if (!normalizedBaseUrl) {
    throw new Error('Provider model discovery requires a Base URL.')
  }
  const url = joinProviderUrl(normalizedBaseUrl, normalizeDiscoverPath(input.discoverPath || '/models'))
  const headers = providerHeaders(input.apiKey)
  const startedAt = Date.now()
  const response = await input.fetchImpl(url, { method: 'GET', headers })
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

  return { models: parseProviderModels(rawText), trace }
}

export async function testProviderConfig(input: ProviderProbeConfig): Promise<ProviderProbeResponse> {
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl)
  if (!normalizedBaseUrl) {
    throw new Error('Provider test requires a Base URL.')
  }
  const results: CapabilityProbeResult[] = []
  const traces: RedactedTrace[] = []
  let connectionError: ProviderConnectionError | undefined

  for (const kind of input.tests) {
    const requestBody = buildChatTestBody(input.modelId, kind, input.imageDataUrl)
    const url = joinProviderUrl(normalizedBaseUrl, '/chat/completions')
    const headers = providerHeaders(input.apiKey)
    const startedAt = Date.now()
    try {
      const response = await input.fetchImpl(url, {
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
      results.push(assessCapabilityProbe(kind, response.status, rawText, latencyMs))
      connectionError = providerConnectionError(response.status)
      if (connectionError) {
        break
      }
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
        outcome: 'indeterminate',
        error: error instanceof Error ? error.message : 'Provider test failed',
        latencyMs,
      })
      connectionError = {
        code: 'network_error',
        message: 'The provider could not be reached. Check the Base URL and network connection.',
      }
      break
    }
  }

  return {
    results,
    trace: traces,
    ...(connectionError ? { connectionError } : {}),
  }
}

function normalizeProviderBaseUrl(value: string, isLocal: boolean): string {
  const normalized = normalizeBaseUrl(value)
  if (!normalized) return ''
  const parsed = new URL(normalized)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Provider base URL must use http or https.')
  }
  if (!isLocal && parsed.protocol !== 'https:') {
    throw new Error('External provider base URL must use https.')
  }
  if (!isLocal && isLocalHostname(parsed.hostname)) {
    throw new Error('External provider base URL must not target localhost or private network hosts.')
  }
  if (isLocal && !isPrivateProviderUrl(parsed.toString())) {
    throw new Error('Local provider base URL must target localhost or a private network host.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function providerConnectionError(status: number): ProviderConnectionError | undefined {
  if (status === 401 || status === 403) {
    return {
      code: 'authentication_or_base_url',
      message: 'Authentication failed. Check the API key and confirm the Base URL points to the provider API.',
      status,
    }
  }
  if (status === 404) {
    return {
      code: 'endpoint_not_found',
      message: 'The chat endpoint was not found. Check that the Base URL includes the provider API prefix, such as /v1.',
      status,
    }
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: 'The provider rate limit was reached. Wait and run the test again.',
      status,
    }
  }
  if (status >= 500) {
    return {
      code: 'provider_unavailable',
      message: 'The provider is temporarily unavailable. Run the test again after the service recovers.',
      status,
    }
  }
  return undefined
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
  return isPrivateProviderUrl(`http://${hostname}`)
}

function providerHeaders(apiKey: string | null): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
  }
}

const VISION_PROBE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function buildChatTestBody(modelId: string, kind: ProviderTestKind, imageDataUrl?: string): Record<string, unknown> {
  const prompt = kind === 'json' ? 'Return exactly {"ok":true}.' : `Provider Lab ${kind} capability test. Reply with OK.`
  const content: unknown[] = [{ type: 'text', text: prompt }]
  if (kind === 'vision') {
    content.push({
      type: 'image_url',
      image_url: { url: imageDataUrl || VISION_PROBE_DATA_URL },
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

export function assessCapabilityProbe(
  kind: ProviderTestKind,
  status: number,
  rawText: string,
  latencyMs: number,
): CapabilityProbeResult {
  if (status < 200 || status >= 300) {
    const explicitlyUnsupported = [400, 404, 415, 422].includes(status) && unsupportedCapabilityError(kind, rawText)
    return {
      kind,
      ok: false,
      outcome: explicitlyUnsupported ? 'unsupported' : 'indeterminate',
      status,
      error: explicitlyUnsupported
        ? `Provider explicitly rejected the ${kind} capability.`
        : `Capability check was inconclusive: HTTP ${status}.`,
      latencyMs,
    }
  }

  const valid = kind === 'streaming' ? isValidStreamingResponse(rawText) : isValidChatResponse(kind, rawText)
  return {
    kind,
    ok: valid,
    outcome: valid ? 'supported' : 'indeterminate',
    status,
    ...(valid ? {} : { error: `Provider returned HTTP ${status}, but the ${kind} response format was invalid.` }),
    latencyMs,
  }
}

function capabilityProbePatch(
  current: ModelCapability,
  results: CapabilityProbeResult[],
): Partial<Record<(typeof capabilityFlagNames)[number], boolean>> & {
  capabilitySources?: Partial<ModelCapability['capabilitySources']>
} {
  const values: Partial<Record<(typeof capabilityFlagNames)[number], boolean>> = {}
  const sources: Partial<ModelCapability['capabilitySources']> = {}
  const flagByTest: Partial<Record<ProviderTestKind, (typeof capabilityFlagNames)[number]>> = {
    vision: 'supportsVision',
    json: 'supportsJsonSchema',
    streaming: 'supportsStreaming',
  }
  for (const result of results) {
    const flag = flagByTest[result.kind]
    if (!flag || result.outcome === 'indeterminate' || current.capabilitySources[flag] === 'user') continue
    values[flag] = result.outcome === 'supported'
    sources[flag] = 'tested'
  }
  return Object.keys(sources).length ? { ...values, capabilitySources: sources } : values
}

function unsupportedCapabilityError(kind: ProviderTestKind, rawText: string): boolean {
  const normalized = rawText.toLowerCase()
  const capabilityTerms: Record<ProviderTestKind, string[]> = {
    text: ['text', 'chat', 'completion'],
    vision: ['vision', 'image', 'multimodal', 'image_url'],
    json: ['json', 'schema', 'response_format', 'structured'],
    streaming: ['stream', 'sse'],
  }
  return (
    capabilityTerms[kind].some((term) => normalized.includes(term)) &&
    /(not supported|unsupported|does not support|unknown (?:field|parameter|type)|invalid (?:content|parameter|type))/.test(
      normalized,
    )
  )
}

function isValidChatResponse(kind: ProviderTestKind, rawText: string): boolean {
  try {
    const payload = JSON.parse(rawText) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const choices = (payload as { choices?: unknown }).choices
    if (!Array.isArray(choices) || !choices.length) return false
    const first = choices[0]
    if (!first || typeof first !== 'object') return false
    const message = (first as { message?: unknown }).message
    if (!message || typeof message !== 'object') return false
    const content = (message as { content?: unknown }).content
    if (typeof content !== 'string' || !content.trim()) return false
    if (kind !== 'json') return true
    const json = JSON.parse(content) as unknown
    return Boolean(json && typeof json === 'object' && !Array.isArray(json) && (json as { ok?: unknown }).ok === true)
  } catch {
    return false
  }
}

function isValidStreamingResponse(rawText: string): boolean {
  const events = rawText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
  if (!events.length) return false
  return events.some((event) => {
    if (event === '[DONE]') return true
    try {
      const payload = JSON.parse(event) as { choices?: unknown[] }
      return Array.isArray(payload.choices)
    } catch {
      return false
    }
  })
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
