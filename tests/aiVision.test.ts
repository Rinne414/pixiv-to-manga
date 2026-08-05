import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiJsonOutputError,
  AiProviderHttpError,
  AiProviderRefusalError,
  analyzeStoryWithAi,
  generateDialoguesWithAi,
} from '../server/ai'
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
      supportsJsonSchema: true,
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

    let requestBody: {
      messages?: Array<{ content?: unknown[] }>
      stream?: boolean
      response_format?: { type?: string; json_schema?: { name?: string; schema?: Record<string, unknown> } }
    } | undefined
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
    expect(requestBody?.response_format?.type).toBe('json_schema')
    expect(requestBody?.response_format?.json_schema?.name).toBe('page_dialogues')
    expect(requestBody?.response_format?.json_schema?.schema).toMatchObject({ type: 'object' })
  })

  it('converts SVG pages to PNG before sending them to vision providers', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const provider = db.createProvider({
      name: 'Vision Provider',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'vision-model',
      isLocal: false,
    })
    await secrets.setProviderApiKey(provider.id, 'test-api-key')
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: provider.defaultModel,
      supportsVision: true,
      source: 'tested',
    })
    const project = db.createProject({ title: 'SVG Vision Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.svg')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(
      absolutePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ffffff"/></svg>',
      'utf8',
    )
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/svg+xml' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    let imageUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: Array<{ type: string; image_url?: { url?: string } }> }>
        }
        imageUrl = body.messages[0].content.find((part) => part.type === 'image_url')?.image_url?.url || ''
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ dialogues: [{ text: '安全图像。' }] }) } }],
          }),
          { status: 200 },
        )
      }),
    )

    await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(imageUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('skips an incompatible provider and uses the next vision-capable provider', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const compatible = db.createProvider({
      name: 'Compatible Vision',
      baseUrl: 'https://compatible.example.test/v1',
      defaultModel: 'vision-model',
      isLocal: false,
    })
    await secrets.setProviderApiKey(compatible.id, 'compatible-key')
    db.upsertModelCapability({
      providerId: compatible.id,
      modelId: compatible.defaultModel,
      supportsVision: true,
      source: 'tested',
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
    const incompatible = db.createProvider({
      name: 'Newer Text Only',
      baseUrl: 'https://incompatible.example.test/v1',
      defaultModel: 'text-model',
      isLocal: false,
    })
    await secrets.setProviderApiKey(incompatible.id, 'incompatible-key')
    db.upsertModelCapability({
      providerId: incompatible.id,
      modelId: incompatible.defaultModel,
      supportsVision: false,
      source: 'tested',
    })
    expect(db.listProviders()[0].id).toBe(incompatible.id)

    const project = db.createProject({ title: 'Provider Escape Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    let requestUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        requestUrl = String(url)
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ dialogues: [{ text: 'OK', x: 0.5, y: 0.5 }] }) } }],
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
    expect(requestUrl).toBe('https://compatible.example.test/v1/chat/completions')
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

  it('uses a keyless local provider (Ollama-style) without an Authorization header', async () => {
    const { db, dataDir } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const provider = db.createProvider({
      name: 'Local Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      defaultModel: 'qwen3-vl:8b',
      isLocal: true,
    })
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: 'qwen3-vl:8b',
      supportsVision: true,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    })

    const project = db.createProject({ title: 'Ollama Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

    let requestUrl = ''
    let headers: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        requestUrl = String(url)
        headers = { ...(init?.headers as Record<string, string>) }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    dialogues: [
                      {
                        text: '本地模型对白。',
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
    expect(result.dialogues[0].text).toBe('本地模型对白。')
    expect(requestUrl).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(headers.Authorization).toBeUndefined()
  })

  it('injects the reusable story bible style prompt into dialogue generation requests', async () => {
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

    const project = db.createProject({ title: 'Style Prompt Project', mode: 'story', source: 'local' })
    const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
    const absolutePath = path.join(dataDir, relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, Buffer.from('png-bytes'))
    const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    db.saveStoryBible(project.id, {
      synopsis: '测试故事。',
      tone: '轻松',
      characters: [
        {
          id: 'char-1',
          projectId: project.id,
          name: '夏海',
          description: '主角',
          voice: '直率',
          color: '#c9282d',
          bubbleStyle: 'speech',
        },
      ],
      pageBeats: [{ pageIndex: 0, summary: '开场', intent: 'setup' }],
      stylePrompt: '  全部对白使用文言文，句尾加“也”。  ',
      r18Enabled: false,
    })

    let promptText = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages?: Array<{ content?: Array<{ type?: string; text?: string }> }>
        }
        promptText = body.messages?.[0]?.content?.find((part) => part.type === 'text')?.text || ''
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    dialogues: [
                      {
                        text: '风格化对白也。',
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
    // Trimmed style prompt must be injected verbatim as a mandatory style rule.
    expect(promptText).toContain('风格要求（必须遵守）：全部对白使用文言文，句尾加“也”。')
    // Models only return characterName; the server must resolve the ID so fonts/colors apply.
    expect(result.dialogues[0].characterId).toBe('char-1')
  })

  it('preserves the saved style prompt when the story is re-analyzed', async () => {
    const { db } = createDb()
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

    const project = db.createProject({ title: 'Re-analysis Project', mode: 'story', source: 'local' })
    db.saveStoryBible(project.id, {
      synopsis: '初版故事。',
      tone: '轻松',
      characters: [
        {
          id: 'char-1',
          projectId: project.id,
          name: '夏海',
          description: '主角',
          voice: '直率',
          color: '#c9282d',
          bubbleStyle: 'speech',
        },
      ],
      pageBeats: [{ pageIndex: 0, summary: '开场', intent: 'setup' }],
      stylePrompt: '全部对白使用文言文。',
      r18Enabled: false,
    })

    // The model's re-analysis response omits stylePrompt (it is user config, not model output).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    synopsis: '重新分析后的故事。',
                    tone: '热血',
                    characters: [
                      { name: '夏海', description: '主角', voice: '直率', color: '#c9282d', bubbleStyle: 'speech' },
                    ],
                    pageBeats: [{ pageIndex: 0, summary: '新开场', intent: 'setup' }],
                    userBrief: '',
                    r18Enabled: false,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await analyzeStoryWithAi({ secrets, db }, db.getProjectDetail(project.id), {
      userBrief: '',
      r18Enabled: false,
    })

    expect(result.usedMock).toBe(false)
    expect(result.storyBible.synopsis).toBe('重新分析后的故事。')
    expect(result.storyBible.stylePrompt).toBe('全部对白使用文言文。')
  })

  it('preserves the saved style prompt when the mock analysis engine runs', async () => {
    const { db } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const project = db.createProject({ title: 'Mock Re-analysis Project', mode: 'story', source: 'local' })
    db.saveStoryBible(project.id, {
      synopsis: '初版故事。',
      tone: '轻松',
      characters: [
        {
          id: 'char-1',
          projectId: project.id,
          name: '夏海',
          description: '主角',
          voice: '直率',
          color: '#c9282d',
          bubbleStyle: 'speech',
        },
      ],
      pageBeats: [{ pageIndex: 0, summary: '开场', intent: 'setup' }],
      stylePrompt: '全部对白使用文言文。',
      r18Enabled: false,
    })

    const result = await analyzeStoryWithAi({ secrets, db }, db.getProjectDetail(project.id), {
      userBrief: '',
      r18Enabled: false,
    })

    expect(result.usedMock).toBe(true)
    expect(result.storyBible.stylePrompt).toBe('全部对白使用文言文。')
  })

  it('ignores keyless external providers and falls back to the local mock engine', async () => {
    const { db } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const provider = db.createProvider({
      name: 'External provider without key',
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

    const project = db.createProject({ title: 'Keyless External Project', mode: 'story', source: 'local' })
    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath: path.join('projects', project.id, 'originals', 'page-001.svg'),
      mimeType: 'image/svg+xml',
    })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(result.usedMock).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tries a safe image request when an external route has no capability record', async () => {
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
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  dialogues: [
                    {
                      text: 'Safe image accepted.',
                      x: 0.5,
                      y: 0.5,
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
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), page, {
      mode: 'story',
      textDensity: 0.65,
    })

    expect(result.usedMock).toBe(false)
    expect(result.dialogues[0].text).toBe('Safe image accepted.')
    expect(fetchMock).toHaveBeenCalledOnce()
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
    // Both requests carry a composite signal (job signal + timeout); aborting the
    // job controller must propagate through to what fetch received.
    expect(requestSignals).toHaveLength(2)
    for (const signal of requestSignals) {
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)
    }
    controller.abort()
    for (const signal of requestSignals) {
      expect(signal?.aborted).toBe(true)
    }
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

  it('reports a provider content-policy refusal without making a repair request', async () => {
    const { db } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const provider = db.createProvider({
      name: 'Policy Provider',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'policy-model',
      isLocal: false,
    })
    await secrets.setProviderApiKey(provider.id, 'test-api-key')
    const project = db.createProject({ title: 'Policy Project', mode: 'story', source: 'local' })
    const refusal = 'I cannot assist with this request because the content violates the provider policy.'
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: refusal } }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      await analyzeStoryWithAi({ secrets, db }, db.getProjectDetail(project.id), {
        userBrief: '',
        r18Enabled: false,
      })
      throw new Error('Expected provider refusal to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderRefusalError)
      expect(error).toMatchObject({
        message: 'AI provider refused the request: content_policy',
        raw: refusal,
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps actionable Provider HTTP details while redacting echoed secrets and images', async () => {
    const { db } = createDb()
    const secrets = new TestSecretStore(db, new MemoryKeytar())
    const provider = db.createProvider({
      name: 'Error Provider',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'error-model',
      isLocal: false,
    })
    await secrets.setProviderApiKey(provider.id, 'test-api-key')
    const project = db.createProject({ title: 'Error Project', mode: 'story', source: 'local' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          '{"error":"invalid image data:image/png;base64,c2VjcmV0 and key sk-secret-value"}',
          { status: 400 },
        ),
      ),
    )

    try {
      await analyzeStoryWithAi({ secrets, db }, db.getProjectDetail(project.id), {
        userBrief: '',
        r18Enabled: false,
      })
      throw new Error('Expected Provider HTTP failure to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderHttpError)
      expect(error).toMatchObject({
        status: 400,
        endpoint: 'https://api.example.test/v1/chat/completions',
        model: 'error-model',
      })
      const responseBody = (error as AiProviderHttpError).responseBody
      expect(responseBody).toContain('invalid image')
      expect(responseBody).toContain('[redacted image payload]')
      expect(responseBody).toContain('[redacted secret]')
      expect(responseBody).not.toContain('c2VjcmV0')
      expect(responseBody).not.toContain('sk-secret-value')
    }
  })

  it('sends next-page vision context and previous-page dialogue lines for continuity', async () => {
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

    const project = db.createProject({ title: 'Continuity Project', mode: 'story', source: 'local' })
    const pages = [0, 1, 2].map((index) => {
      const relativePath = path.join('projects', project.id, 'originals', `page-00${index + 1}.png`)
      const absolutePath = path.join(dataDir, relativePath)
      mkdirSync(path.dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, Buffer.from(`png-bytes-${index}`))
      const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
      return db.createPage({ projectId: project.id, index, originalAssetId: asset.id })
    })
    db.saveStoryBible(project.id, {
      synopsis: '测试故事。',
      tone: '轻松',
      characters: [
        {
          id: 'char-1',
          projectId: project.id,
          name: '夏海',
          description: '主角',
          voice: '直率',
          color: '#c9282d',
          bubbleStyle: 'speech',
        },
      ],
      pageBeats: [
        { pageIndex: 0, summary: '开场', intent: 'setup' },
        { pageIndex: 1, summary: '相遇', intent: 'build' },
        { pageIndex: 2, summary: '出发去海边', intent: 'payoff' },
      ],
      r18Enabled: false,
    })
    db.replaceDialogues(pages[0].id, [
      {
        id: 'prev-1',
        pageId: pages[0].id,
        characterId: 'char-1',
        characterName: '夏海',
        text: '那一天的车站好安静。',
        x: 0.2,
        y: 0.2,
        scale: 1,
        rotation: 0,
        bubbleStyle: 'speech',
        color: '#141414',
        locked: false,
      },
    ])

    let promptText = ''
    let imagePartCount = 0
    let contentParts: Array<{ type?: string; text?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages?: Array<{ content?: Array<{ type?: string; text?: string }> }>
        }
        contentParts = body.messages?.[0]?.content || []
        promptText = contentParts.find((part) => part.type === 'text')?.text || ''
        imagePartCount = contentParts.filter((part) => part.type === 'image_url').length
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    dialogues: [
                      {
                        text: '衔接对白。',
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

    // Middle page: current + next page image, next beat, previous page dialogue lines.
    await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), pages[1], {
      mode: 'story',
      textDensity: 0.65,
    })
    expect(imagePartCount).toBe(2)
    expect(promptText).toContain('下一页剧情：出发去海边')
    expect(promptText).toContain('夏海：那一天的车站好安静。')
    expect(contentParts.some((part) => part.type === 'text' && part.text?.includes('下一页画面'))).toBe(true)

    // Last page: single image and closure guidance instead of next-page context.
    await generateDialoguesWithAi({ secrets, db }, db.getProjectDetail(project.id), pages[2], {
      mode: 'story',
      textDensity: 0.65,
    })
    expect(imagePartCount).toBe(1)
    expect(promptText).toContain('本页是最后一页')
    expect(promptText).not.toContain('下一页剧情')
  })
})
