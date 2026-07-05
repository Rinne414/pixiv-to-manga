import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Asset, Dialogue, ModelCapability, Page, ProjectDetail, ProviderProfile, StoryBible } from '../src/shared/types'
import { dialogueListSchema, storyBibleSchema } from '../src/shared/schemas'
import { type ZodType, type z } from 'zod'
import { parsePossiblyWrappedJson } from '../src/shared/jsonRepair'
import { resolveDialogueCollisions } from '../src/shared/layout'
import { evaluateRouteSafety, type RouteSafetyResult, type SafetyClass } from '../src/shared/routeSafety'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import { getAppDataDir } from './paths'
import { findMatchingCapability, findMatchingProvider, normalizeModelId } from './providerResolution'

type ParsedStoryBible = z.infer<typeof storyBibleSchema>
type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
interface AiTarget {
  apiBaseUrl: string
  modelName: string
  apiKey: string
  supportsStreaming: boolean
}

export interface AiContext {
  secrets: SecretStore
  db?: StudioDatabase
  signal?: AbortSignal
}

export class AiJsonOutputError extends Error {
  readonly raw: string
  readonly repairedRaw?: string
  readonly schemaHint: string

  constructor(input: { message: string; raw: string; repairedRaw?: string; schemaHint: string }) {
    super(input.message)
    this.name = 'AiJsonOutputError'
    this.raw = input.raw
    this.repairedRaw = input.repairedRaw
    this.schemaHint = input.schemaHint
  }
}

export async function analyzeStoryWithAi(
  context: AiContext,
  detail: ProjectDetail,
  input: { userBrief: string; r18Enabled: boolean },
): Promise<{ storyBible: StoryBible; raw: string; usedMock: boolean }> {
  const target = await resolveAiTarget(context)

  if (!target) {
    const mock = mockStoryBible(detail, input)
    return { storyBible: mock, raw: JSON.stringify(mock, null, 2), usedMock: true }
  }

  const imageParts = await projectImageParts(detail, 6)
  ensureAiGenerationAllowed(context, {
    apiBaseUrl: target.apiBaseUrl,
    modelName: target.modelName,
    r18Enabled: input.r18Enabled,
    imagePresent: imageParts.length > 0,
    safetyClass: input.r18Enabled ? 'explicit' : 'safe',
  })

  const prompt = `你是漫画编剧。请先观察随后的漫画页面图片，再基于画面、项目页数和用户补充，创建中文 Story Bible。必须只返回 JSON，字段为 synopsis, tone, characters, pageBeats, userBrief, r18Enabled。characters 每项包含 name, description, voice, color, bubbleStyle。pageBeats 每项包含 pageIndex, summary, intent。项目标题：${detail.project.title}。页数：${detail.pages.length}。用户补充：${input.userBrief || '无'}。R18: ${input.r18Enabled ? 'true' : 'false'}。`
  const raw = await openAiChatJson(target.apiBaseUrl, target.modelName, target.apiKey, [{ type: 'text', text: prompt }, ...imageParts], {
    signal: context.signal,
    stream: target.supportsStreaming,
  })
  const repaired = await parseWithOneRepair({
    raw,
    schema: storyBibleSchema,
    baseUrl: target.apiBaseUrl,
    model: target.modelName,
    apiKey: target.apiKey,
    stream: target.supportsStreaming,
    schemaHint: 'StoryBible JSON: synopsis, tone, characters[], pageBeats[], userBrief, r18Enabled',
    signal: context.signal,
  })
  return { storyBible: normalizeStoryBible(repaired.parsed, detail.project.id), raw: repaired.raw, usedMock: false }
}

