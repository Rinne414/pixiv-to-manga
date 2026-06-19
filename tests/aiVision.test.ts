import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateDialoguesWithAi } from '../server/ai'
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

function createDb(): { db: StudioDatabase; dataDir: string } {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-ai-vision-test-'))
  process.env.PTM_DATA_DIR = dataDir
  return { db: new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false), dataDir }
}

describe('AI vision generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PTM_DATA_DIR
  })

  it('sends local page images to OpenAI-compatible vision requests', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    await secrets.save({
      apiBaseUrl: 'https://api.example.test/v1',
      modelName: 'gpt-4o',
      apiKey: 'test-api-key',
    })
    const provider = db.createProvider({
      name: 'Vision Provider',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'gpt-4o',
      isLocal: false,
    })
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: 'gpt-4o',
      supportsVision: true,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    })

    const project = db.createProject({ title: 'Vision Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

    let requestBody: { messages?: Array<{ content?: unknown[] }> } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    dialogues: [
                      {
                        text: '我看见这页画面了。',
                        characterName: '夏海',
                        x: 0.5,
                        y: 0.25,
                        scale: 1,
                        rotation: 0,
                        bubbleStyle: 'speech',
                        color: '#141414',
                        locked: false,
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(result.usedMock).toBe(false)
    expect(result.dialogues[0].text).toBe('我看见这页画面了。')
    const content = requestBody?.messages?.[0]?.content || []
    expect(content.some((part) => JSON.stringify(part).includes('data:image/png;base64,'))).toBe(true)
  })

  it('uses a saved Provider Lab key when global generation settings are empty', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const provider = db.createProvider({
      name: 'Provider Lab Target',
      baseUrl: 'https://provider.example.test/v1',
      defaultModel: 'gpt-4o-provider',
      isLocal: false,
    })
    await secrets.setProviderApiKey(provider.id, 'provider-only-key')
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: 'gpt-4o-provider',
      supportsVision: true,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    })

    const project = db.createProject({ title: 'Provider Target Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

    let authorization = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        authorization = String((init?.headers as Record<string, string>).Authorization)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    dialogues: [
                      {
                        text: 'Provider Lab key is active.',
                        characterName: '夏海',
                        x: 0.5,
                        y: 0.25,
                        scale: 1,
                        rotation: 0,
                        bubbleStyle: 'speech',
                        color: '#141414',
                        locked: false,
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(result.usedMock).toBe(false)
    expect(result.dialogues[0].text).toBe('Provider Lab key is active.')
    expect(authorization).toBe('Bearer provider-only-key')
  })

  it('blocks external image generation until the model is confirmed vision-capable', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    await secrets.save({
      apiBaseUrl: 'https://api.example.test/v1',
      modelName: 'text-only',
      apiKey: 'test-api-key',
    })

    const project = db.createProject({ title: 'Blocked Vision Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
        mode: 'story',
        textDensity: 0.65,
      }),
    ).rejects.toThrow(/vision_required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
