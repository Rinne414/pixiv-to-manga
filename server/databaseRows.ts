import type {
  Asset,
  BubbleStyle,
  Character,
  Dialogue,
  FontAsset,
  ModelCapability,
  ModelCapabilityEvidence,
  ModelCapabilityFlag,
  ModelCapabilitySources,
  Page,
  PanelBox,
  Project,
  ProjectMode,
  ProjectSource,
  ProviderProfile,
  PixivBatchItemStatus,
  PixivBatchTask,
  PixivBatchTaskItem,
  PixivBatchTaskStatus,
  StoryBible,
} from '../src/shared/types'
import { assetUrlFromRelativePath } from './paths'
import { letteringDefaultsSchema, cleanupStrokesSchema } from '../src/shared/schemas'

export interface Row {
  [key: string]: unknown
}

export function pixivBatchTaskItemFromRow(row: Row): PixivBatchTaskItem {
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    artworkId: String(row.artworkId),
    pageIndex: Number(row.pageIndex),
    sourceUrl: String(row.sourceUrl),
    fileName: String(row.fileName),
    status: row.status as PixivBatchItemStatus,
    attempts: Number(row.attempts),
    error: typeof row.error === 'string' ? row.error : undefined,
    assetId: typeof row.assetId === 'string' ? row.assetId : undefined,
    pageId: typeof row.pageId === 'string' ? row.pageId : undefined,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export function pixivBatchTaskFromRow(row: Row, items: PixivBatchTaskItem[]): PixivBatchTask {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    title: String(row.title),
    r18Enabled: Number(row.r18Enabled) === 1,
    usePixivSession: Number(row.usePixivSession) === 1,
    status: row.status as PixivBatchTaskStatus,
    totalItems: Number(row.totalItems),
    completedItems: Number(row.completedItems),
    failedItems: Number(row.failedItems),
    requestDelayMs: Number(row.requestDelayMs),
    retryAt: typeof row.retryAt === 'string' ? row.retryAt : undefined,
    pauseReason: typeof row.pauseReason === 'string' ? row.pauseReason : undefined,
    error: typeof row.error === 'string' ? row.error : undefined,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    items,
  }
}

export function projectFromRow(row: Row): Project {
  const storyBible = typeof row.storyBibleJson === 'string' ? (JSON.parse(row.storyBibleJson) as StoryBible) : undefined
  const letteringDefaults = typeof row.letteringJson === 'string' ? letteringDefaultsSchema.parse(JSON.parse(row.letteringJson)) : letteringDefaultsSchema.parse({})
  return {
    id: String(row.id),
    title: String(row.title),
    mode: row.mode as ProjectMode,
    source: row.source as ProjectSource,
    readingDirection: row.readingDirection === 'ltr' ? 'ltr' : 'rtl',
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    storyBible,
    letteringDefaults,
  }
}

export function assetFromRow(row: Row): Asset {
  const filePath = String(row.filePath)
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    kind: row.kind as Asset['kind'],
    url: assetUrlFromRelativePath(filePath),
    mimeType: String(row.mimeType),
    sourceUrl: typeof row.sourceUrl === 'string' ? row.sourceUrl : undefined,
    width: Number(row.width),
    height: Number(row.height),
  }
}

export function pageFromRow(row: Row): Page {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    index: Number(row.pageIndex),
    originalAssetId: String(row.originalAssetId),
    previewAssetId: typeof row.previewAssetId === 'string' ? row.previewAssetId : undefined,
    status: row.status as Page['status'],
    width: Number(row.width),
    height: Number(row.height),
    panels: typeof row.panelsJson === 'string' ? (JSON.parse(row.panelsJson) as PanelBox[]) : undefined,
    cleanupStrokes: typeof row.cleanupJson === 'string' ? cleanupStrokesSchema.parse(JSON.parse(row.cleanupJson)) : undefined,
  }
}

export function characterFromRow(row: Row): Character {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    name: String(row.name),
    description: String(row.description),
    voice: String(row.voice),
    color: String(row.color),
    fontFamily: typeof row.fontFamily === 'string' ? row.fontFamily : undefined,
    bubbleStyle: row.bubbleStyle as BubbleStyle,
  }
}

