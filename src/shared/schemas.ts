import { z } from 'zod'

export const bubbleStyleSchema = z.enum(['speech', 'soft', 'thought', 'caption'])

export const characterSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).default(''),
  voice: z.string().max(1200).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#141414'),
  fontFamily: z.string().optional(),
  bubbleStyle: bubbleStyleSchema.default('speech'),
})

export const pageBeatSchema = z.object({
  pageIndex: z.number().int().min(0),
  summary: z.string().min(1).max(1200),
  intent: z.string().min(1).max(1200),
})

export const storyBibleSchema = z.object({
  synopsis: z.string().min(1).max(5000),
  tone: z.string().min(1).max(1000),
  characters: z.array(characterSchema).min(1).max(20),
  pageBeats: z.array(pageBeatSchema).min(1).max(300),
  userBrief: z.string().max(5000).optional(),
  r18Enabled: z.boolean().default(false),
})

export const dialogueSchema = z.object({
  id: z.string().optional(),
  pageId: z.string().optional(),
  characterId: z.string().optional(),
  characterName: z.string().optional(),
  text: z.string().min(1).max(500),
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  scale: z.number().min(0.5).max(2.5).default(1),
  rotation: z.number().min(-45).max(45).default(0),
  bubbleStyle: bubbleStyleSchema.default('speech'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#141414'),
  locked: z.boolean().default(false),
})

export const dialogueListSchema = z.object({
  dialogues: z.array(dialogueSchema).max(12),
})

export const createProjectSchema = z.object({
  title: z.string().min(1).max(120).default('Untitled Manga'),
  mode: z.enum(['story', 'translation']).default('story'),
  source: z.enum(['pixiv', 'local', 'mixed', 'sample']).default('local'),
})

export const pixivImportSchema = z.object({
  projectId: z.string().optional(),
  url: z.string().min(1).max(300),
  title: z.string().max(120).optional(),
  r18Enabled: z.boolean().default(false),
})

export const secretUpdateSchema = z.object({
  apiBaseUrl: z.string().trim().max(300).optional(),
  modelName: z.string().trim().max(120).optional(),
  apiKey: z.string().trim().max(300).optional(),
  pixivCookie: z.string().trim().max(4000).optional(),
})

export const analyzeStorySchema = z.object({
  projectId: z.string(),
  userBrief: z.string().max(5000).default(''),
  r18Enabled: z.boolean().default(false),
})

export const generatePageSchema = z.object({
  pageId: z.string(),
  mode: z.enum(['story', 'translation']).default('story'),
  textDensity: z.number().min(0).max(1).default(0.65),
})

export const exportZipSchema = z.object({
  projectId: z.string(),
  pages: z
    .array(
      z.object({
        pageId: z.string(),
        dataUrl: z.string().startsWith('data:image/png;base64,'),
      }),
    )
    .min(1),
})

export const exportProjectBackupSchema = z.object({
  projectId: z.string(),
})

export const providerProfileCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().min(1).max(300),
  defaultModel: z.string().trim().max(160).default(''),
  isLocal: z.boolean().default(false),
  apiKey: z.string().trim().max(2000).optional(),
})

export const providerProfilePatchSchema = providerProfileCreateSchema.partial()

export const providerIdParamSchema = z.object({
  id: z.string().min(1).max(120),
})

export const discoverModelsSchema = z.object({
  path: z.string().trim().min(1).max(120).default('/models'),
})

export const providerTestSchema = z.object({
  modelId: z.string().trim().min(1).max(160).optional(),
  tests: z.array(z.enum(['text', 'vision', 'json', 'streaming'])).min(1).max(4).default(['text']),
  imageDataUrl: z.string().startsWith('data:image/').max(2_000_000).optional(),
})

export const modelCapabilityPatchSchema = z
  .object({
    supportsVision: z.boolean().optional(),
    supportsStreaming: z.boolean().optional(),
    supportsJsonSchema: z.boolean().optional(),
    allowsAdultInput: z.boolean().optional(),
    allowsAdultGeneration: z.boolean().optional(),
    contextWindow: z.number().int().min(1).max(10_000_000).nullable().optional(),
    notes: z.string().max(2000).optional(),
    source: z.enum(['discovered', 'tested', 'user']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const modelCapabilityIdParamSchema = z.object({
  id: z.string().min(1).max(120),
})
