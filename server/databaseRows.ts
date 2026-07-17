import type {
  Asset,
  BubbleStyle,
  Character,
  Dialogue,
  FontAsset,
  ModelCapability,
  Page,
  PanelBox,
  Project,
  ProjectMode,
  ProjectSource,
  ProviderProfile,
  StoryBible,
} from '../src/shared/types'
import { assetUrlFromRelativePath } from './paths'

export interface Row {
  [key: string]: unknown
}

export function projectFromRow(row: Row): Project {
  const storyBible = typeof row.storyBibleJson === 'string' ? (JSON.parse(row.storyBibleJson) as StoryBible) : undefined
  return {
    id: String(row.id),
    title: String(row.title),
    mode: row.mode as ProjectMode,
    source: row.source as ProjectSource,
    readingDirection: row.readingDirection === 'ltr' ? 'ltr' : 'rtl',
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    storyBible,
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
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}
