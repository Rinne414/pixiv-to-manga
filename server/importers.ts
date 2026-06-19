import { createWriteStream, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { MultipartFile } from '@fastify/multipart'
import JSZip from 'jszip'
import { z } from 'zod'
import { getAppDataDir, projectAssetDir } from './paths'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import { assertPixivImageUrl, extractPixivArtworkId } from '../src/shared/pixiv'
import { characterSchema, dialogueSchema, storyBibleSchema } from '../src/shared/schemas'
import type { Character, ProjectDetail, ProjectMode, ProjectSource, StoryBible } from '../src/shared/types'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const PROJECT_BACKUP_FORMAT = 'pixiv-to-manga-project-backup'

const backupProjectDataSchema = z.object({
  project: z.object({
    title: z.string().min(1).max(120),
    mode: z.enum(['story', 'translation']),
    source: z.enum(['pixiv', 'local', 'mixed', 'sample']),
    storyBible: storyBibleSchema.optional(),
  }),
  pages: z.array(
    z.object({
      id: z.string(),
      index: z.number().int().min(0),
      originalAssetId: z.string(),
      previewAssetId: z.string().optional(),
      status: z.enum(['ready', 'analyzing', 'generating', 'complete', 'error']),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
  assets: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['original', 'preview', 'render', 'export']),
      backupPath: z.string().min(1),
      mimeType: z.string().min(1),
      sourceUrl: z.string().optional(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
  characters: z.array(characterSchema.required({ id: true })),
  dialogues: z.array(dialogueSchema.required({ id: true, pageId: true })),
})

const backupManifestSchema = z.object({
  format: z.literal(PROJECT_BACKUP_FORMAT),
  version: z.literal(1),
})

type BackupCharacter = z.infer<typeof characterSchema> & { id: string }
type BackupStoryBible = z.infer<typeof storyBibleSchema>

export async function importLocalImages(
  db: StudioDatabase,
  files: AsyncIterable<MultipartFile>,
  input: { projectId?: string; title?: string },
): Promise<ProjectDetail> {
  const project = input.projectId
    ? db.getProject(input.projectId)
    : db.createProject({ title: input.title || 'Local Manga Project', mode: 'story', source: 'local' })

  const existingPages = db.listPages(project.id)
  let index = existingPages.length

  for await (const file of files) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new Error(`Unsupported file type: ${file.mimetype}`)
    }

    const extension = safeExtension(file.filename, file.mimetype)
    const relativePath = path.join('projects', project.id, 'originals', `${String(index + 1).padStart(3, '0')}-${randomUUID()}${extension}`)
    const absolutePath = path.join(getAppDataDir(), relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })

    let bytes = 0
    file.file.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_IMAGE_BYTES) {
        file.file.destroy(new Error('File too large'))
      }
    })
    await pipeline(file.file, createWriteStream(absolutePath))

    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath,
      mimeType: file.mimetype,
    })
    db.createPage({ projectId: project.id, index, originalAssetId: asset.id })
    index += 1
  }

  return db.getProjectDetail(project.id)
}

