import { randomUUID } from 'node:crypto'
import type { Dialogue, ModelCapability, Page, ProjectDetail, ProviderProfile, StoryBible } from '../src/shared/types'
import { dialogueListSchema, storyBibleSchema } from '../src/shared/schemas'
import type { z } from 'zod'
import { parsePossiblyWrappedJson } from '../src/shared/jsonRepair'
import { resolveDialogueCollisions } from '../src/shared/layout'
import { evaluateRouteSafety, type RouteSafetyResult, type SafetyClass } from '../src/shared/routeSafety'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'

type ParsedStoryBible = z.infer<typeof storyBibleSchema>

export interface AiContext {
  secrets: SecretStore
  db?: StudioDatabase
}

export async function analyzeStoryWithAi(
  context: AiContext,
  detail: ProjectDetail,
  input: { userBrief: string; r18Enabled: boolean },
): Promise<{ storyBible: StoryBible; raw: string; usedMock: boolean }> {
  const status = await context.secrets.status()
  const apiKey = await context.secrets.getApiKey()

  if (!apiKey || !status.apiBaseUrl || !status.modelName) {
    const mock = mockStoryBible(detail, input)
    return { storyBible: mock, raw: JSON.stringify(mock, null, 2), usedMock: true }
  }

  ensureAiGenerationAllowed(context, {
    apiBaseUrl: status.apiBaseUrl,
    modelName: status.modelName,
    r18Enabled: input.r18Enabled,
    imagePresent: false,
    safetyClass: 'safe',
  })

  const prompt = `你是漫画编剧。请基于项目页数和用户补充，创建中文 Story Bible。必须只返回 JSON，字段为 synopsis, tone, characters, pageBeats, userBrief, r18Enabled。characters 每项包含 name, description, voice, color, bubbleStyle。pageBeats 每项包含 pageIndex, summary, intent。项目标题：${detail.project.title}。页数：${detail.pages.length}。用户补充：${input.userBrief || '无'}。R18: ${input.r18Enabled ? 'true' : 'false'}。`
  const raw = await openAiChatJson(status.apiBaseUrl, status.modelName, apiKey, [{ type: 'text', text: prompt }])
  const parsed = storyBibleSchema.parse(parsePossiblyWrappedJson(raw))
  return { storyBible: normalizeStoryBible(parsed, detail.project.id), raw, usedMock: false }
}

export async function generateDialoguesWithAi(
  context: AiContext,
  detail: ProjectDetail,
  page: Page,
  input: { mode: 'story' | 'translation'; textDensity: number },
): Promise<{ dialogues: Dialogue[]; raw: string; usedMock: boolean }> {
  const status = await context.secrets.status()
  const apiKey = await context.secrets.getApiKey()
  const storyBible = detail.project.storyBible || mockStoryBible(detail, { userBrief: '', r18Enabled: false })

  if (!apiKey || !status.apiBaseUrl || !status.modelName) {
    const dialogues = resolveDialogueCollisions(mockDialogues(page, storyBible, input.mode))
    return { dialogues, raw: JSON.stringify({ dialogues }, null, 2), usedMock: true }
  }

  ensureAiGenerationAllowed(context, {
    apiBaseUrl: status.apiBaseUrl,
    modelName: status.modelName,
    r18Enabled: storyBible.r18Enabled,
    imagePresent: false,
    safetyClass: 'safe',
  })

  const beat = storyBible.pageBeats.find((item) => item.pageIndex === page.index)
  const characters = storyBible.characters.map((character) => `${character.name}: ${character.voice}`).join('\n')
  const prompt = `你是漫画对白创作者。模式：${input.mode === 'translation' ? '视觉翻译，不原创大剧情' : '原创故事对白'}。请为第 ${page.index + 1} 页生成中文漫画对白。故事：${storyBible.synopsis}。本页剧情：${beat?.summary || '未指定'}。角色声音：${characters}。文本密度：${input.textDensity}。必须只返回 JSON：{"dialogues":[{"text":"...","characterName":"...","x":0.5,"y":0.5,"scale":1,"rotation":0,"bubbleStyle":"speech","color":"#141414","locked":false}]}. x/y 是 0-1 画面坐标，避免挡脸和重叠。`
  const raw = await openAiChatJson(status.apiBaseUrl, status.modelName, apiKey, [{ type: 'text', text: prompt }])
  const parsed = dialogueListSchema.parse(parsePossiblyWrappedJson(raw))
  const dialogues = resolveDialogueCollisions(
    parsed.dialogues.map((dialogue) => ({
      ...dialogue,
      id: dialogue.id || randomUUID(),
      pageId: page.id,
      color: dialogue.color || '#141414',
      raw,
    })),
  )
  return { dialogues, raw, usedMock: false }
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

function findMatchingProvider(providers: ProviderProfile[], apiBaseUrl: string, modelName: string): ProviderProfile | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(apiBaseUrl)
  const normalizedModel = normalizeModelId(modelName)
  return providers.find(
    (provider) => normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl && normalizeModelId(provider.defaultModel) === normalizedModel,
  )
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `https://${trimmed}`
}

function normalizeModelId(modelName: string): string {
  return modelName.trim().toLowerCase()
}

async function openAiChatJson(
  baseUrl: string,
  model: string,
  apiKey: string,
  content: Array<{ type: 'text'; text: string }>,
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      temperature: 0.9,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const contentText = payload.choices?.[0]?.message?.content
  if (!contentText) {
    throw new Error('AI returned an empty response')
  }
  return contentText
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