export async function generateDialoguesWithAi(
  context: AiContext,
  detail: ProjectDetail,
  page: Page,
  input: { mode: 'story' | 'translation'; textDensity: number },
): Promise<{ dialogues: Dialogue[]; raw: string; usedMock: boolean }> {
  const target = await resolveAiTarget(context)
  const storyBible = detail.project.storyBible || mockStoryBible(detail, { userBrief: '', r18Enabled: false })

  if (!target) {
    const dialogues = resolveDialogueCollisions(mockDialogues(page, storyBible, input.mode))
    return { dialogues, raw: JSON.stringify({ dialogues }, null, 2), usedMock: true }
  }

  const pageImageParts = await pageImagePartsForDetail(detail, page)
  ensureAiGenerationAllowed(context, {
    apiBaseUrl: target.apiBaseUrl,
    modelName: target.modelName,
    r18Enabled: storyBible.r18Enabled,
    imagePresent: pageImageParts.length > 0,
    safetyClass: storyBible.r18Enabled ? 'explicit' : 'safe',
  })

  const beat = storyBible.pageBeats.find((item) => item.pageIndex === page.index)
  const characters = storyBible.characters.map((character) => `${character.name}: ${character.voice}`).join('\n')
  const prompt = `你是漫画对白创作者。请先观察随后的本页漫画图片，再生成叠字对白。模式：${input.mode === 'translation' ? '视觉翻译/改写，不原创大剧情' : '原创故事对白'}。请为第 ${page.index + 1} 页生成中文漫画对白。故事：${storyBible.synopsis}。本页剧情：${beat?.summary || '未指定'}。角色声音：${characters}。文本密度：${input.textDensity}。必须只返回 JSON：{"dialogues":[{"text":"...","characterName":"...","x":0.5,"y":0.5,"scale":1,"rotation":0,"bubbleStyle":"speech","color":"#141414","locked":false}]}. x/y 是 0-1 画面坐标，避免挡脸、遮住关键画面和互相重叠。`
  const raw = await openAiChatJson(target.apiBaseUrl, target.modelName, target.apiKey, [{ type: 'text', text: prompt }, ...pageImageParts], {
    signal: context.signal,
    stream: target.supportsStreaming,
  })
  const repaired = await parseWithOneRepair({
    raw,
    schema: dialogueListSchema,
    baseUrl: target.apiBaseUrl,
    model: target.modelName,
    apiKey: target.apiKey,
    stream: target.supportsStreaming,
    schemaHint: 'Dialogue list JSON: {"dialogues":[{"text","characterName","x","y","scale","rotation","bubbleStyle","color","locked"}]}',
    signal: context.signal,
  })
  const parsed = repaired.parsed
  const dialogues = resolveDialogueCollisions(
    parsed.dialogues.map((dialogue) => ({
      ...dialogue,
      id: dialogue.id || randomUUID(),
      pageId: page.id,
      color: dialogue.color || '#141414',
      raw: repaired.raw,
    })),
  )
  return { dialogues, raw: repaired.raw, usedMock: false }
}

async function resolveAiTarget(context: AiContext): Promise<AiTarget | null> {
  const status = await context.secrets.status()
  const globalApiKey = await context.secrets.getApiKey()

  if (status.apiBaseUrl && status.modelName) {
    const matchingProvider = context.db
      ? findMatchingProvider(context.db.listProviders(), status.apiBaseUrl, status.modelName)
      : undefined
    const capability = matchingProvider && context.db ? findMatchingCapability(context.db, matchingProvider.id, status.modelName) : undefined
    const providerApiKey = matchingProvider ? await context.secrets.getProviderApiKey(matchingProvider.id) : null
    const apiKey = globalApiKey || providerApiKey
    // Local providers (Ollama, LM Studio, ...) may run without an API key; external routes still require one.
    if (!apiKey && !matchingProvider?.isLocal) {
      return null
    }
    return {
      apiBaseUrl: status.apiBaseUrl,
      modelName: status.modelName,
      apiKey: apiKey || '',
      supportsStreaming: Boolean(capability?.supportsStreaming),
    }
  }

  if (!context.db) {
    return null
  }

  for (const provider of context.db.listProviders()) {
    if (!provider.baseUrl || !provider.defaultModel) {
      continue
    }
    const apiKey = await context.secrets.getProviderApiKey(provider.id)
    if (apiKey || provider.isLocal) {
      const capability = findMatchingCapability(context.db, provider.id, provider.defaultModel)
      return {
        apiBaseUrl: provider.baseUrl,
        modelName: provider.defaultModel,
        apiKey: apiKey || '',
        supportsStreaming: Boolean(capability?.supportsStreaming),
      }
    }
  }

  return null
}