export function dialogueFromRow(row: Row): Dialogue {
  return {
    id: String(row.id),
    pageId: String(row.pageId),
    characterId: typeof row.characterId === 'string' ? row.characterId : undefined,
    characterName: typeof row.characterName === 'string' ? row.characterName : undefined,
    text: String(row.text),
    x: Number(row.x),
    y: Number(row.y),
    scale: Number(row.scale),
    rotation: Number(row.rotation),
    bubbleStyle: row.bubbleStyle as BubbleStyle,
    color: String(row.color),
    locked: Number(row.locked) === 1,
    textDirection: row.textDirection === 'horizontal' ? 'horizontal' : row.textDirection === 'vertical' ? 'vertical' : undefined,
    fontFamily: typeof row.fontFamily === 'string' ? row.fontFamily : undefined,
    tailX: typeof row.tailX === 'number' ? Number(row.tailX) : undefined,
    tailY: typeof row.tailY === 'number' ? Number(row.tailY) : undefined,
    raw: typeof row.rawJson === 'string' ? row.rawJson : undefined,
  }
}

export function fontFromRow(row: Row): FontAsset {
  return {
    id: String(row.id),
    familyName: String(row.familyName),
    fileName: String(row.fileName),
    url: assetUrlFromRelativePath(String(row.filePath)),
    format: String(row.format),
    createdAt: String(row.createdAt),
  }
}

export function providerFromRow(row: Row, hasApiKey: boolean): ProviderProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.baseUrl),
    defaultModel: String(row.defaultModel),
    isLocal: Number(row.isLocal) === 1,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    hasApiKey,
  }
}

export function modelCapabilityFromRow(row: Row): ModelCapability {
  return {
    id: String(row.id),
    providerId: String(row.providerId),
    modelId: String(row.modelId),
    supportsVision: Number(row.supportsVision) === 1,
    supportsImageGeneration: Number(row.supportsImageGeneration) === 1,
    supportsStreaming: Number(row.supportsStreaming) === 1,
    supportsJsonSchema: Number(row.supportsJsonSchema) === 1,
    allowsAdultInput: Number(row.allowsAdultInput) === 1,
    allowsAdultGeneration: Number(row.allowsAdultGeneration) === 1,
    contextWindow: typeof row.contextWindow === 'number' ? Number(row.contextWindow) : undefined,
    notes: String(row.notes),
    source: row.source as ModelCapability['source'],
    capabilitySources: capabilitySourcesFromRow(row),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

const capabilityFlags: ModelCapabilityFlag[] = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
]

const capabilityEvidenceValues = new Set<ModelCapabilityEvidence>([
  'unknown',
  'provider',
  'tested',
  'local-policy',
  'user',
])

function capabilitySourcesFromRow(row: Row): ModelCapabilitySources {
  const parsed = parseCapabilitySources(row.capabilitySourcesJson)
  const legacySource: ModelCapabilityEvidence = row.source === 'tested' ? 'tested' : 'unknown'
  return Object.fromEntries(
    capabilityFlags.map((flag) => {
      const explicitSource = parsed[flag]
      if (explicitSource) return [flag, explicitSource]
      if (Number(row[flag]) !== 1) return [flag, 'unknown']
      if (flag === 'allowsAdultInput' || flag === 'allowsAdultGeneration') return [flag, 'user']
      return [flag, legacySource]
    }),
  ) as ModelCapabilitySources
}

function parseCapabilitySources(value: unknown): Partial<ModelCapabilitySources> {
  if (typeof value !== 'string' || !value.trim()) return {}
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Stored model capability sources must be a JSON object')
  }
  const record = parsed as Record<string, unknown>
  return Object.fromEntries(
    capabilityFlags.flatMap((flag) => {
      const source = record[flag]
      return capabilityEvidenceValues.has(source as ModelCapabilityEvidence) ? [[flag, source]] : []
    }),
  ) as Partial<ModelCapabilitySources>
}
