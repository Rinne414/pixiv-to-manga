import type { FastifyInstance } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { randomUUID } from 'node:crypto'
import type {
  ContinuationGenerateResponse,
  ContinuationImage,
  ContinuationReference,
  ContinuationReferenceInput,
  ModelCapability,
  ProviderProfile,
} from '../src/shared/types'
import {
  continuationGenerateSchema,
  continuationPixivReferenceSchema,
} from '../src/shared/schemas'
import { type SafetyClass, evaluateRouteSafety } from '../src/shared/routeSafety'
import { uniqueNonEmpty } from '../src/shared/text'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  detectImageDimensions,
  downloadPixivArtworkImages,
} from './importers'
import { extractImageMetadata } from './imageMetadata'
import { findMatchingCapability, findMatchingProvider } from './providerResolution'

export interface ContinuationContext {
  db: StudioDatabase
  secrets: SecretStore
  fetchImpl?: typeof fetch
}

interface ImageGenerationTarget {
  provider: ProviderProfile
  capability?: ModelCapability
  apiKey: string
}

export function registerContinuationRoutes(server: FastifyInstance, context: ContinuationContext): void {
  const service = new StoryContinuationService(context)

  server.post('/api/continuation/references/local', async (request) => {
    return { references: await service.inspectLocalReferences(request.files()) }
  })

  server.post('/api/continuation/references/pixiv', async (request) => {
    const input = continuationPixivReferenceSchema.parse(request.body ?? {})
    return { references: await service.inspectPixivReferences(input) }
  })

  server.post('/api/continuation/generate', async (request) => {
    const input = continuationGenerateSchema.parse(request.body ?? {})
    return service.generate(input)
  })
}

export class StoryContinuationService {
  private db: StudioDatabase
  private secrets: SecretStore
  private fetchImpl: typeof fetch

  constructor(context: ContinuationContext) {
    this.db = context.db
    this.secrets = context.secrets
    this.fetchImpl = context.fetchImpl || fetch
  }