export async function importPixivArtwork(
  db: StudioDatabase,
  secrets: SecretStore,
  input: { projectId?: string; url: string; title?: string; r18Enabled: boolean },
): Promise<ProjectDetail> {
  const artworkId = extractPixivArtworkId(input.url)
  if (!artworkId) {
    throw new Error('Invalid Pixiv artwork URL')
  }

  const project = input.projectId
    ? db.getProject(input.projectId)
    : db.createProject({ title: input.title || `Pixiv Artwork ${artworkId}`, mode: 'story', source: 'pixiv' })
  const cookie = input.r18Enabled ? await secrets.getPixivCookie() : null

  const pages = await fetchPixivPages(artworkId, cookie)
  const existingPages = db.listPages(project.id)
  let index = existingPages.length

  for (const page of pages) {
    const imageUrl = assertPixivImageUrl(page)
    const response = await fetch(imageUrl, {
      headers: pixivHeaders(cookie, `https://www.pixiv.net/artworks/${artworkId}`),
    })

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Pixiv page: HTTP ${response.status}`)
    }

    const mimeType = response.headers.get('content-type') || 'image/jpeg'
    if (!ALLOWED_MIME.has(mimeType.split(';')[0])) {
      throw new Error(`Pixiv returned unsupported image type: ${mimeType}`)
    }

    const extension = mimeType.includes('png') ? '.png' : mimeType.includes('webp') ? '.webp' : '.jpg'
    const relativePath = path.join('projects', project.id, 'originals', `pixiv-${artworkId}-${String(index + 1).padStart(3, '0')}${extension}`)
    const absolutePath = path.join(getAppDataDir(), relativePath)
    projectAssetDir(project.id, 'originals')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Pixiv image is too large')
    }
    await writeFile(absolutePath, buffer)

    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath,
      mimeType: mimeType.split(';')[0],
      sourceUrl: imageUrl.toString(),
    })
    db.createPage({ projectId: project.id, index, originalAssetId: asset.id })
    index += 1
  }

  return db.getProjectDetail(project.id)
}

export async function importProjectBackup(db: StudioDatabase, file: MultipartFile): Promise<ProjectDetail> {
  if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype)) {
    throw new Error(`Unsupported backup file type: ${file.mimetype}`)
  }

  const zip = await JSZip.loadAsync(await file.toBuffer())
  const manifestEntry = zip.file('manifest.json')
  const projectDataEntry = zip.file('project-data.json')
  if (!manifestEntry || !projectDataEntry) {
    throw new Error('Backup ZIP is missing manifest.json or project-data.json')
  }

  backupManifestSchema.parse(JSON.parse(await manifestEntry.async('string')))
  const data = backupProjectDataSchema.parse(JSON.parse(await projectDataEntry.async('string')))

  const restoredProject = db.createProject({
    title: data.project.title,
    mode: data.project.mode as ProjectMode,
    source: data.project.source as ProjectSource,
  })
  const assetIdMap = new Map<string, string>()
  const pageIdMap = new Map<string, string>()
  const characterIdMap = new Map<string, string>()

  for (const character of data.characters) {
    characterIdMap.set(character.id, randomUUID())
  }

  if (data.project.storyBible) {
    db.saveStoryBible(restoredProject.id, restoreStoryBible(data.project.storyBible, restoredProject.id, characterIdMap))
  } else {
    for (const character of data.characters) {
      db.createCharacter(restoredProject.id, restoreCharacter(character, restoredProject.id, characterIdMap))
    }
  }

  for (const asset of data.assets) {
    const backupPath = normalizeBackupPath(asset.backupPath)
    const entry = zip.file(backupPath)
    if (!entry) {
      throw new Error(`Backup asset missing: ${backupPath}`)
    }
    const extension = path.extname(backupPath) || safeExtension(`asset.${extensionForMime(asset.mimeType)}`, asset.mimeType)
    const assetFolder = asset.kind === 'original' ? 'originals' : asset.kind
    const relativePath = path.join(
      'projects',
      restoredProject.id,
      assetFolder,
      `${String(assetIdMap.size + 1).padStart(3, '0')}-${randomUUID()}${extension}`,
    )
    const absolutePath = path.join(getAppDataDir(), relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, await entry.async('nodebuffer'))
    const restoredAsset = db.createAsset({
      projectId: restoredProject.id,
      kind: asset.kind,
      relativePath,
      mimeType: asset.mimeType,
      sourceUrl: asset.sourceUrl,
      width: asset.width,
      height: asset.height,
    })
    assetIdMap.set(asset.id, restoredAsset.id)
  }

  for (const page of data.pages) {
    const originalAssetId = assetIdMap.get(page.originalAssetId)
    if (!originalAssetId) {
      throw new Error(`Backup page references missing asset: ${page.originalAssetId}`)
    }
    const restoredPage = db.createPage({
      projectId: restoredProject.id,
      index: page.index,
      originalAssetId,
      previewAssetId: page.previewAssetId ? assetIdMap.get(page.previewAssetId) : undefined,
      width: page.width,
      height: page.height,
    })
    pageIdMap.set(page.id, restoredPage.id)
    db.updatePageStatus(restoredPage.id, page.status)
  }

  for (const dialogue of data.dialogues) {
    const pageId = pageIdMap.get(dialogue.pageId)
    if (!pageId) {
      throw new Error(`Backup dialogue references missing page: ${dialogue.pageId}`)
    }
    db.createDialogue(pageId, {
      ...dialogue,
      id: randomUUID(),
      pageId,
      characterId: dialogue.characterId ? characterIdMap.get(dialogue.characterId) : undefined,
    })
  }

  return db.getProjectDetail(restoredProject.id)
}

async function fetchPixivPages(artworkId: string, cookie: string | null): Promise<string[]> {
  const response = await fetch(`https://www.pixiv.net/ajax/illust/${artworkId}/pages?lang=en`, {
    headers: pixivHeaders(cookie, `https://www.pixiv.net/artworks/${artworkId}`),
  })

  if (!response.ok) {
    throw new Error(`Pixiv API failed: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    error?: boolean
    message?: string
    body?: Array<{ urls?: { original?: string; regular?: string } }>
  }

  if (payload.error) {
    throw new Error(payload.message || 'Pixiv API returned an error')
  }

  const urls =
    payload.body
      ?.map((page) => page.urls?.original || page.urls?.regular)
      .filter((url): url is string => Boolean(url)) || []

  if (urls.length === 0) {
    throw new Error('Pixiv artwork has no downloadable pages')
  }

  return urls
}

function pixivHeaders(cookie: string | null, referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: referer,
    'User-Agent': 'Mozilla/5.0 Pixiv-to-Manga-Studio/0.1',
    Accept: 'application/json,image/avif,image/webp,image/png,image/jpeg,*/*',
  }
  if (cookie) {
    headers.Cookie = cookie
  }
  return headers
}

function safeExtension(filename: string, mimeType: string): string {
  const ext = path.extname(filename).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) {
    return ext
  }
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.jpg'
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/svg+xml') return 'svg'
  return 'jpg'
}

function normalizeBackupPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.includes('../') || normalized === '..') {
    throw new Error('Backup asset path is unsafe')
  }
  return normalized
}

function restoreStoryBible(storyBible: BackupStoryBible, projectId: string, characterIdMap: Map<string, string>): StoryBible {
  return {
    ...storyBible,
    characters: storyBible.characters.map((character) =>
      restoreCharacter({ ...character, id: character.id || randomUUID() }, projectId, characterIdMap),
    ),
  }
}

function restoreCharacter(character: BackupCharacter, projectId: string, characterIdMap: Map<string, string>): Character {
  const backupId = character.id || randomUUID()
  const id = characterIdMap.get(backupId) || randomUUID()
  characterIdMap.set(backupId, id)
  return {
    ...character,
    id,
    projectId,
  }
}
