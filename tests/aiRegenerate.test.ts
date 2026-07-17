import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { regenerateDialogueTextWithAi } from '../server/ai'
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

function createFixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-regenerate-test-'))
  process.env.PTM_DATA_DIR = dataDir
  const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
  const secrets = new TestSecretStore(db, new MemoryKeytar())

  const project = db.createProject({ title: 'Rewrite Project', mode: 'story', source: 'local' })
  const relativePath = path.join('projects', project.id, 'originals', 'page-001.png')
  const absolutePath = path.join(dataDir, relativePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, Buffer.from('png-bytes'))
  const asset = db.createAsset({ projectId: project.id, kind: 'original', relativePath, mimeType: 'image/png' })
  const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
  db.replaceDialogues(page.id, [
    {
      id: 'line-1',
      pageId: page.id,
      characterName: '夏海',
      text: '原来的第一句。',
      x: 0.3,
      y: 0.3,
      scale: 1,
      rotation: 0,
      bubbleStyle: 'speech',
      color: '#141414',
      locked: false,
    },
    {
      id: 'line-2',
      pageId: page.id,
      characterName: '悠真',
      text: '要被重写的第二句。',
      x: 0.7,
      y: 0.6,
      scale: 1,
      rotation: 0,
      bubbleStyle: 'speech',
      color: '#141414',
      locked: false,
    },
  ])
  return { db, secrets, project, page }
}

describe('regenerateDialogueTextWithAi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PTM_DATA_DIR
  })

  it('returns a deterministic mock rewrite when no engine is configured', async () => {
    const { db, secrets, project } = createFixture()
    const dialogue = db.getProjectDetail(project.id).dialogues.find((item) => item.id === 'line-2')!

    const result = await regenerateDialogueTextWithAi({ secrets, db }, db.getProjectDetail(project.id), dialogue, {
      instruction: '',
      mode: 'story',
      textDensity: 0.65,
    })
    expect(result.usedMock).toBe(true)
    expect(result.text).toContain('要被重写的第二句。')

    const instructed = await regenerateDialogueTextWithAi({ secrets, db }, db.getProjectDetail(project.id), dialogue, {
      instruction: '更搞笑',
      mode: 'story',
      textDensity: 0.65,
    })
    expect(instructed.text).toContain('更搞笑')
  })

  it('marks the target line, forwards the instruction, and attaches the page image', async () => {
    const { db, secrets, project } = createFixture()
    await secrets.save({ apiBaseUrl: 'https://api.example.test/v1', modelName: 'gpt-4o', apiKey: 'k' })
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

    const prompts: string[] = []
    let sawImagePart = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: Array<{ type: string; text?: string }> }>
        }
        for (const part of body.messages[0].content) {
          if (part.type === 'text' && part.text) prompts.push(part.text)
          if (part.type === 'image_url') sawImagePart = true
        }
        const content = JSON.stringify({ text: '重写完成的第二句！' })
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
      }),
    )

    const detail = db.getProjectDetail(project.id)
    const dialogue = detail.dialogues.find((item) => item.id === 'line-2')!
    const result = await regenerateDialogueTextWithAi({ secrets, db }, detail, dialogue, {
      instruction: '语气更强硬',
      mode: 'story',
      textDensity: 0.5,
    })

    expect(result.usedMock).toBe(false)
    expect(result.text).toBe('重写完成的第二句！')
    const prompt = prompts.join('\n')
    expect(prompt).toContain('【要重写的这句】悠真：要被重写的第二句。')
    expect(prompt).toContain('夏海：原来的第一句。')
    expect(prompt).toContain('语气更强硬')
    expect(sawImagePart).toBe(true)
  })
})
