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
  const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withScheme)
    if (parsed.hostname.toLowerCase() === 'aihubmix.com' && parsed.pathname === '/') {
      parsed.pathname = '/v1'
    }
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return withScheme
  }
}

export function normalizeModelId(modelName: string): string {
  return modelName.trim().toLowerCase()
}

export function isTrustedLocalProvider(provider: ProviderProfile): boolean {
  return provider.isLocal && isPrivateProviderUrl(provider.baseUrl)
}

export function isPrivateProviderUrl(value: string): boolean {
  try {
    const parsed = new URL(normalizeBaseUrl(value))
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return isPrivateHostname(hostname)
  } catch {
    return false
  }
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'host.docker.internal'
  ) {
    return true
  }
  if (hostname === '::1' || /^[f][cd][0-9a-f:]*$/i.test(hostname) || /^fe[89ab][0-9a-f:]*$/i.test(hostname)) {
    return true
  }
  if (hostname.startsWith('::ffff:')) {
    return isPrivateIpv4(hostname.slice('::ffff:'.length))
  }
  return isPrivateIpv4(hostname)
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [first, second] = parts
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}
