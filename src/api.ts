import type { Dialogue, Project, ProjectDetail, SecretStatus } from './shared/types'

export interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  defaultModel: string
  isLocal: boolean
  hasApiKey: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ProviderProfileInput {
  name: string
  baseUrl: string
  defaultModel: string
  isLocal: boolean
  apiKey?: string
}

export interface DiscoveredModel {
  id: string
  name?: string
  ownedBy?: string
  createdAt?: string
  capabilityStatus?: 'unknown' | 'detected' | 'user-confirmed' | 'unsupported'
  capabilities?: Partial<ModelCapabilityFlags>
}

export interface ModelCapabilityFlags {
  supportsVision: boolean
  supportsStreaming: boolean
  supportsJsonSchema: boolean
  allowsAdultInput: boolean
  allowsAdultGeneration: boolean
}

export interface ModelCapability extends ModelCapabilityFlags {
  id: string
  providerId: string
  modelId: string
  source?: 'discovered' | 'tested' | 'user'
  updatedAt?: string
}

export interface ProviderTestInput {
  modelId: string
  tests: {
    text: boolean
    vision: boolean
    json: boolean
    streaming: boolean
  }
}

export interface ProviderTestResult {
  kind: keyof ProviderTestInput['tests']
  passed: boolean
  message?: string
}

export interface ProviderTestResponse {
  providerId: string
  modelId: string
  latencyMs: number
  passed: boolean
  results: ProviderTestResult[]
  redactedTrace: string[]
  inferredCapabilities?: Partial<ModelCapabilityFlags>
}

interface ProviderMutationResponse {
  provider: ProviderProfile
}

interface ModelDiscoveryResponse {
  models: ModelCapability[]
  trace?: unknown
}

interface ModelCapabilityResponse {
  capability: ModelCapability
}

interface BackendProviderTestResponse {
  providerId: string
  modelId: string
  ok: boolean
  results: Array<{ kind: ProviderTestResult['kind']; ok: boolean; status?: number; error?: string; latencyMs: number }>
  inferredCapabilities?: Partial<ModelCapabilityFlags>
  trace?: unknown[]
}

export interface AnalyzeStoryInput {
  projectId: string
  userBrief: string
  r18Enabled: boolean
}

export interface GeneratePageInput {
  mode: 'story' | 'translation'
  textDensity: number
}

export interface PixivImportInput {
  projectId?: string
  url: string
  title?: string
  r18Enabled: boolean
}

export interface SecretUpdateInput {
  apiBaseUrl?: string
  modelName?: string
  apiKey?: string
  pixivCookie?: string
}

export type ProjectResponse = ProjectDetail & {
  jobId?: string
  raw?: string
  usedMock?: boolean
}

export async function listProjects(): Promise<Project[]> {
  const payload = await request<{ projects: Project[] }>('/api/projects')
  return payload.projects
}

