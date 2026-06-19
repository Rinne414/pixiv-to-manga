import type { SecretStatus } from '../src/shared/types'
import type { StudioDatabase } from './database'

const SERVICE = 'Pixiv-to-Manga Studio'
const API_KEY_ACCOUNT = 'openai-compatible-api-key'
const PIXIV_COOKIE_ACCOUNT = 'pixiv-cookie'
const PROVIDER_API_KEY_PREFIX = 'provider-api-key:'

export interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

class MemoryKeytar implements KeytarModule {
  private values = new Map<string, string>()

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

export class SecretStore {
  private keytar: KeytarModule | null | undefined
  private db: StudioDatabase

  constructor(db: StudioDatabase) {
    this.db = db
  }

  async status(): Promise<SecretStatus> {
    const keytar = await this.getKeytar()
    return {
      keychainAvailable: Boolean(keytar),
      apiBaseUrl: this.db.getSetting('apiBaseUrl', ''),
      modelName: this.db.getSetting('modelName', ''),
      hasApiKey: Boolean(keytar && (await keytar.getPassword(SERVICE, API_KEY_ACCOUNT))),
      hasPixivCookie: Boolean(keytar && (await keytar.getPassword(SERVICE, PIXIV_COOKIE_ACCOUNT))),
    }
  }

  async save(input: {
    apiBaseUrl?: string
    modelName?: string
    apiKey?: string
    pixivCookie?: string
  }): Promise<SecretStatus> {
    const keytar = await this.requireKeytar()

    if (input.apiBaseUrl !== undefined) {
      this.db.upsertSetting('apiBaseUrl', normalizeBaseUrl(input.apiBaseUrl))
    }
    if (input.modelName !== undefined) {
      this.db.upsertSetting('modelName', input.modelName.trim())
    }
    if (input.apiKey !== undefined && input.apiKey.trim()) {
      await keytar.setPassword(SERVICE, API_KEY_ACCOUNT, input.apiKey.trim())
    }
    if (input.pixivCookie !== undefined && input.pixivCookie.trim()) {
      await keytar.setPassword(SERVICE, PIXIV_COOKIE_ACCOUNT, input.pixivCookie.trim())
    }

    return this.status()
  }

  async getApiKey(): Promise<string | null> {
    const keytar = await this.getKeytar()
    return keytar ? keytar.getPassword(SERVICE, API_KEY_ACCOUNT) : null
  }

  async getPixivCookie(): Promise<string | null> {
    const keytar = await this.getKeytar()
    return keytar ? keytar.getPassword(SERVICE, PIXIV_COOKIE_ACCOUNT) : null
  }

  async hasProviderApiKey(providerId: string): Promise<boolean> {
    const keytar = await this.getKeytar()
    return Boolean(keytar && (await keytar.getPassword(SERVICE, providerApiKeyAccount(providerId))))
  }

  async getProviderApiKey(providerId: string): Promise<string | null> {
    const keytar = await this.getKeytar()
    return keytar ? keytar.getPassword(SERVICE, providerApiKeyAccount(providerId)) : null
  }

  async setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    const keytar = await this.requireKeytar()
    await keytar.setPassword(SERVICE, providerApiKeyAccount(providerId), trimmed)
  }

  async deleteProviderApiKey(providerId: string): Promise<boolean> {
    const keytar = await this.getKeytar()
    return keytar ? keytar.deletePassword(SERVICE, providerApiKeyAccount(providerId)) : false
  }

  async getKeytar(): Promise<KeytarModule | null> {
    if (this.keytar !== undefined) {
      return this.keytar
    }

    try {
      this.keytar = process.env.PTM_TEST_MEMORY_KEYTAR === '1' ? new MemoryKeytar() : normalizeKeytarModule(await import('keytar'))
    } catch {
      this.keytar = null
    }

    return this.keytar
  }

  private async requireKeytar(): Promise<KeytarModule> {
    const keytar = await this.getKeytar()
    if (!keytar) {
      throw new Error('System credential store is unavailable. Secrets will not be saved as plain text.')
    }
    return keytar
  }
}

export function normalizeKeytarModule(value: unknown): KeytarModule | null {
  if (isKeytarModule(value)) return value
  if (value && typeof value === 'object' && 'default' in value) {
    const candidate = (value as { default?: unknown }).default
    if (isKeytarModule(candidate)) return candidate
  }
  return null
}

function isKeytarModule(value: unknown): value is KeytarModule {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof KeytarModule, unknown>>
  return (
    typeof candidate.getPassword === 'function' &&
    typeof candidate.setPassword === 'function' &&
    typeof candidate.deletePassword === 'function'
  )
}

function providerApiKeyAccount(providerId: string): string {
  return `${PROVIDER_API_KEY_PREFIX}${providerId}`
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `https://${trimmed}`
}
