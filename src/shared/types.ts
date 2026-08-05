export type ProjectMode = 'story' | 'translation'
export type ProjectSource = 'pixiv' | 'local' | 'mixed' | 'sample'
export type ConnectionMode = 'local' | 'external'
export type PageStatus = 'ready' | 'analyzing' | 'generating' | 'complete' | 'error'
export type BubbleStyle = 'speech' | 'soft' | 'thought' | 'caption' | 'sfx' | 'shout' | 'whisper'
export type TextDirection = 'vertical' | 'horizontal'
/** Page-turn direction for readers/exports; 'rtl' is the manga convention. */
export type ReadingDirection = 'ltr' | 'rtl'
export type CleanupStrokeMode = 'mosaic' | 'paint'

export interface LetteringDefaults {
  fontFamily?: string
  scale: number
  color: string
  sfxStrokeColor: string
  sfxStrokeWidth: number
}

export interface CleanupPoint {
  x: number
  y: number
}

export interface CleanupStroke {
  mode: CleanupStrokeMode
  points: CleanupPoint[]
  size: number
  intensity: number
  color: string
}

/**
 * Sanitized description of the AI route generations will actually use, served
 * by GET /api/ai/active-target (server/ai.ts describeAiTarget). Key material
 * never leaves the backend; hasApiKey only reports that one exists.
 */
export interface ActiveEngineInfo {
  apiBaseUrl: string
  modelName: string
  isLocal: boolean
  hasApiKey: boolean
  source: 'global' | 'provider'
  providerId?: string
  providerName?: string
}

export interface Project {
  id: string
  title: string
  mode: ProjectMode
  source: ProjectSource
  readingDirection: ReadingDirection
  createdAt: string
  updatedAt: string
  storyBible?: StoryBible
  letteringDefaults?: LetteringDefaults
}

/** Manga panel frame in page-normalized coordinates; array order = reading order. */
export interface PanelBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Page {
  id: string
  projectId: string
  index: number
  originalAssetId: string
  previewAssetId?: string
  status: PageStatus
  width: number
  height: number
  panels?: PanelBox[]
  cleanupStrokes?: CleanupStroke[]
}

export interface Asset {
  id: string
  projectId: string
  kind: 'original' | 'preview' | 'render' | 'export'
  url: string
  mimeType: string
  sourceUrl?: string
  width: number
  height: number
}

export interface Character {
  id: string
  projectId: string
  name: string
  description: string
  voice: string
  color: string
  fontFamily?: string
  bubbleStyle: BubbleStyle
}

export interface PageBeat {
  pageIndex: number
  summary: string
  intent: string
}

export interface StoryBible {
  synopsis: string
  tone: string
  characters: Character[]
  pageBeats: PageBeat[]
  userBrief?: string
  /** Reusable style rules injected into every story/dialogue generation prompt. */
  stylePrompt?: string
  r18Enabled: boolean
}

export interface Dialogue {
  id: string
  pageId: string
  characterId?: string
  characterName?: string
  text: string
  x: number
  y: number
  scale: number
  rotation: number
  bubbleStyle: BubbleStyle
  color: string
  locked: boolean
  /** Vertical CJK columns by default; horizontal for latin-heavy or stylistic lines. */
  textDirection?: TextDirection
  /** Per-line font override; falls back to the character font, then the default stack. */
  fontFamily?: string
  /** Speech-tail tip in page-normalized coordinates; unset renders the legacy fixed tail. */
  tailX?: number
  tailY?: number
  raw?: string
}

/** A user-uploaded dialogue font, stored globally and served from the asset root. */
export interface FontAsset {
  id: string
  familyName: string
  fileName: string
  url: string
  format: string
  createdAt: string
}

export interface JobEvent {
  jobId: string
  type: 'queued' | 'progress' | 'complete' | 'error' | 'cancelled'
  progress: number
  message: string
  payload?: unknown
  error?: string
}

export interface ProjectDetail {
  project: Project
  pages: Page[]
  assets: Asset[]
  characters: Character[]
  dialogues: Dialogue[]
}

