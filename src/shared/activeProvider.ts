/**
 * Minimal structural view of a provider profile. Kept loose (createdAt/updatedAt
 * optional) so this helper accepts both the api.ts and shared/types shapes without
 * forcing callers through a conversion.
 */
export interface ActiveProviderLike {
  id: string
  name: string
  baseUrl: string
  defaultModel: string
  isLocal: boolean
  hasApiKey: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Normalization mirrors server/providerResolution.ts so the frontend's notion of
 * "which provider matches the global Base URL + model" agrees with the backend.
 * Duplicated as pure string helpers here to avoid importing server code into the client.
 */
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

export type ActiveEngineSource = 'global' | 'provider'

export interface ActiveEngine {
  /** The provider profile that backs the active route, if one could be matched. */
  provider?: ActiveProviderLike
  /** Display-ready Base URL / model actually in effect. */
  apiBaseUrl: string
  modelName: string
  /** Whether the resolved route is keyless-local (Ollama / LM Studio) or cloud/API. */
  isLocal: boolean
  /** Whether a usable API key is known to exist for the resolved route. */
  hasApiKey: boolean
  source: ActiveEngineSource
}

/**
 * Frontend mirror of the backend resolveAiTarget() selection (server/ai.ts):
 *   1. Global Base URL + model wins when set; it must match a local provider or
 *      carry a key (global key OR the matched provider's own key).
 *   2. Otherwise the first provider profile with a key (or a local provider) is active.
 *   3. Nothing usable → null.
 *
 * Used only for display ("which AI am I really using?"); the backend remains the
 * authority for actual generation routing and safety checks.
 */
export function resolveActiveEngine(
  status: { apiBaseUrl: string; modelName: string; hasApiKey: boolean } | null,
  providers: ActiveProviderLike[],
): ActiveEngine | null {
  if (status?.apiBaseUrl && status.modelName) {
    const provider = providers.find(
      (item) =>
        normalizeBaseUrl(item.baseUrl) === normalizeBaseUrl(status.apiBaseUrl) &&
        normalizeModelId(item.defaultModel) === normalizeModelId(status.modelName),
    )
    // Local providers (Ollama, LM Studio, ...) may run without an API key; the
    // backend also accepts the matched provider's stored key when no global key exists.
    const hasUsableKey = status.hasApiKey || Boolean(provider?.hasApiKey)
    if (hasUsableKey || provider?.isLocal) {
      return {
        provider,
        apiBaseUrl: status.apiBaseUrl,
        modelName: status.modelName,
        isLocal: Boolean(provider?.isLocal),
        hasApiKey: hasUsableKey,
        source: 'global',
      }
    }
  }

  for (const provider of providers) {
    if (!provider.baseUrl || !provider.defaultModel) continue
    if (provider.hasApiKey || provider.isLocal) {
      return {
        provider,
        apiBaseUrl: provider.baseUrl,
        modelName: provider.defaultModel,
        isLocal: provider.isLocal,
        hasApiKey: provider.hasApiKey,
        source: 'provider',
      }
    }
  }

  return null
}
