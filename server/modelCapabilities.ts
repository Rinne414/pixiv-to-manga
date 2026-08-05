import { z } from 'zod'
import type {
  ModelCapability,
  ModelCapabilityEvidence,
  ModelCapabilityFlag,
  ModelCapabilitySources,
} from '../src/shared/types'

interface DeclaredCapabilities {
  supportsVision?: boolean
  supportsImageGeneration?: boolean
  supportsStreaming?: boolean
  supportsJsonSchema?: boolean
  allowsAdultInput?: boolean
  allowsAdultGeneration?: boolean
}

export interface ProviderModelCandidate {
  id: string
  ownedBy?: string
  rawType?: string
  declaredCapabilities: DeclaredCapabilities
  providerModerated?: boolean
  contextWindow?: number
}

export interface ModelCapabilitySeed extends DeclaredCapabilities {
  supportsVision: boolean
  supportsImageGeneration: boolean
  supportsStreaming: boolean
  supportsJsonSchema: boolean
  allowsAdultInput: boolean
  allowsAdultGeneration: boolean
  capabilitySources: ModelCapabilitySources
  contextWindow?: number
}

const capabilityMetadataSchema = z.object({
  supports_vision: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  vision: z.boolean().optional(),
  multimodal: z.boolean().optional(),
  supports_image_generation: z.boolean().optional(),
  supportsImageGeneration: z.boolean().optional(),
  image_generation: z.boolean().optional(),
  supports_streaming: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  streaming: z.boolean().optional(),
  supports_json_schema: z.boolean().optional(),
  supportsJsonSchema: z.boolean().optional(),
  json_schema: z.boolean().optional(),
  allows_adult_input: z.boolean().optional(),
  allowsAdultInput: z.boolean().optional(),
  adult_input: z.boolean().optional(),
  allows_adult_generation: z.boolean().optional(),
  allowsAdultGeneration: z.boolean().optional(),
  adult_generation: z.boolean().optional(),
  allows_adult_content: z.boolean().optional(),
  supports_nsfw: z.boolean().optional(),
  nsfw: z.boolean().optional(),
})

const modelMetadataSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  owned_by: z.string().optional(),
  object: z.string().optional(),
  capabilities: z.union([z.array(z.string()), capabilityMetadataSchema]).optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .optional(),
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
  supported_parameters: z.array(z.string()).optional(),
  top_provider: z
    .object({
      is_moderated: z.boolean().optional(),
    })
    .optional(),
  context_length: z.number().int().positive().optional(),
  context_window: z.number().int().positive().optional(),
  supports_vision: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supports_image_generation: z.boolean().optional(),
  supportsImageGeneration: z.boolean().optional(),
  supports_streaming: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supports_json_schema: z.boolean().optional(),
  supportsJsonSchema: z.boolean().optional(),
  allows_adult_input: z.boolean().optional(),
  allowsAdultInput: z.boolean().optional(),
  allows_adult_generation: z.boolean().optional(),
  allowsAdultGeneration: z.boolean().optional(),
  allows_adult_content: z.boolean().optional(),
  supports_nsfw: z.boolean().optional(),
  nsfw: z.boolean().optional(),
})

const capabilityFlags: ModelCapabilityFlag[] = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
]

const evidencePriority: Record<ModelCapabilityEvidence, number> = {
  unknown: 0,
  'local-policy': 2,
  provider: 3,
  tested: 4,
  user: 5,
}

export function parseProviderModels(rawText: string): ProviderModelCandidate[] {
  const payload = JSON.parse(rawText) as unknown
  const items = modelItems(payload)
  return items.flatMap((item) => {
    if (typeof item === 'string') {
      const id = item.trim()
      return id ? [{ id, declaredCapabilities: {} }] : []
    }
    const result = modelMetadataSchema.safeParse(item)
    if (!result.success) return []
    const id = result.data.id || result.data.name
    if (!id) return []
    return [
      {
        id,
        ownedBy: result.data.owned_by,
        rawType: result.data.object,
        declaredCapabilities: declaredCapabilities(result.data),
        ...(result.data.top_provider?.is_moderated !== undefined
          ? { providerModerated: result.data.top_provider.is_moderated }
          : {}),
        contextWindow: result.data.context_length || result.data.context_window,
      },
    ]
  })
}

export function deriveModelCapabilities(candidate: ProviderModelCandidate, isLocal: boolean): ModelCapabilitySeed {
  const values = Object.fromEntries(
    capabilityFlags.map((flag) => {
      const declared = candidate.declaredCapabilities[flag]
      if (declared !== undefined) return [flag, declared]
      if ((flag === 'allowsAdultInput' || flag === 'allowsAdultGeneration') && isLocal) return [flag, true]
      return [flag, false]
    }),
  ) as Record<ModelCapabilityFlag, boolean>
  const capabilitySources = Object.fromEntries(
    capabilityFlags.map((flag) => {
      if (candidate.declaredCapabilities[flag] !== undefined) return [flag, 'provider']
      if ((flag === 'allowsAdultInput' || flag === 'allowsAdultGeneration') && isLocal) return [flag, 'local-policy']
      return [flag, 'unknown']
    }),
  ) as ModelCapabilitySources
  return { ...values, capabilitySources, contextWindow: candidate.contextWindow }
}

