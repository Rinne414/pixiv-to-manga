import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeAiTarget } from '../server/ai'
import { StudioDatabase } from '../server/database'
import { SecretStore, type KeytarModule } from '../server/secrets'

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

class TestSecretStore extends SecretStore {
  private readonly testKeytar: KeytarModule

  constructor(db: StudioDatabase, keytar: KeytarModule) {
    super(db)
    this.testKeytar = keytar
  }

  override async getKeytar(): Promise<KeytarModule | null> {
    return this.testKeytar
  }
}

function createContext() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-active-target-test-'))
  process.env.PTM_DATA_DIR = dataDir
  const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
  const secrets = new TestSecretStore(db, new MemoryKeytar())
  return { db, secrets }
}

describe('describeAiTarget', () => {
  afterEach(() => {
    delete process.env.PTM_DATA_DIR
  })

  it('reports the global route when a global API key exists, without key material', async () => {
    const { db, secrets } = createContext()
    await secrets.save({ apiBaseUrl: 'https://api.example.test/v1', modelName: 'gpt-x', apiKey: 'secret-key' })

    const target = await describeAiTarget({ secrets, db })
    expect(target).toMatchObject({
      apiBaseUrl: 'https://api.example.test/v1',
      modelName: 'gpt-x',
      isLocal: false,
      hasApiKey: true,
      source: 'global',
    })
    expect(JSON.stringify(target)).not.toContain('secret-key')
  })

  it('uses a matching keyless local provider instead of the legacy global route', async () => {
    const { db, secrets } = createContext()
    const provider = db.createProvider({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3', isLocal: true })
    await secrets.save({ apiBaseUrl: 'http://localhost:11434/v1', modelName: 'llama3' })

    const target = await describeAiTarget({ secrets, db })
    expect(target).toMatchObject({ isLocal: true, source: 'provider', providerId: provider.id, providerName: 'Ollama' })
  })

  it('uses the matching provider profile and its own key before the legacy global route', async () => {
    const { db, secrets } = createContext()
    const provider = db.createProvider({ name: 'Keyed Match', baseUrl: 'https://api.example.test/v1', defaultModel: 'gpt-x', isLocal: false })
    await secrets.setProviderApiKey(provider.id, 'provider-key')
    await secrets.save({ apiBaseUrl: 'https://api.example.test/v1', modelName: 'gpt-x' })

    const target = await describeAiTarget({ secrets, db })
    expect(target).toMatchObject({ source: 'provider', hasApiKey: true, providerId: provider.id })
    expect(JSON.stringify(target)).not.toContain('provider-key')
  })

  it('prioritizes a usable provider profile over a different usable legacy global route', async () => {
    const { db, secrets } = createContext()
    const provider = db.createProvider({
      name: 'Primary Provider',
      baseUrl: 'https://provider.example.test/v1',
      defaultModel: 'provider-model',
      isLocal: false,
    })
    await secrets.setProviderApiKey(provider.id, 'provider-key')
    await secrets.save({
      apiBaseUrl: 'https://legacy.example.test/v1',
      modelName: 'legacy-model',
      apiKey: 'legacy-key',
    })

    expect(await describeAiTarget({ secrets, db })).toMatchObject({
      apiBaseUrl: 'https://provider.example.test/v1',
      modelName: 'provider-model',
      source: 'provider',
      providerId: provider.id,
    })
  })

  it('escapes a configured-but-unusable global route through a usable provider profile', async () => {
    const { db, secrets } = createContext()
    db.createProvider({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3', isLocal: true })
    await secrets.save({ apiBaseUrl: 'https://unmatched.example.test/v1', modelName: 'ghost' })

    expect(await describeAiTarget({ secrets, db })).toMatchObject({
      apiBaseUrl: 'http://localhost:11434/v1',
      modelName: 'llama3',
      isLocal: true,
      source: 'provider',
    })
  })

  it('falls back to the first usable provider profile when no complete global route is set', async () => {
    const { db, secrets } = createContext()
    db.createProvider({ name: 'Keyless', baseUrl: 'https://keyless.example.test/v1', defaultModel: 'nope', isLocal: false })
    const keyed = db.createProvider({ name: 'Keyed', baseUrl: 'https://keyed.example.test/v1', defaultModel: 'good', isLocal: false })
    await secrets.setProviderApiKey(keyed.id, 'k')
    // Base URL without a model is not a complete global route.
    await secrets.save({ apiBaseUrl: 'https://half.example.test/v1', modelName: '' })

    const target = await describeAiTarget({ secrets, db })
    expect(target).toMatchObject({
      apiBaseUrl: 'https://keyed.example.test/v1',
      modelName: 'good',
      hasApiKey: true,
      source: 'provider',
      providerId: keyed.id,
    })
  })

  it('returns null when nothing is usable', async () => {
    const { db, secrets } = createContext()
    db.createProvider({ name: 'Keyless', baseUrl: 'https://keyless.example.test/v1', defaultModel: 'nope', isLocal: false })

    expect(await describeAiTarget({ secrets, db })).toBeNull()
  })

  it('does not trust a legacy public provider record merely because isLocal is true', async () => {
    const { db, secrets } = createContext()
    db.createProvider({
      name: 'Unsafe legacy local flag',
      baseUrl: 'https://public.example.test/v1',
      defaultModel: 'gpt-x',
      isLocal: true,
    })

    expect(await describeAiTarget({ secrets, db })).toBeNull()
  })
})
