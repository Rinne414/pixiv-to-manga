import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type {
  ActiveEngineInfo,
  Asset,
  Dialogue,
  ModelCapability,
  Page,
  PanelBox,
  ProjectDetail,
  ProviderProfile,
  ReadingDirection,
  StoryBible,
} from '../src/shared/types'
import { dialogueListSchema, regeneratedLineSchema, storyBibleSchema } from '../src/shared/schemas'
import { z, type ZodType } from 'zod'
import { parsePossiblyWrappedJson } from '../src/shared/jsonRepair'
import { resolveDialogueCollisions, snapDialoguesToPanels } from '../src/shared/layout'
import { evaluateRouteSafety, type RouteSafetyResult, type SafetyClass } from '../src/shared/routeSafety'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import { getAppDataDir } from './paths'
import { findMatchingCapability, findMatchingProvider, isTrustedLocalProvider, normalizeModelId } from './providerResolution'

type ParsedStoryBible = z.infer<typeof storyBibleSchema>
type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
interface AiTarget {
  apiBaseUrl: string
  modelName: string
  apiKey: string
  supportsStreaming: boolean
  supportsJsonSchema: boolean
}

interface JsonSchemaResponseFormat {
  name: string
  schema: Record<string, unknown>
}

interface OpenAiChatOptions {
  signal: AbortSignal | undefined
  stream: boolean
  onDelta: ((accumulated: string) => void) | undefined
  responseFormat: JsonSchemaResponseFormat | undefined
}

export interface AiContext {
  secrets: SecretStore
  db?: StudioDatabase
  signal?: AbortSignal
  /** Receives the accumulated model text while a response streams (primary call only). */
  onDelta?: (accumulated: string) => void
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

export class AiProviderRefusalError extends Error {
  readonly raw: string
  readonly repairedRaw?: string

  constructor(input: { raw: string; repairedRaw?: string }) {
    super('AI provider refused the request: content_policy')
    this.name = 'AiProviderRefusalError'
    this.raw = input.raw
    this.repairedRaw = input.repairedRaw
  }
}

export class AiProviderHttpError extends Error {
  readonly status: number
  readonly endpoint: string
  readonly model: string
  readonly responseBody: string