export function evaluateAiGenerationRoute(input: {
  apiBaseUrl: string
  modelName: string
  r18Enabled: boolean
  imagePresent: boolean
  safetyClass: SafetyClass
  providers: ProviderProfile[]
  capabilities: ModelCapability[]
}): RouteSafetyResult {
  const provider = findMatchingProvider(input.providers, input.apiBaseUrl, input.modelName)
  const capability = provider
    ? input.capabilities.find(
        (item) => item.providerId === provider.id && normalizeModelId(item.modelId) === normalizeModelId(input.modelName),
      )
    : undefined

  if ((input.r18Enabled || input.imagePresent) && !capability) {
    return {
      allow: false,
      reason: input.imagePresent ? 'vision_required' : 'adult_generation_not_allowed',
    }
  }

  return evaluateRouteSafety({
    supportsVision: capability?.supportsVision ?? false,
    allowsAdultInput: capability?.allowsAdultInput ?? false,
    allowsAdultGeneration: capability?.allowsAdultGeneration ?? false,
    r18: input.r18Enabled,
    imagePresent: input.imagePresent,
    safetyClass: input.safetyClass,
  })
}

function ensureAiGenerationAllowed(
  context: AiContext,
  input: {
    apiBaseUrl: string
    modelName: string
    r18Enabled: boolean
    imagePresent: boolean
    safetyClass: SafetyClass
  },
): void {
  if (!context.db) return

  const result = evaluateAiGenerationRoute({
    ...input,
    providers: context.db.listProviders(),
    capabilities: context.db.listModelCapabilities(),
  })

  if (!result.allow) {
    throw new Error(`AI route blocked by provider safety policy: ${result.reason}`)
  }
}