  async inspectLocalReferences(files: AsyncIterable<MultipartFile>): Promise<ContinuationReference[]> {
    const references: ContinuationReference[] = []
    for await (const file of files) {
      const mimeType = file.mimetype.split(';')[0]
      if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
        throw new Error(`Unsupported file type: ${file.mimetype}`)
      }
      const buffer = await file.toBuffer()
      references.push(referenceFromBuffer({
        buffer,
        fileName: file.filename || `reference-${references.length + 1}`,
        mimeType,
        source: 'upload',
      }))
    }
    if (!references.length) {
      throw new Error('At least one reference image is required')
    }
    return references
  }

  async inspectPixivReferences(input: { url: string; r18Enabled: boolean; maxPages: number }): Promise<ContinuationReference[]> {
    const images = await downloadPixivArtworkImages(this.secrets, input)
    return images.map((image) =>
      referenceFromBuffer({
        buffer: image.buffer,
        fileName: image.fileName,
        mimeType: image.mimeType,
        source: 'pixiv',
        sourceUrl: image.sourceUrl,
      }),
    )
  }

  async generate(input: {
    prompt: string
    r18Enabled: boolean
    outputCount: number
    keepCharacterConsistency: boolean
    keepBackgroundConsistency: boolean
    references: ContinuationReferenceInput[]
  }): Promise<ContinuationGenerateResponse> {
    const expandedPrompt = buildContinuationPrompt(input)
    const safetyClass = classifyPromptSafety(buildSafetyClassificationText(input))
    assertLocalPromptAllowed({
      r18Enabled: input.r18Enabled,
      safetyClass,
    })
    const target = await this.resolveImageGenerationTarget()

    if (!target) {
      const images = Array.from({ length: input.outputCount }, (_, index) =>
        mockContinuationImage(expandedPrompt, index, input.references),
      )
      return {
        images,
        expandedPrompt,
        usedMock: true,
        routeTrace: ['No image generation provider configured; used local mock output.'],
      }
    }

    this.assertImageGenerationAllowed(target, {
      r18Enabled: input.r18Enabled,
      safetyClass,
    })

    const images = await this.callImageGenerationProvider(target, expandedPrompt, input.outputCount)
    return {
      images,
      expandedPrompt,
      usedMock: false,
      routeTrace: [`Generated with ${target.provider.name} / ${target.provider.defaultModel}.`],
    }
  }

  private async resolveImageGenerationTarget(): Promise<ImageGenerationTarget | null> {
    const [status, globalApiKey] = await Promise.all([this.secrets.status(), this.secrets.getApiKey()])
    const providers = this.db.listProviders()

    if (status.apiBaseUrl && status.modelName) {
      const provider = findMatchingProvider(providers, status.apiBaseUrl, status.modelName)
      if (provider) {
        const capability = findMatchingCapability(this.db, provider.id, status.modelName)
        if (capability?.supportsImageGeneration) {
          const apiKey = globalApiKey || (await this.secrets.getProviderApiKey(provider.id))
          if (apiKey) {
            return { provider, capability, apiKey }
          }
        }
      }
    }

    // Global settings that don't resolve to an image-capable profile fall through here:
    // pick the first keyed provider whose default model supports image generation.
    let hasKeyedProvider = false
    for (const provider of providers) {
      if (!provider.baseUrl || !provider.defaultModel) continue
      const apiKey = await this.secrets.getProviderApiKey(provider.id)
      if (!apiKey) continue
      hasKeyedProvider = true
      const capability = findMatchingCapability(this.db, provider.id, provider.defaultModel)
      if (!capability?.supportsImageGeneration) continue
      return { provider, capability, apiKey }
    }

    // Fail closed only when real providers are configured but none may generate images;
    // with no usable provider at all, callers fall back to the local mock engine.
    if (hasKeyedProvider) {
      throw new Error('AI route blocked by provider safety policy: image_generation_required')
    }
    return null
  }

  private assertImageGenerationAllowed(
    target: ImageGenerationTarget,
    input: { r18Enabled: boolean; safetyClass: SafetyClass },
  ): void {
    if (!target.capability?.supportsImageGeneration) {
      throw new Error('AI route blocked by provider safety policy: image_generation_required')
    }

    const route = evaluateRouteSafety({
      supportsVision: Boolean(target.capability.supportsVision),
      allowsAdultInput: Boolean(target.capability.allowsAdultInput),
      allowsAdultGeneration: Boolean(target.capability.allowsAdultGeneration),
      r18: input.r18Enabled,
      imagePresent: false,
      safetyClass: input.safetyClass,
    })
    if (!route.allow) {
      throw new Error(`AI route blocked by provider safety policy: ${route.reason}`)
    }
  }

  private async callImageGenerationProvider(
    target: ImageGenerationTarget,
    prompt: string,
    outputCount: number,
  ): Promise<ContinuationImage[]> {
    const response = await this.fetchImpl(`${target.provider.baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: target.provider.defaultModel,
        prompt,
        n: outputCount,
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    })

    const rawText = await response.text()
    if (!response.ok) {
      throw new Error(`Image generation request failed: HTTP ${response.status}`)
    }

    const payload = JSON.parse(rawText) as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }
    const images = (payload.data || []).map((item): ContinuationImage => ({
      id: randomUUID(),
      mimeType: item.b64_json ? 'image/png' : 'image/*',
      dataUrl: item.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined,
      url: item.url,
      prompt: item.revised_prompt || prompt,
      usedMock: false,
    }))

    if (!images.length) {
      throw new Error('Image generation provider returned no images')
    }
    return images
  }
}

function referenceFromBuffer(input: {
  buffer: Buffer
  fileName: string
  mimeType: string
  source: 'upload' | 'pixiv'
  sourceUrl?: string
}): ContinuationReference {
  if (input.buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('File too large')
  }
  const dimensions = detectImageDimensions(input.buffer, input.mimeType) || { width: 1200, height: 1600 }
  const metadata = extractImageMetadata(input.buffer, input.mimeType)
  const tags = metadata.tags.slice(0, 80)
  return {
    id: randomUUID(),
    fileName: input.fileName,
    mimeType: input.mimeType,
    width: dimensions.width,
    height: dimensions.height,
    source: input.source,
    sourceUrl: input.sourceUrl,
    previewDataUrl: `data:${input.mimeType};base64,${input.buffer.toString('base64')}`,
    tags,
    metadata,
  }
}

export function buildContinuationPrompt(input: {
  prompt: string
  keepCharacterConsistency: boolean
  keepBackgroundConsistency: boolean
  references: ContinuationReferenceInput[]
}): string {
  const positivePrompts = input.references
    .map((reference) => reference.metadata.positivePrompt)
    .filter((value): value is string => Boolean(value))
    .slice(0, 4)
  const negativePrompts = input.references
    .map((reference) => reference.metadata.negativePrompt)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
  const tags = uniqueNonEmpty(input.references.flatMap((reference) => reference.tags)).slice(0, 60)
  const consistency = [
    input.keepCharacterConsistency ? 'keep character identity, outfit, face shape, hair, color palette' : '',
    input.keepBackgroundConsistency ? 'keep background continuity, lighting, location, camera language' : '',
  ].filter(Boolean)

  return [
    input.prompt.trim(),
    consistency.length ? `Continuity constraints: ${consistency.join('; ')}.` : '',
    tags.length ? `Reference tags: ${tags.join(', ')}.` : '',
    positivePrompts.length ? `Source positive prompts: ${positivePrompts.join(' | ')}` : '',
    negativePrompts.length ? `Avoid: ${negativePrompts.join(', ')}` : '',
    'Create the next story image as a polished manga/anime continuation, with coherent composition and readable visual storytelling.',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000)
}

function mockContinuationImage(prompt: string, index: number, references: ContinuationReferenceInput[]): ContinuationImage {
  const tags = uniqueNonEmpty(references.flatMap((reference) => reference.tags)).slice(0, 8).join(' / ') || 'story continuation'
  const safePrompt = escapeXml(prompt.slice(0, 360))
  const safeTags = escapeXml(tags)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#fbfbfc"/>
  <rect x="72" y="72" width="880" height="880" fill="#ffffff" stroke="#171717" stroke-width="10"/>
  <rect x="112" y="112" width="800" height="460" fill="#edf2f7" stroke="#171717" stroke-width="6"/>
  <circle cx="404" cy="348" r="118" fill="#f5f5f5" stroke="#171717" stroke-width="6"/>
  <path d="M300 320 C370 230 476 252 520 358 C470 302 380 296 300 320Z" fill="#171717"/>
  <circle cx="650" cy="354" r="112" fill="#f5f5f5" stroke="#171717" stroke-width="6"/>
  <path d="M560 318 C636 242 738 270 770 370 C712 314 626 300 560 318Z" fill="#171717"/>
  <path d="M210 710 C330 610 690 610 816 710" fill="none" stroke="#171717" stroke-width="9"/>
  <rect x="132" y="610" width="760" height="258" fill="#ffffff" stroke="#171717" stroke-width="5"/>
  <text x="168" y="672" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#171717">Continuation Draft ${index + 1}</text>
  <text x="168" y="730" font-family="Arial, sans-serif" font-size="24" fill="#4b5563">${safeTags}</text>
  <foreignObject x="168" y="760" width="692" height="86">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:20px;line-height:1.35;color:#171717;">${safePrompt}</div>
  </foreignObject>
</svg>`

  return {
    id: randomUUID(),
    mimeType: 'image/svg+xml',
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    prompt,
    usedMock: true,
  }
}

// Safety classification deliberately excludes reference NEGATIVE prompts: an "Avoid: nsfw"
// line describes what the image must NOT contain, so matching it would misclassify safe
// requests built from ordinary SFW references.
function buildSafetyClassificationText(input: {
  prompt: string
  references: ContinuationReferenceInput[]
}): string {
  const positivePrompts = input.references
    .map((reference) => reference.metadata.positivePrompt)
    .filter((value): value is string => Boolean(value))
  const tags = input.references.flatMap((reference) => reference.tags)
  return [input.prompt, ...tags, ...positivePrompts].join('\n')
}

function classifyPromptSafety(value: string): SafetyClass {
  const normalized = value.toLowerCase()
  if (/\b(illegal sexual|csam|child sexual|minors? sexual)\b/.test(normalized)) {
    return 'illegal'
  }
  if (/\b(nude|nudity|explicit|sex|sexual|r-18|nsfw|uncensored)\b/.test(normalized)) {
    return 'explicit'
  }
  if (/\b(suggestive|lingerie|bikini|swimsuit|cleavage|pinup)\b/.test(normalized)) {
    return 'suggestive'
  }
  return 'safe'
}

function assertLocalPromptAllowed(input: { r18Enabled: boolean; safetyClass: SafetyClass }): void {
  const route = evaluateRouteSafety({
    supportsVision: true,
    allowsAdultInput: true,
    allowsAdultGeneration: true,
    r18: input.r18Enabled,
    imagePresent: false,
    safetyClass: input.safetyClass,
  })
  if (!route.allow) {
    throw new Error(`AI route blocked by provider safety policy: ${route.reason}`)
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