  constructor(input: { status: number; endpoint: string; model: string; responseBody: string }) {
    super(`AI provider request failed: HTTP ${input.status}`)
    this.name = 'AiProviderHttpError'
    this.status = input.status
    this.endpoint = input.endpoint
    this.model = input.model
    this.responseBody = input.responseBody
  }
}

export async function analyzeStoryWithAi(
  context: AiContext,
  detail: ProjectDetail,
  input: { userBrief: string; r18Enabled: boolean },
): Promise<{ storyBible: StoryBible; raw: string; usedMock: boolean }> {
  // The style prompt is user-authored config, not model output; re-analysis must never drop it.
  const preservedStylePrompt = detail.project.storyBible?.stylePrompt
    ? { stylePrompt: detail.project.storyBible.stylePrompt }
    : {}

  if (!(await resolveAiRoute(context))) {
    const mock = { ...mockStoryBible(detail, input), ...preservedStylePrompt }
    return { storyBible: mock, raw: JSON.stringify(mock, null, 2), usedMock: true }
  }

  const imageParts = await projectImageParts(detail, 6)
  const target = await resolveAiTarget(context, {
    r18Enabled: input.r18Enabled,
    imagePresent: imageParts.length > 0,
    safetyClass: input.r18Enabled ? 'explicit' : 'safe',
  })
  if (!target) throw new Error('AI route became unavailable during story analysis')

  ensureAiGenerationAllowed(context, {
    apiBaseUrl: target.apiBaseUrl,
    modelName: target.modelName,
    r18Enabled: input.r18Enabled,
    imagePresent: imageParts.length > 0,
    safetyClass: input.r18Enabled ? 'explicit' : 'safe',
  })

  const stylePrompt = detail.project.storyBible?.stylePrompt?.trim()
  const prompt = `你是漫画编剧。请先观察随后的漫画页面图片，再基于画面、项目页数和用户补充，创建中文 Story Bible。必须只返回 JSON，字段为 synopsis, tone, characters, pageBeats, userBrief, r18Enabled。characters 每项包含 name, description, voice, color, bubbleStyle。pageBeats 每项包含 pageIndex, summary, intent。项目标题：${detail.project.title}。页数：${detail.pages.length}。用户补充：${input.userBrief || '无'}。${stylePrompt ? `风格要求（必须遵守）：${stylePrompt}。` : ''}R18: ${input.r18Enabled ? 'true' : 'false'}。`
  const responseFormat = target.supportsJsonSchema ? jsonSchemaResponseFormat('story_bible', storyBibleSchema) : undefined
  const raw = await openAiChatJson(target.apiBaseUrl, target.modelName, target.apiKey, [{ type: 'text', text: prompt }, ...imageParts], {
    signal: context.signal,
    stream: target.supportsStreaming,
    onDelta: context.onDelta,
    responseFormat,
  })
  if (imageParts.length > 0) recordVisionSupport(context, target)
  const repaired = await parseWithOneRepair({
    raw,
    schema: storyBibleSchema,
    baseUrl: target.apiBaseUrl,
    model: target.modelName,
    apiKey: target.apiKey,
    stream: target.supportsStreaming,
    schemaHint: 'StoryBible JSON: synopsis, tone, characters[], pageBeats[], userBrief, r18Enabled',
    signal: context.signal,
    responseFormat,
  })
  return {
    storyBible: { ...normalizeStoryBible(repaired.parsed, detail.project.id), ...preservedStylePrompt },
    raw: repaired.raw,
    usedMock: false,
  }
}

export async function generateDialoguesWithAi(
  context: AiContext,
  detail: ProjectDetail,
  page: Page,
  input: { mode: 'story' | 'translation'; textDensity: number },
): Promise<{ dialogues: Dialogue[]; raw: string; usedMock: boolean }> {
  const storyBible = detail.project.storyBible || mockStoryBible(detail, { userBrief: '', r18Enabled: false })
  // User-locked lines survive regeneration; the model writes around them.
  const lockedLines = detail.dialogues.filter((item) => item.pageId === page.id && item.locked)

  if (!(await resolveAiRoute(context))) {
    const dialogues = resolveDialogueCollisions([...lockedLines, ...mockDialogues(page, storyBible, input.mode)])
    return { dialogues, raw: JSON.stringify({ dialogues }, null, 2), usedMock: true }
  }

  const pageImageParts = await pageImagePartsForDetail(detail, page)
  const nextPage = detail.pages.find((item) => item.index === page.index + 1)
  const nextPageImageParts = nextPage ? await pageImagePartsForDetail(detail, nextPage) : []
  const target = await resolveAiTarget(context, {
    r18Enabled: storyBible.r18Enabled,
    imagePresent: pageImageParts.length + nextPageImageParts.length > 0,
    safetyClass: storyBible.r18Enabled ? 'explicit' : 'safe',
  })
  if (!target) throw new Error('AI route became unavailable during page generation')

  ensureAiGenerationAllowed(context, {
    apiBaseUrl: target.apiBaseUrl,
    modelName: target.modelName,
    r18Enabled: storyBible.r18Enabled,
    imagePresent: pageImageParts.length + nextPageImageParts.length > 0,
    safetyClass: storyBible.r18Enabled ? 'explicit' : 'safe',
  })

  const beat = storyBible.pageBeats.find((item) => item.pageIndex === page.index)
  const nextBeat = nextPage ? storyBible.pageBeats.find((item) => item.pageIndex === nextPage.index) : undefined
  const characters = storyBible.characters.map((character) => `${character.name}: ${character.voice}`).join('\n')
  const stylePrompt = storyBible.stylePrompt?.trim()
  const previousLines = previousPageDialogueLines(detail, page)
  const panelSection = panelPromptSection(page.panels, detail.project.readingDirection)
  const flowContext = nextPage
    ? `下一页剧情：${nextBeat?.summary || '未指定'}。本页最后一句要自然引向下一页。`
    : '本页是最后一页，对白要有收束感。'
  const continuityContext = previousLines ? `上一页对白（延续语气与话题，不要重复）：\n${previousLines}\n` : ''
  const lockedContext = lockedLines.length
    ? `本页已有 ${lockedLines.length} 句用户锁定的对白（会原样保留，不要重复它们的内容，只补充其余对白）：\n${lockedLines.map((item) => `${item.characterName || '旁白'}：${item.text}`).join('\n')}\n`
    : ''
  const prompt = `你是漫画对白创作者。请先观察图片：第一张是本页画面${nextPageImageParts.length ? '，第二张是下一页画面（仅用于衔接剧情，不要为它生成对白）' : ''}。模式：${input.mode === 'translation' ? '视觉翻译/改写，不原创大剧情' : '原创故事对白'}。请为第 ${page.index + 1} 页生成中文漫画对白。故事：${storyBible.synopsis}。本页剧情：${beat?.summary || '未指定'}。${flowContext}${continuityContext}${lockedContext}角色声音：${characters}。${stylePrompt ? `风格要求（必须遵守）：${stylePrompt}。` : ''}${panelSection}文本密度：${input.textDensity}。必须只返回 JSON：{"dialogues":[{"text":"...","characterName":"...","x":0.5,"y":0.5,"scale":1,"rotation":0,"bubbleStyle":"speech","color":"#141414","locked":false}]}. bubbleStyle 可选 speech/soft/thought/caption/sfx/shout/whisper；拟声词、音效字用 sfx（无气泡描边大字，不要设 characterName），大喊用 shout（锯齿爆炸框），耳语用 whisper（虚线框）。x/y 是 0-1 画面坐标，避免挡脸、遮住关键画面和互相重叠。`
  const content: ChatContentPart[] = [{ type: 'text', text: prompt }, ...pageImageParts]
  if (nextPageImageParts.length) {
    content.push({ type: 'text', text: '下一页画面（仅供衔接参考，不要为它生成对白）：' }, ...nextPageImageParts)
  }
  const responseFormat = target.supportsJsonSchema ? jsonSchemaResponseFormat('page_dialogues', dialogueListSchema) : undefined
  const raw = await openAiChatJson(target.apiBaseUrl, target.modelName, target.apiKey, content, {
    signal: context.signal,
    stream: target.supportsStreaming,
    onDelta: context.onDelta,
    responseFormat,
  })
  if (pageImageParts.length + nextPageImageParts.length > 0) recordVisionSupport(context, target)
  const repaired = await parseWithOneRepair({
    raw,
    schema: dialogueListSchema,
    baseUrl: target.apiBaseUrl,
    model: target.modelName,
    apiKey: target.apiKey,
    stream: target.supportsStreaming,
    schemaHint: 'Dialogue list JSON: {"dialogues":[{"text","characterName","x","y","scale","rotation","bubbleStyle","color","locked"}]}',
    signal: context.signal,
    responseFormat,
  })
  const parsed = repaired.parsed
  // Models only return characterName; resolve the ID so per-character styling (font, color) applies.
  const characterIdsByName = new Map(storyBible.characters.map((character) => [character.name, character.id]))
  const dialogues = resolveDialogueCollisions(
    snapDialoguesToPanels(
      [
        ...lockedLines,
        ...parsed.dialogues.map((dialogue) => ({
          ...dialogue,
          id: dialogue.id || randomUUID(),
          pageId: page.id,
          characterId: dialogue.characterId || (dialogue.characterName ? characterIdsByName.get(dialogue.characterName) : undefined),
          color: dialogue.color || '#141414',
          raw: repaired.raw,
        })),
      ],
      page.panels,
    ),
  )
  return { dialogues, raw: repaired.raw, usedMock: false }
}

/**
 * Prompt fragment describing the user-drawn panel frames in reading order so
 * the model places dialogue inside the right frame; empty when no panels exist.
 */
export function panelPromptSection(panels: PanelBox[] | undefined, readingDirection: ReadingDirection): string {
  if (!panels?.length) {
    return ''
  }
  const order = readingDirection === 'rtl' ? '从右到左、从上到下（日式漫画）' : '从左到右、从上到下'
  const list = panels
    .map(
      (panel, index) =>
        `格${index + 1}：x ${panel.x.toFixed(2)}-${(panel.x + panel.width).toFixed(2)}，y ${panel.y.toFixed(2)}-${(panel.y + panel.height).toFixed(2)}`,
    )
    .join('；')
  return `本页画了 ${panels.length} 个分格，阅读顺序为${order}，编号即阅读顺序：${list}。每句对白的 x/y 必须落在其剧情所属格子的范围内，贴近格子边缘，不要盖住格子中心。`
}

export async function regenerateDialogueTextWithAi(
  context: AiContext,
  detail: ProjectDetail,
  dialogue: Dialogue,
  input: { instruction: string; mode: 'story' | 'translation'; textDensity: number },
): Promise<{ text: string; raw: string; usedMock: boolean }> {
  const storyBible = detail.project.storyBible || mockStoryBible(detail, { userBrief: '', r18Enabled: false })
  const page = detail.pages.find((item) => item.id === dialogue.pageId)
  if (!page) {
    throw new Error('Dialogue page not found')
  }

  if (!(await resolveAiRoute(context))) {
    const text = input.instruction ? `（${input.instruction}）${dialogue.text}` : `重写版：${dialogue.text}`
    return { text, raw: JSON.stringify({ text }, null, 2), usedMock: true }
  }

  const pageImageParts = await pageImagePartsForDetail(detail, page)
  const target = await resolveAiTarget(context, {
    r18Enabled: storyBible.r18Enabled,
    imagePresent: pageImageParts.length > 0,
    safetyClass: storyBible.r18Enabled ? 'explicit' : 'safe',
  })
  if (!target) throw new Error('AI route became unavailable during dialogue regeneration')

  ensureAiGenerationAllowed(context, {
    apiBaseUrl: target.apiBaseUrl,
    modelName: target.modelName,
    r18Enabled: storyBible.r18Enabled,
    imagePresent: pageImageParts.length > 0,
    safetyClass: storyBible.r18Enabled ? 'explicit' : 'safe',
  })

  const character = storyBible.characters.find(
    (item) => item.id === dialogue.characterId || (dialogue.characterName && item.name === dialogue.characterName),
  )
  const beat = storyBible.pageBeats.find((item) => item.pageIndex === page.index)
  const siblingLines = detail.dialogues
    .filter((item) => item.pageId === page.id)
    .map((item) =>
      item.id === dialogue.id
        ? `>>【要重写的这句】${item.characterName || '旁白'}：${item.text}`
        : `${item.characterName || '旁白'}：${item.text}`,
    )
    .join('\n')
  const stylePrompt = storyBible.stylePrompt?.trim()
  const prompt = `你是漫画对白编辑。请只重写标记为【要重写的这句】的那一句中文对白，其余对白保持不变、仅作上下文。模式：${input.mode === 'translation' ? '视觉翻译/改写' : '原创故事对白'}。故事：${storyBible.synopsis}。本页剧情：${beat?.summary || '未指定'}。${character ? `说话角色 ${character.name} 的声音：${character.voice}。` : ''}${stylePrompt ? `风格要求（必须遵守）：${stylePrompt}。` : ''}${input.instruction ? `用户修改指示（最优先遵守）：${input.instruction}。` : ''}文本密度：${input.textDensity}。本页对白：\n${siblingLines}\n必须只返回 JSON：{"text":"重写后的这一句"}。`
  const responseFormat = target.supportsJsonSchema ? jsonSchemaResponseFormat('dialogue_rewrite', regeneratedLineSchema) : undefined
  const raw = await openAiChatJson(target.apiBaseUrl, target.modelName, target.apiKey, [{ type: 'text', text: prompt }, ...pageImageParts], {
    signal: context.signal,
    stream: target.supportsStreaming,
    onDelta: context.onDelta,
    responseFormat,
  })
  if (pageImageParts.length > 0) recordVisionSupport(context, target)
  const repaired = await parseWithOneRepair({
    raw,
    schema: regeneratedLineSchema,
    baseUrl: target.apiBaseUrl,
    model: target.modelName,
    apiKey: target.apiKey,
    stream: target.supportsStreaming,
    schemaHint: 'Rewrite JSON: {"text":"..."}',
    signal: context.signal,
    responseFormat,
  })
  return { text: repaired.parsed.text, raw: repaired.raw, usedMock: false }
}

interface ResolvedAiRoute extends AiTarget {
  isLocal: boolean
  source: 'global' | 'provider'
  provider?: ProviderProfile
}

interface AiRouteRequirements {
  r18Enabled: boolean
  imagePresent: boolean
  safetyClass: SafetyClass
}

/**
 * Single source of truth for "which AI route will generations use":
 *   1. Saved Provider profiles are the primary connection path.
 *   2. The legacy global Base URL + model is considered only as a fallback.
 */
async function resolveAiRoute(context: AiContext): Promise<ResolvedAiRoute | null> {
  return (await resolveAiRoutes(context))[0] || null
}

async function resolveAiRoutes(context: AiContext): Promise<ResolvedAiRoute[]> {
  const [status, globalApiKey] = await Promise.all([context.secrets.status(), context.secrets.getApiKey()])
  const providers = context.db?.listProviders() || []
  const routes: ResolvedAiRoute[] = []

  for (const provider of providers) {
    if (!provider.baseUrl || !provider.defaultModel) {
      continue
    }
    const apiKey = await context.secrets.getProviderApiKey(provider.id)
    const isLocal = isTrustedLocalProvider(provider)
    if (apiKey || isLocal) {
      const capability = context.db ? findMatchingCapability(context.db, provider.id, provider.defaultModel) : undefined
      routes.push({
        apiBaseUrl: provider.baseUrl,
        modelName: provider.defaultModel,
        apiKey: apiKey || '',
        supportsStreaming: Boolean(capability?.supportsStreaming),
        supportsJsonSchema: Boolean(capability?.supportsJsonSchema),
        isLocal,
        source: 'provider',
        provider,
      })
    }
  }

  if (status.apiBaseUrl && status.modelName) {
    const matchingProvider = findMatchingProvider(providers, status.apiBaseUrl, status.modelName)
    const isLocal = matchingProvider ? isTrustedLocalProvider(matchingProvider) : false
    const duplicateProviderRoute = routes.some((route) => route.provider?.id === matchingProvider?.id)
    if (!duplicateProviderRoute && (globalApiKey || isLocal)) {
      const capability = matchingProvider && context.db
        ? findMatchingCapability(context.db, matchingProvider.id, status.modelName)
        : undefined
      routes.push({
        apiBaseUrl: status.apiBaseUrl,
        modelName: status.modelName,
        apiKey: globalApiKey || '',
        supportsStreaming: Boolean(capability?.supportsStreaming),
        supportsJsonSchema: Boolean(capability?.supportsJsonSchema),
        isLocal,
        source: 'global',
        provider: matchingProvider,
      })
    }
  }

  return routes
}

async function resolveAiTarget(context: AiContext, requirements: AiRouteRequirements): Promise<AiTarget | null> {
  const routes = await resolveAiRoutes(context)
  if (!routes.length) {
    return null
  }
  if (!context.db) {
    return aiTargetFromRoute(routes[0])
  }

  const providers = context.db.listProviders()
  const capabilities = context.db.listModelCapabilities()
  let firstBlockedReason: string | undefined
  for (const route of routes) {
    const result = evaluateAiGenerationRoute({
      apiBaseUrl: route.apiBaseUrl,
      modelName: route.modelName,
      ...requirements,
      providers,
      capabilities,
    })
    if (result.allow) {
      return aiTargetFromRoute(route)
    }
    firstBlockedReason ||= result.reason
  }

  throw new Error(`AI route blocked by provider safety policy: ${firstBlockedReason || 'no_compatible_provider'}`)
}

function aiTargetFromRoute(route: ResolvedAiRoute): AiTarget {
  return {
    apiBaseUrl: route.apiBaseUrl,
    modelName: route.modelName,
    apiKey: route.apiKey,
    supportsStreaming: route.supportsStreaming,
    supportsJsonSchema: route.supportsJsonSchema,
  }
}

/** Sanitized view of the active route for the UI; never exposes key material. */
export async function describeAiTarget(context: AiContext): Promise<ActiveEngineInfo | null> {
  const route = await resolveAiRoute(context)
  if (!route) {
    return null
  }
  return {
    apiBaseUrl: route.apiBaseUrl,
    modelName: route.modelName,
    isLocal: route.isLocal,
    hasApiKey: Boolean(route.apiKey),
    source: route.source,
    providerId: route.provider?.id,
    providerName: route.provider?.name,
  }
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

  if (input.r18Enabled && !capability) {
    return { allow: false, reason: 'adult_generation_capability_unknown' }
  }

  if (input.r18Enabled && capability?.capabilitySources.allowsAdultGeneration === 'unknown') {
    return { allow: false, reason: 'adult_generation_capability_unknown' }
  }
  if (
    input.imagePresent &&
    (input.safetyClass === 'suggestive' || input.safetyClass === 'explicit') &&
    capability?.capabilitySources.allowsAdultInput === 'unknown'
  ) {
    return { allow: false, reason: 'adult_input_capability_unknown' }
  }

  return evaluateRouteSafety({
    supportsVision:
      !capability || capability.capabilitySources.supportsVision === 'unknown'
        ? true
        : capability.supportsVision,
    allowsAdultInput: capability?.allowsAdultInput ?? false,
    allowsAdultGeneration: capability?.allowsAdultGeneration ?? false,
    r18: input.r18Enabled,
    imagePresent: input.imagePresent,
    safetyClass: input.safetyClass,
  })
}

function recordVisionSupport(context: AiContext, target: AiTarget): void {
  if (!context.db) return
  const provider = findMatchingProvider(context.db.listProviders(), target.apiBaseUrl, target.modelName)
  if (!provider) return
  const current = findMatchingCapability(context.db, provider.id, target.modelName)
  if (current?.capabilitySources.supportsVision === 'user') return
  context.db.upsertModelCapability({
    providerId: provider.id,
    modelId: target.modelName,
    supportsVision: true,
    capabilitySources: { supportsVision: 'tested' },
    source: current?.source === 'user' ? 'user' : 'tested',
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

// Generous ceiling for slow local models on CPU; a dead connection still unsticks
// the job without waiting for the user to cancel manually.
const AI_REQUEST_TIMEOUT_MS = 300_000

async function openAiChatJson(
  baseUrl: string,
  model: string,
  apiKey: string,
  content: ChatContentPart[],
  options: OpenAiChatOptions,
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  let contentText: string
  try {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
    const response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        // Keyless local providers (empty apiKey) get no Authorization header at all.
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        temperature: 0.9,
        stream: options.stream,
        ...(options.responseFormat
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: options.responseFormat,
              },
            }
          : {}),
      }),
    })

    if (!response.ok) {
      throw new AiProviderHttpError({
        status: response.status,
        endpoint,
        model,
        responseBody: sanitizeProviderResponseBody(await response.text()),
      })
    }

    // The same signal covers the body read; a stalled stream times out too.
    contentText = await readOpenAiContent(response, options.onDelta)
  } catch (error) {
    if (timeoutSignal.aborted && !options.signal?.aborted) {
      throw new Error(`AI request timed out after ${AI_REQUEST_TIMEOUT_MS / 1000}s`, { cause: error })
    }
    throw error
  }
  if (!contentText) {
    throw new Error('AI returned an empty response')
  }
  return contentText
}