export interface SecretStatus {
  keychainAvailable: boolean
  apiBaseUrl: string
  modelName: string
  hasApiKey: boolean
  hasPixivCookie: boolean
}

export type PixivBatchTaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
export type PixivBatchItemStatus = 'queued' | 'downloading' | 'complete' | 'skipped' | 'failed'

export interface PixivBatchPreviewPage {
  artworkId: string
  pageIndex: number
  sourceUrl: string
  fileName: string
  selected: boolean
}

export interface PixivBatchPreviewArtwork {
  artworkId: string
  artworkUrl: string
  pageCount: number
  pages: PixivBatchPreviewPage[]
  error?: string
}

export interface PixivBatchPreviewResponse {
  artworks: PixivBatchPreviewArtwork[]
  totalPages: number
  selectedPages: number
  maxImages: number
  requestDelayMs: number
}

export interface PixivBatchTaskItem {
  id: string
  taskId: string
  artworkId: string
  pageIndex: number
  sourceUrl: string
  fileName: string
  status: PixivBatchItemStatus
  attempts: number
  error?: string
  assetId?: string
  pageId?: string
  createdAt: string
  updatedAt: string
}

export interface PixivBatchTask {
  id: string
  projectId: string
  title: string
  r18Enabled: boolean
  usePixivSession: boolean
  status: PixivBatchTaskStatus
  totalItems: number
  completedItems: number
  failedItems: number
  requestDelayMs: number
  retryAt?: string
  pauseReason?: string
  error?: string
  createdAt: string
  updatedAt: string
  items: PixivBatchTaskItem[]
}

export interface PixivSessionTestResult {
  status: 'not_configured' | 'authenticated' | 'unauthenticated' | 'rate_limited' | 'error'
  message: string
  httpStatus?: number
  canImportPublic: boolean
  canImportPrivate: boolean
}

export interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  defaultModel: string
  isLocal: boolean
  createdAt: string
  updatedAt: string
  hasApiKey: boolean
}

export type ModelCapabilityFlag =
  | 'supportsVision'
  | 'supportsImageGeneration'
  | 'supportsStreaming'
  | 'supportsJsonSchema'
  | 'allowsAdultInput'
  | 'allowsAdultGeneration'

export type ModelCapabilityEvidence = 'unknown' | 'provider' | 'tested' | 'local-policy' | 'user'

export type ModelCapabilitySources = Record<ModelCapabilityFlag, ModelCapabilityEvidence>

export interface ModelCapability {
  id: string
  providerId: string
  modelId: string
  supportsVision: boolean
  supportsImageGeneration: boolean
  supportsStreaming: boolean
  supportsJsonSchema: boolean
  allowsAdultInput: boolean
  allowsAdultGeneration: boolean
  contextWindow?: number
  notes: string
  source: 'discovered' | 'tested' | 'user'
  capabilitySources: ModelCapabilitySources
  createdAt: string
  updatedAt: string
}

export type GenerationMetadataFormat = 'a1111' | 'comfyui' | 'novelai' | 'plain' | 'unknown'

export interface GenerationMetadata {
  format: GenerationMetadataFormat
  positivePrompt?: string
  negativePrompt?: string
  tags: string[]
  raw: Record<string, string>
  settings: Record<string, string | number | boolean>
  sourceFields: string[]
  workflowSummary?: string[]
}

export interface ContinuationReference {
  id: string
  fileName: string
  mimeType: string
  width: number
  height: number
  source: 'upload' | 'pixiv'
  previewDataUrl: string
  sourceUrl?: string
  tags: string[]
  metadata: GenerationMetadata
}

/** Reference payload sent back to /api/continuation/generate — image bytes stay client-side. */
export type ContinuationReferenceInput = Omit<ContinuationReference, 'previewDataUrl'>

export interface ContinuationImage {
  id: string
  mimeType: string
  dataUrl?: string
  url?: string
  prompt: string
  usedMock: boolean
}

export interface ContinuationGenerateResponse {
  images: ContinuationImage[]
  expandedPrompt: string
  usedMock: boolean
  routeTrace: string[]
}
