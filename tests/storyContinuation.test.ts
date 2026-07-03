import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fastify from 'fastify'
import multipart from '@fastify/multipart'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { registerContinuationRoutes } from '../server/continuation'
import { SecretStore, type KeytarModule } from '../server/secrets'
import { pngWithA1111Parameters } from './helpers/imageFixtures'

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

interface TestContext {
  db: StudioDatabase
  secrets: TestSecretStore
}

function createTestContext(): TestContext {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-continuation-test-'))
  process.env.PTM_DATA_DIR = dataDir
  const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
  return { db, secrets: new TestSecretStore(db, new MemoryKeytar()) }
}

function generatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: 'Continue with the same heroine finding a hidden letter.',
    r18Enabled: false,
    outputCount: 1,
    keepCharacterConsistency: true,
    keepBackgroundConsistency: true,
    references: [],
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.PTM_DATA_DIR
})

describe('story continuation backend', () => {
  it('inspects uploaded references and returns extracted metadata without persistence secrets', async () => {
    const { db, secrets } = createTestContext()
    const server = fastify()
    await server.register(multipart, { limits: { fileSize: 1024 * 1024 } })
    registerContinuationRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/references/local',
      payload: multipartBody('files', 'ref.png', 'image/png', pngWithA1111Parameters()),
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' },
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.references[0]).toMatchObject({
      fileName: 'ref.png',
      mimeType: 'image/png',
      width: 640,
      height: 960,
    })
    expect(body.references[0].metadata.format).toBe('a1111')
    expect(body.references[0].metadata.tags).toContain('school rooftop')
  })

  it('generates a local mock continuation when no external image provider is configured', async () => {
    const { db, secrets } = createTestContext()
    const server = fastify()
    registerContinuationRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/generate',
      payload: generatePayload({
        references: [
          {
            id: 'ref-1',
            fileName: 'ref.png',
            mimeType: 'image/png',
            width: 640,
            height: 960,
            source: 'upload',
            // Older clients echoed the preview back; the schema must tolerate and strip it.
            previewDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            tags: ['same heroine', 'school rooftop'],
            metadata: {
              format: 'a1111',
              raw: {},
              tags: ['same heroine', 'school rooftop'],
              sourceFields: ['parameters'],
            },
          },
        ],
      }),
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.usedMock).toBe(true)
    expect(body.images[0].dataUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(body.expandedPrompt).toContain('same heroine')
  })

  it('falls back to the local mock when global settings have no matching provider profile', async () => {
    const { db, secrets } = createTestContext()
    await secrets.save({
      apiBaseUrl: 'https://api.example.test/v1',
      modelName: 'gpt-4o',
      apiKey: 'global-secret-value',
    })
    const server = fastify()
    registerContinuationRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/generate',
      payload: generatePayload(),
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.usedMock).toBe(true)
  })

  it('does not classify reference negative prompts as adult content', async () => {
    const { db, secrets } = createTestContext()
    const server = fastify()
    registerContinuationRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/generate',
      payload: generatePayload({
        references: [
          {
            id: 'ref-1',
            fileName: 'ref.png',
            mimeType: 'image/png',
            width: 640,
            height: 960,
            source: 'upload',
            tags: ['same heroine'],
            metadata: {
              format: 'a1111',
              raw: {},
              tags: [],
              sourceFields: ['parameters'],
              positivePrompt: 'same heroine, school rooftop',
              negativePrompt: 'nsfw, lowres, bad anatomy',
            },
          },
        ],
      }),
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.usedMock).toBe(true)
    expect(body.expandedPrompt).toContain('Avoid: nsfw')
  })

  it('blocks adult continuation prompts when R-18 is not enabled, even in local mock mode', async () => {
    const { db, secrets } = createTestContext()
    const server = fastify()
    registerContinuationRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/generate',
      payload: generatePayload({
        prompt: 'Continue as an explicit r-18 scene.',
        keepBackgroundConsistency: false,
      }),
    })

    expect(response.statusCode).not.toBe(200)
    expect(response.body).toContain('r18_disabled')
  })

  it('fails closed when an external provider lacks image generation capability', async () => {
    const { db, secrets } = createTestContext()
    const provider = db.createProvider({
      name: 'Remote image provider',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'image-model',
      isLocal: false,
    })
    db.upsertModelCapability({
      providerId: provider.id,
      modelId: 'image-model',
      supportsImageGeneration: false,
      allowsAdultGeneration: false,
      source: 'user',
    })
    await secrets.setProviderApiKey(provider.id, 'provider-secret-value')
    const server = fastify()
    registerContinuationRoutes(server, { db, secrets })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/generate',
      payload: generatePayload({ prompt: 'Continue the scene.', keepBackgroundConsistency: false }),
    })

    expect(response.statusCode).not.toBe(200)
    expect(response.body).not.toContain('provider-secret-value')
    expect(response.body).toContain('image_generation_required')
  })

  it('routes generation to an image-capable provider even when a chat-only provider sorts first', async () => {
    const { db, secrets } = createTestContext()
    const imageProvider = db.createProvider({
      name: 'Image provider',
      baseUrl: 'https://img.example.test/v1',
      defaultModel: 'flux-dev',
      isLocal: false,
    })
    db.upsertModelCapability({
      providerId: imageProvider.id,
      modelId: 'flux-dev',
      supportsImageGeneration: true,
      source: 'user',
    })
    await secrets.setProviderApiKey(imageProvider.id, 'image-provider-key')

    // Created afterwards so it sorts first in the updatedAt DESC provider listing.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const chatProvider = db.createProvider({
      name: 'Chat provider',
      baseUrl: 'https://chat.example.test/v1',
      defaultModel: 'gpt-4o',
      isLocal: false,
    })
    db.upsertModelCapability({
      providerId: chatProvider.id,
      modelId: 'gpt-4o',
      supportsImageGeneration: false,
      source: 'user',
    })
    await secrets.setProviderApiKey(chatProvider.id, 'chat-provider-key')

    const requestedUrls: string[] = []
    const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(url))
      return new Response(JSON.stringify({ data: [{ b64_json: 'aWJt' }] }), { status: 200 })
    }) as typeof fetch

    const server = fastify()
    registerContinuationRoutes(server, { db, secrets, fetchImpl })

    const response = await server.inject({
      method: 'POST',
      url: '/api/continuation/generate',
      payload: generatePayload({ prompt: 'Continue the scene.' }),
    })
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.usedMock).toBe(false)
    expect(requestedUrls[0]).toBe('https://img.example.test/v1/images/generations')
  })
})

function multipartBody(fieldName: string, filename: string, mimeType: string, buffer: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from('\r\n--test-boundary--\r\n'),
  ])
}