async function openAiChatJson(
  baseUrl: string,
  model: string,
  apiKey: string,
  content: ChatContentPart[],
  options: { signal?: AbortSignal; stream?: boolean } = {},
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal: options.signal,
    headers: {
      // Keyless local providers (empty apiKey) get no Authorization header at all.
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      temperature: 0.9,
      stream: options.stream === true,
    }),
  })

  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status}`)
  }

  const rawText = await response.text()
  const contentText = responseLooksLikeEventStream(response, rawText)
    ? contentFromOpenAiStream(rawText)
    : contentFromOpenAiJson(rawText)
  if (!contentText) {
    throw new Error('AI returned an empty response')
  }
  return contentText
}

function responseLooksLikeEventStream(response: Response, rawText: string): boolean {
  return response.headers.get('content-type')?.includes('text/event-stream') || rawText.trimStart().startsWith('data:')
}

function contentFromOpenAiJson(rawText: string): string {
  const payload = JSON.parse(rawText) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return payload.choices?.[0]?.message?.content || ''
}

function contentFromOpenAiStream(rawText: string): string {
  let content = ''
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      continue
    }
    const data = trimmed.slice('data:'.length).trim()
    if (!data || data === '[DONE]') {
      continue
    }
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
    }
    for (const choice of payload.choices || []) {
      content += choice.delta?.content || choice.message?.content || ''
    }
  }
  return content
}

async function parseWithOneRepair<T>(input: {
  raw: string
  schema: ZodType<T>
  baseUrl: string
  model: string
  apiKey: string
  stream: boolean
  schemaHint: string
  signal?: AbortSignal
}): Promise<{ parsed: T; raw: string }> {
  try {
    return { parsed: input.schema.parse(parsePossiblyWrappedJson(input.raw)), raw: input.raw }
  } catch (error) {
    const repairPrompt = `上一次模型输出不是有效 JSON 或不符合 schema。请只返回修正后的 JSON，不要解释。\nSchema: ${input.schemaHint}\n错误: ${error instanceof Error ? error.message : 'unknown'}\n原始输出:\n${input.raw.slice(0, 12000)}`
    const repairedRaw = await openAiChatJson(input.baseUrl, input.model, input.apiKey, [{ type: 'text', text: repairPrompt }], {
      signal: input.signal,
      stream: input.stream,
    })
    try {
      return { parsed: input.schema.parse(parsePossiblyWrappedJson(repairedRaw)), raw: repairedRaw }
    } catch (repairError) {
      throw new AiJsonOutputError({
        message: `AI output could not be parsed after repair: ${repairError instanceof Error ? repairError.message : 'unknown'}`,
        raw: input.raw,
        repairedRaw,
        schemaHint: input.schemaHint,
      })
    }
  }
}

async function projectImageParts(detail: ProjectDetail, maxImages: number): Promise<ChatContentPart[]> {
  const assetsById = new Map(detail.assets.map((asset) => [asset.id, asset]))
  const parts: ChatContentPart[] = []
  for (const page of detail.pages.slice(0, maxImages)) {
    const asset = assetsById.get(page.originalAssetId)
    if (!asset) continue
    parts.push({ type: 'text', text: `Page ${page.index + 1}` })
    parts.push(await assetToImagePart(asset))
  }
  return parts
}

async function pageImagePartsForDetail(detail: ProjectDetail, page: Page): Promise<ChatContentPart[]> {
  const asset = detail.assets.find((item) => item.id === page.originalAssetId)
  return asset ? [await assetToImagePart(asset)] : []
}

async function assetToImagePart(asset: Asset): Promise<ChatContentPart> {
  const data = await readFile(assetAbsolutePath(asset))
  return {
    type: 'image_url',
    image_url: {
      url: `data:${asset.mimeType};base64,${data.toString('base64')}`,
    },
  }
}

function assetAbsolutePath(asset: Asset): string {
  const appDataDir = path.resolve(getAppDataDir())
  const relativePath = asset.url.replace(/^\/assets\//, '')
  const absolutePath = path.resolve(appDataDir, relativePath)
  if (!absolutePath.startsWith(appDataDir + path.sep) && absolutePath !== appDataDir) {
    throw new Error('Asset path escaped the app data directory')
  }
  return absolutePath
}

function normalizeStoryBible(storyBible: ParsedStoryBible, projectId: string): StoryBible {
  return {
    ...storyBible,
    characters: storyBible.characters.map((character) => ({
      ...character,
      id: character.id || randomUUID(),
      projectId,
      color: character.color || '#141414',
      bubbleStyle: character.bubbleStyle || 'speech',
    })),
  }
}

function mockStoryBible(detail: ProjectDetail, input: { userBrief: string; r18Enabled: boolean }): StoryBible {
  const projectId = detail.project.id
  return {
    synopsis: '夏日傍晚，两位在车站偶遇的学生因为一张旧车票重新连接。故事从尴尬的寒暄开始，逐渐变成共同前往海边的约定。',
    tone: '清爽、轻小说感、对白带有漫画节奏，情绪逐页推进。',
    userBrief: input.userBrief,
    r18Enabled: input.r18Enabled,
    characters: [
      {
        id: randomUUID(),
        projectId,
        name: '夏海',
        description: '外向但有点逞强的女生，习惯用轻快的话掩饰紧张。',
        voice: '短句、直接、带一点玩笑感。',
        color: '#c9282d',
        bubbleStyle: 'speech',
      },
      {
        id: randomUUID(),
        projectId,
        name: '悠真',
        description: '认真温柔的男生，不擅长主动表达。',
        voice: '语气克制，偶尔会认真过头。',
        color: '#1d5f9f',
        bubbleStyle: 'soft',
      },
    ],
    pageBeats: detail.pages.map((page) => ({
      pageIndex: page.index,
      summary: `第 ${page.index + 1} 页：两人关系向前推进，画面情绪从观察转向行动。`,
      intent: page.index === 0 ? '建立相遇和约定' : page.index === 1 ? '让两人开始对话' : '推动他们一起出发',
    })),
  }
}

function mockDialogues(page: Page, storyBible: StoryBible, mode: 'story' | 'translation'): Dialogue[] {
  const names = storyBible.characters
  const first = names[0]
  const second = names[1] || names[0]
  const prefix = mode === 'translation' ? '这句原文的意思是，' : ''

  return [
    {
      id: randomUUID(),
      pageId: page.id,
      characterId: first?.id,
      characterName: first?.name,
      text: `${prefix}那一天，天空蓝得有点不真实。`,
      x: 0.18,
      y: 0.24,
      scale: 1,
      rotation: 0,
      bubbleStyle: 'caption',
      color: first?.color || '#141414',
      locked: false,
    },
    {
      id: randomUUID(),
      pageId: page.id,
      characterId: second?.id,
      characterName: second?.name,
      text: '如果现在出发，还能赶上海边的落日。',
      x: 0.82,
      y: 0.36,
      scale: 1,
      rotation: 0,
      bubbleStyle: 'speech',
      color: second?.color || '#141414',
      locked: false,
    },
    {
      id: randomUUID(),
      pageId: page.id,
      characterId: first?.id,
      characterName: first?.name,
      text: '那就别犹豫了，一起去吧！',
      x: 0.72,
      y: 0.76,
      scale: 1,
      rotation: 0,
      bubbleStyle: 'speech',
      color: first?.color || '#141414',
      locked: false,
    },
  ]
}