const STREAM_DELTA_THROTTLE_MS = 300

/**
 * Reads the response body incrementally: SSE `data:` lines accumulate into
 * content (emitting throttled onDelta snapshots for live display); bodies with
 * no data lines fall back to plain chat-completion JSON. Format is judged from
 * the body itself — some local providers stream without an event-stream header.
 */
async function readOpenAiContent(response: Response, onDelta?: (accumulated: string) => void): Promise<string> {
  const accumulator = new OpenAiStreamAccumulator()
  const decoder = new TextDecoder()
  let raw = ''
  let lastEmit = 0

  const reader = response.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunkText = decoder.decode(value, { stream: true })
      raw += chunkText
      accumulator.push(chunkText)
      const now = Date.now()
      if (onDelta && accumulator.sawDataLine && accumulator.content && now - lastEmit >= STREAM_DELTA_THROTTLE_MS) {
        lastEmit = now
        onDelta(accumulator.content)
      }
    }
    raw += decoder.decode()
  } else {
    raw = await response.text()
    accumulator.push(raw)
  }
  accumulator.finish()

  if (accumulator.sawDataLine) {
    if (onDelta && accumulator.content) {
      onDelta(accumulator.content)
    }
    return accumulator.content
  }
  return contentFromOpenAiJson(raw)
}