export function getProject(projectId: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/api/projects/${projectId}`)
}

export function createProject(input: {
  title: string
  mode: 'story' | 'translation'
  source?: 'local' | 'sample'
}): Promise<ProjectDetail> {
  return request<ProjectDetail>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ source: 'local', ...input }),
  })
}

export function importPixiv(input: PixivImportInput): Promise<ProjectDetail> {
  return request<ProjectDetail>('/api/import/pixiv', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function importLocal(files: File[], projectId?: string): Promise<ProjectDetail> {
  const form = new FormData()
  for (const file of files) {
    form.append('files', file)
  }

  return request<ProjectDetail>('/api/import/local', {
    method: 'POST',
    headers: projectId ? { 'x-project-id': projectId } : undefined,
    body: form,
  })
}

export function analyzeStory(input: AnalyzeStoryInput): Promise<ProjectResponse> {
  return request<ProjectResponse>('/api/story/analyze', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function generatePage(pageId: string, input: GeneratePageInput): Promise<ProjectResponse> {
  return request<ProjectResponse>(`/api/pages/${pageId}/generate`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function patchDialogue(id: string, patch: Partial<Dialogue>): Promise<Dialogue> {
  return request<Dialogue>(`/api/dialogues/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function patchPageLayout(
  pageId: string,
  dialogues: Array<Partial<Dialogue> & { id: string }>,
): Promise<{ pageId: string; dialogues: Dialogue[] }> {
  return request<{ pageId: string; dialogues: Dialogue[] }>(`/api/pages/${pageId}/layout`, {
    method: 'PATCH',
    body: JSON.stringify({ dialogues }),
  })
}

export function exportZip(input: {
  projectId: string
  pages: Array<{ pageId: string; dataUrl: string }>
}): Promise<{ fileName: string; absolutePath: string; url: string }> {
  return request<{ fileName: string; absolutePath: string; url: string }>('/api/export/zip', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getSecretStatus(): Promise<SecretStatus> {
  return request<SecretStatus>('/api/settings/secrets')
}

export function saveSecrets(input: SecretUpdateInput): Promise<SecretStatus> {
  return request<SecretStatus>('/api/settings/secrets', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function listProviders(): Promise<ProviderProfile[]> {
  const payload = await request<{ providers: ProviderProfile[] }>('/api/providers')
  return payload.providers
}

export async function createProvider(input: ProviderProfileInput): Promise<ProviderProfile> {
  const payload = await request<ProviderMutationResponse>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return payload.provider
}

export async function updateProvider(id: string, input: Partial<ProviderProfileInput>): Promise<ProviderProfile> {
  const payload = await request<ProviderMutationResponse>(`/api/providers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return payload.provider
}

export function deleteProvider(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/providers/${id}`, {
    method: 'DELETE',
  })
}

export async function discoverProviderModels(providerId: string): Promise<DiscoveredModel[]> {
  const payload = await request<ModelDiscoveryResponse>(`/api/providers/${providerId}/models/discover`, {
    method: 'POST',
  })
  return payload.models.map(capabilityToDiscoveredModel)
}

export async function testProvider(providerId: string, input: ProviderTestInput): Promise<ProviderTestResponse> {
  const enabledTests = Object.entries(input.tests)
    .filter(([, enabled]) => enabled)
    .map(([kind]) => kind) as Array<ProviderTestResult['kind']>

  if (!enabledTests.length) {
    throw new Error('Select at least one provider test.')
  }

  const payload = await request<BackendProviderTestResponse>(`/api/providers/${providerId}/test`, {
    method: 'POST',
    body: JSON.stringify({ ...input, tests: enabledTests }),
  })
  return normalizeProviderTestResponse(payload)
}

export async function listModelCapabilities(): Promise<ModelCapability[]> {
  const payload = await request<{ capabilities: ModelCapability[] }>('/api/model-capabilities')
  return payload.capabilities
}

export async function updateModelCapability(id: string, input: ModelCapabilityFlags): Promise<ModelCapability> {
  const payload = await request<ModelCapabilityResponse>(`/api/model-capabilities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return payload.capability
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(path, {
    ...init,
    headers,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) {
        message = payload.error
      }
    } catch {
      // Keep the HTTP status message when the server returns a non-JSON error.
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

function capabilityToDiscoveredModel(capability: ModelCapability): DiscoveredModel {
  return {
    id: capability.modelId,
    name: capability.modelId,
    capabilityStatus: capability.source === 'user' ? 'user-confirmed' : capability.source ? 'detected' : 'unknown',
    capabilities: pickCapabilityFlags(capability),
  }
}

function normalizeProviderTestResponse(payload: BackendProviderTestResponse): ProviderTestResponse {
  const results = payload.results.map((item) => ({
    kind: item.kind,
    passed: item.ok,
    message: item.error || `HTTP ${item.status ?? 0} / ${item.latencyMs} ms`,
  }))

  return {
    providerId: payload.providerId,
    modelId: payload.modelId,
    latencyMs: payload.results.reduce((total, item) => total + item.latencyMs, 0),
    passed: payload.ok,
    results,
    redactedTrace: (payload.trace || []).map((item) => (typeof item === 'string' ? item : JSON.stringify(item, null, 2))),
    inferredCapabilities: payload.inferredCapabilities,
  }
}

function pickCapabilityFlags(capability: ModelCapability): ModelCapabilityFlags {
  return {
    supportsVision: capability.supportsVision,
    supportsStreaming: capability.supportsStreaming,
    supportsJsonSchema: capability.supportsJsonSchema,
    allowsAdultInput: capability.allowsAdultInput,
    allowsAdultGeneration: capability.allowsAdultGeneration,
  }
}