export function capabilitySeedPatch(
  current: ModelCapability,
  seed: ModelCapabilitySeed,
): Partial<Record<ModelCapabilityFlag, boolean>> & { capabilitySources: Partial<ModelCapabilitySources>; contextWindow?: number } {
  const updates: Partial<Record<ModelCapabilityFlag, boolean>> = {}
  const sources: Partial<ModelCapabilitySources> = {}
  for (const flag of capabilityFlags) {
    const nextSource = seed.capabilitySources[flag]
    const currentSource = current.capabilitySources[flag]
    if (nextSource !== 'unknown' && evidencePriority[nextSource] > evidencePriority[currentSource]) {
      updates[flag] = seed[flag]
      sources[flag] = nextSource
    }
  }
  return {
    ...updates,
    capabilitySources: sources,
    ...(current.contextWindow === undefined && seed.contextWindow !== undefined ? { contextWindow: seed.contextWindow } : {}),
  }
}

function modelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const result = z.object({ data: z.array(z.unknown()).optional(), models: z.array(z.unknown()).optional() }).safeParse(payload)
  if (!result.success) return []
  return result.data.data || result.data.models || []
}

function declaredCapabilities(data: z.infer<typeof modelMetadataSchema>): DeclaredCapabilities {
  const nested = Array.isArray(data.capabilities) ? undefined : data.capabilities
  const capabilityNames = Array.isArray(data.capabilities)
    ? new Set(data.capabilities.map((value) => value.toLowerCase()))
    : new Set<string>()
  const inputModalities = normalizedSet(data.architecture?.input_modalities || data.input_modalities)
  const outputModalities = normalizedSet(data.architecture?.output_modalities || data.output_modalities)
  const parameters = normalizedSet(data.supported_parameters)
  const adultContent = firstBoolean([
    data.allows_adult_content,
    data.supports_nsfw,
    data.nsfw,
    nested?.allows_adult_content,
    nested?.supports_nsfw,
    nested?.nsfw,
    data.top_provider?.is_moderated === false ? true : undefined,
    hasAny(capabilityNames, ['adult', 'adult-content', 'adult_content', 'nsfw', 'uncensored', 'unmoderated']),
  ])
  return compactDeclaredCapabilities({
    supportsVision: firstBoolean([
      data.supports_vision,
      data.supportsVision,
      nested?.supports_vision,
      nested?.supportsVision,
      nested?.vision,
      nested?.multimodal,
      inputModalities ? inputModalities.has('image') : undefined,
      hasAny(capabilityNames, ['vision', 'image-input', 'image_input', 'multimodal']),
    ]),
    supportsImageGeneration: firstBoolean([
      data.supports_image_generation,
      data.supportsImageGeneration,
      nested?.supports_image_generation,
      nested?.supportsImageGeneration,
      nested?.image_generation,
      outputModalities ? outputModalities.has('image') : undefined,
      hasAny(capabilityNames, ['image-generation', 'image_generation', 'text-to-image']),
    ]),
    supportsStreaming: firstBoolean([
      data.supports_streaming,
      data.supportsStreaming,
      nested?.supports_streaming,
      nested?.supportsStreaming,
      nested?.streaming,
      parameters?.has('stream') ? true : undefined,
      hasAny(capabilityNames, ['streaming', 'stream']),
    ]),
    supportsJsonSchema: firstBoolean([
      data.supports_json_schema,
      data.supportsJsonSchema,
      nested?.supports_json_schema,
      nested?.supportsJsonSchema,
      nested?.json_schema,
      parameters && hasAny(parameters, ['json_schema', 'structured_outputs', 'response_format']) ? true : undefined,
      hasAny(capabilityNames, ['json-schema', 'json_schema', 'structured-outputs']),
    ]),
    allowsAdultInput: firstBoolean([
      data.allows_adult_input,
      data.allowsAdultInput,
      nested?.allows_adult_input,
      nested?.allowsAdultInput,
      nested?.adult_input,
      adultContent,
    ]),
    allowsAdultGeneration: firstBoolean([
      data.allows_adult_generation,
      data.allowsAdultGeneration,
      nested?.allows_adult_generation,
      nested?.allowsAdultGeneration,
      nested?.adult_generation,
      adultContent,
    ]),
  })
}

function compactDeclaredCapabilities(input: DeclaredCapabilities): DeclaredCapabilities {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as DeclaredCapabilities
}

function firstBoolean(values: Array<boolean | undefined>): boolean | undefined {
  return values.find((value) => value !== undefined)
}

function normalizedSet(values: string[] | undefined): Set<string> | undefined {
  return values ? new Set(values.map((value) => value.toLowerCase())) : undefined
}

function hasAny(values: Set<string>, candidates: string[]): boolean | undefined {
  return candidates.some((candidate) => values.has(candidate)) ? true : undefined
}