function contentFromOpenAiJson(rawText: string): string {
  const payload = JSON.parse(rawText) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return payload.choices?.[0]?.message?.content || ''
}

/** Incremental OpenAI SSE parser: feed arbitrary chunks, read `content` as it grows. */
export class OpenAiStreamAccumulator {
  content = ''
  sawDataLine = false
  private lineBuffer = ''

  push(chunk: string): void {
    this.lineBuffer += chunk
    let newlineIndex = this.lineBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex)
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1)
      this.consumeLine(line)
      newlineIndex = this.lineBuffer.indexOf('\n')
    }
  }

  /** Flush a trailing line that never got its newline (end of body). */
  finish(): void {
    if (this.lineBuffer) {
      this.consumeLine(this.lineBuffer)
      this.lineBuffer = ''
    }
  }

  private consumeLine(rawLine: string): void {
    const trimmed = rawLine.trim()
    if (!trimmed.startsWith('data:')) return
    this.sawDataLine = true
    const data = trimmed.slice('data:'.length).trim()
    if (!data || data === '[DONE]') return
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
      }
      for (const choice of payload.choices || []) {
        this.content += choice.delta?.content || choice.message?.content || ''
      }
    } catch {
      // Malformed data line: skip it — the accumulated content is schema-validated
      // downstream (parseWithOneRepair), so corruption surfaces there, not here.
    }
  }
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
  responseFormat: JsonSchemaResponseFormat | undefined
}): Promise<{ parsed: T; raw: string }> {
  try {
    return { parsed: input.schema.parse(parsePossiblyWrappedJson(input.raw)), raw: input.raw }
  } catch (error) {
    if (isProviderRefusal(input.raw)) {
      throw new AiProviderRefusalError({ raw: input.raw })
    }
    const repairPrompt = `上一次模型输出不是有效 JSON 或不符合 schema。请只返回修正后的 JSON，不要解释。\nSchema: ${input.schemaHint}\n错误: ${error instanceof Error ? error.message : 'unknown'}\n原始输出:\n${input.raw.slice(0, 12000)}`
    const repairedRaw = await openAiChatJson(input.baseUrl, input.model, input.apiKey, [{ type: 'text', text: repairPrompt }], {
      signal: input.signal,
      stream: input.stream,
      onDelta: undefined,
      responseFormat: input.responseFormat,
    })
    try {
      return { parsed: input.schema.parse(parsePossiblyWrappedJson(repairedRaw)), raw: repairedRaw }
    } catch (repairError) {
      if (isProviderRefusal(repairedRaw)) {
        throw new AiProviderRefusalError({ raw: input.raw, repairedRaw })
      }
      throw new AiJsonOutputError({
        message: `AI output could not be parsed after repair: ${repairError instanceof Error ? repairError.message : 'unknown'}`,
        raw: input.raw,
        repairedRaw,
        schemaHint: input.schemaHint,
      })
    }
  }
}

