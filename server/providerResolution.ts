import type { ModelCapability, ProviderProfile } from '../src/shared/types'
import type { StudioDatabase } from './database'

export function findMatchingProvider(
  providers: ProviderProfile[],
  apiBaseUrl: string,
  modelName: string,
): ProviderProfile | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(apiBaseUrl)
  const normalizedModel = normalizeModelId(modelName)
  return providers.find(
    (provider) =>
      normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl && normalizeModelId(provider.defaultModel) === normalizedModel,
  )
}

export function findMatchingCapability(db: StudioDatabase, providerId: string, modelName: string): ModelCapability | undefined {
  const normalizedModel = normalizeModelId(modelName)
  return db
    .listModelCapabilities(providerId)
    .find((capability) => normalizeModelId(capability.modelId) === normalizedModel)
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `https://${trimmed}`
}

export function normalizeModelId(modelName: string): string {
  return modelName.trim().toLowerCase()
}
