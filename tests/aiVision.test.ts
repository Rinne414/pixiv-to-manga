import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiJsonOutputError, generateDialoguesWithAi } from '../server/ai'
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

    let requestBody: { messages?: Array<{ content?: unknown[] }>; stream?: boolean } | undefined
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
    expect(requestBody?.stream).toBe(false)
  })

  it('streams and aggregates OpenAI-compatible chat completion chunks when the model supports streaming', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    await secrets.save({
      apiBaseUrl: 'https://api.example.test/v1',
      modelName: 'gpt-4o-stream',
      apiKey: 'test-api-key',
    })
    const provider = db.createProvider({
      name: 'Streaming Vision Provider',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'gpt-4o-stream',
      isLocal: false,
    })
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: 'gpt-4o-stream',
      supportsVision: true,
      supportsStreaming: true,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    })

    const project = db.createProject({ title: 'Streaming Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

    let requestBody: { stream?: boolean } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        requestBody = JSON.parse(String(init?.body))
        const chunks = [
          '{"dialogues":[',
          '{"text":"流式对白","characterName":"夏海","x":0.5,"y":0.25,"scale":1,"rotation":0,"bubbleStyle":"speech","color":"#141414","locked":false}',
          ']}',
        ]
        const body = `${chunks
          .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
          .join('')}data: [DONE]\n\n`
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }),
    )

    const result = await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(requestBody?.stream).toBe(true)
    expect(result.usedMock).toBe(false)
    expect(result.dialogues[0].text).toBe('流式对白')
  })

  it('supports visual translation mode through editable dialogue data without OCR cleanup', async () => {
    const { db } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const project = db.createProject({ title: 'Translation Project', mode: 'translation', source: 'local' })
    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath: path.join('projects', project.id, 'originals', 'page-001.svg'),
      mimeType: 'image/svg+xml',
    })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

    const result = await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'translation',
      textDensity: 0.65,
    })

    expect(result.usedMock).toBe(true)
    expect(result.dialogues[0]).toMatchObject({
      pageId: page.id,
      text: expect.stringContaining('这句原文的意思是'),
    })
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

  it('passes abort signals to initial and repair AI requests', async () => {
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

    const project = db.createProject({ title: 'Abort Signal Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    const controller = new AbortController()
    const requestSignals: Array<AbortSignal | null> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        requestSignals.push(init?.signal || null)
        const content =
          requestSignals.length === 1
            ? 'not json'
            : JSON.stringify({
                dialogues: [
                  {
                    text: '修复后的对白。',
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
              })
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
      }),
    )

    const result = await generateDialoguesWithAi({ secrets, db, signal: controller.signal }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(result.dialogues[0].text).toBe('修复后的对白。')
    expect(requestSignals).toEqual([controller.signal, controller.signal])
  })

  it('keeps raw model output when JSON repair still fails', async () => {
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

    const project = db.createProject({ title: 'Raw Output Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    const outputs = ['first invalid output', 'second invalid output']
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const content = outputs.shift() || 'extra invalid output'
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
      }),
    )

    try {
      await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
        mode: 'story',
        textDensity: 0.65,
      })
      throw new Error('Expected invalid AI output to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AiJsonOutputError)
      expect(error).toMatchObject({
        raw: 'first invalid output',
        repairedRaw: 'second invalid output',
      })
    }
  })
})