function jsonSchemaResponseFormat<T>(name: string, schema: ZodType<T>): JsonSchemaResponseFormat {
  const jsonSchema = Object.fromEntries(
    Object.entries(z.toJSONSchema(schema)).filter(([key]) => key !== '$schema'),
  )
  return { name, schema: jsonSchema }
}

function isProviderRefusal(raw: string): boolean {
  const normalized = raw.toLowerCase().replaceAll('’', "'")
  return [
    /\bi (?:cannot|can't|won't) (?:assist|help|comply)\b/,
    /\bi (?:must|have to) (?:decline|refuse)\b/,
    /\b(?:request|content) (?:violates|conflicts with) (?:the )?(?:policy|guideline)/,
    /(?:无法|不能|不便)(?:协助|帮助|处理|满足).*(?:请求|内容)/,
  ].some((pattern) => pattern.test(normalized))
}

function sanitizeProviderResponseBody(raw: string): string {
  const trimmed = raw.trim().slice(0, 1200)
  if (!trimmed) return '[empty response body]'
  return trimmed
    .replace(/data:image\/[^;\s"']+;base64,[a-z0-9+/=]+/gi, '[redacted image payload]')
    .replace(/\bsk-[a-z0-9._-]+\b/gi, '[redacted secret]')
    .replace(/bearer\s+[a-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key["'=:\s]+)[^,"'\s}]+/gi, '$1[redacted]')
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

const MAX_PREVIOUS_DIALOGUE_LINES = 8

function previousPageDialogueLines(detail: ProjectDetail, page: Page): string {
  const previousPage = detail.pages.find((item) => item.index === page.index - 1)
  if (!previousPage) {
    return ''
  }
  return detail.dialogues
    .filter((dialogue) => dialogue.pageId === previousPage.id)
    .slice(-MAX_PREVIOUS_DIALOGUE_LINES)
    .map((dialogue) => `${dialogue.characterName || '旁白'}：${dialogue.text}`)
    .join('\n')
}

async function assetToImagePart(asset: Asset): Promise<ChatContentPart> {
  const data = await readFile(assetAbsolutePath(asset))
  const compatibleImage = await aiCompatibleImage(data, asset.mimeType)
  return {
    type: 'image_url',
    image_url: {
      url: `data:${compatibleImage.mimeType};base64,${compatibleImage.data.toString('base64')}`,
    },
  }
}

async function aiCompatibleImage(data: Buffer, mimeType: string): Promise<{ data: Buffer; mimeType: string }> {
  if (mimeType !== 'image/svg+xml') return { data, mimeType }
  return { data: await sharp(data).png().toBuffer(), mimeType: 'image/png' }
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
