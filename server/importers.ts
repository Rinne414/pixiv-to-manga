import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MultipartFile } from '@fastify/multipart'
import JSZip from 'jszip'
import { z } from 'zod'
import { getAppDataDir, projectAssetDir } from './paths'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import { assertPixivImageUrl, extractPixivArtworkId } from '../src/shared/pixiv'
import { characterSchema, cleanupStrokesSchema, dialogueSchema, letteringDefaultsSchema, storyBibleSchema } from '../src/shared/schemas'
import type { Character, ProjectDetail, ProjectMode, ProjectSource, StoryBible } from '../src/shared/types'

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024
export const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const PROJECT_BACKUP_FORMAT = 'pixiv-to-manga-project-backup'

export interface DownloadedPixivImage {
  artworkId: string
  pageIndex: number
  buffer: Buffer
  mimeType: string
  sourceUrl: string
  fileName: string
}

const backupProjectDataSchema = z.object({
  project: z.object({
    title: z.string().min(1).max(120),
    mode: z.enum(['story', 'translation']),
    source: z.enum(['pixiv', 'local', 'mixed', 'sample']),
    // Absent in pre-v0.4 backups; restore falls back to the DB default ('rtl').
    readingDirection: z.enum(['ltr', 'rtl']).optional(),
    letteringDefaults: letteringDefaultsSchema.optional(),
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
      cleanupStrokes: cleanupStrokesSchema.optional(),
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
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      throw new Error(`Unsupported file type: ${file.mimetype}`)
    }

    const extension = safeExtension(file.filename, file.mimetype)
    const relativePath = path.join('projects', project.id, 'originals', `${String(index + 1).padStart(3, '0')}-${randomUUID()}${extension}`)
    const absolutePath = path.join(getAppDataDir(), relativePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })

    const buffer = await file.toBuffer()
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('File too large')
    }
    await writeFile(absolutePath, buffer)
    const dimensions = detectImageDimensions(buffer, file.mimetype)

    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath,
      mimeType: file.mimetype,
      width: dimensions?.width,
      height: dimensions?.height,
    })
    db.createPage({ projectId: project.id, index, originalAssetId: asset.id, width: asset.width, height: asset.height })
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

  const existingPages = db.listPages(project.id)
  let index = existingPages.length

  // Pages are written to disk one at a time so a large artwork never holds more than a
  // single page buffer in memory.
  await forEachPixivArtworkImage(secrets, input, async (image) => {
    const extension = path.extname(image.fileName) || `.${extensionForMime(image.mimeType)}`
    const relativePath = path.join('projects', project.id, 'originals', `pixiv-${artworkId}-${String(index + 1).padStart(3, '0')}${extension}`)
    const absolutePath = path.join(getAppDataDir(), relativePath)
    projectAssetDir(project.id, 'originals')
    await writeFile(absolutePath, image.buffer)
    const dimensions = detectImageDimensions(image.buffer, image.mimeType)

    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath,
      mimeType: image.mimeType,
      sourceUrl: image.sourceUrl,
      width: dimensions?.width,
      height: dimensions?.height,
    })
    db.createPage({ projectId: project.id, index, originalAssetId: asset.id, width: asset.width, height: asset.height })
    index += 1
  })

  return db.getProjectDetail(project.id)
}

export async function forEachPixivArtworkImage(
  secrets: SecretStore,
  input: { url: string; r18Enabled: boolean; maxPages?: number },
  handler: (image: DownloadedPixivImage) => Promise<void>,
): Promise<void> {
  const artworkId = extractPixivArtworkId(input.url)
  if (!artworkId) {
    throw new Error('Invalid Pixiv artwork URL')
  }

  const cookie = input.r18Enabled ? await secrets.getPixivCookie() : null
  const pages = await fetchPixivPages(artworkId, cookie)
  const mockBaseUrl = getLoopbackPixivMockBaseUrl()

  for (const [pageIndex, page] of pages.slice(0, input.maxPages ?? pages.length).entries()) {
    const imageUrl = assertPixivDownloadUrl(page, mockBaseUrl)
    const response = await fetch(imageUrl, {
      headers: pixivHeaders(cookie, `https://www.pixiv.net/artworks/${artworkId}`),
    })

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Pixiv page: HTTP ${response.status}`)
    }

    const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0]
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      throw new Error(`Pixiv returned unsupported image type: ${mimeType}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Pixiv image is too large')
    }

    await handler({
      artworkId,
      pageIndex,
      buffer,
      mimeType,
      sourceUrl: imageUrl.toString(),
      fileName: `pixiv-${artworkId}-${String(pageIndex + 1).padStart(3, '0')}.${extensionForMime(mimeType)}`,
    })
  }
}

// Buffers every requested page in memory — only safe for callers that cap maxPages
// (the continuation reference flow); the import path streams via forEachPixivArtworkImage.
export async function downloadPixivArtworkImages(
  secrets: SecretStore,
  input: { url: string; r18Enabled: boolean; maxPages: number },
): Promise<DownloadedPixivImage[]> {
  const images: DownloadedPixivImage[] = []
  await forEachPixivArtworkImage(secrets, input, async (image) => {
    images.push(image)
  })
  return images
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
  if (data.project.readingDirection) {
    db.updateProjectSettings(restoredProject.id, { readingDirection: data.project.readingDirection })
  }
  if (data.project.letteringDefaults) {
    db.updateProjectSettings(restoredProject.id, { letteringDefaults: data.project.letteringDefaults })
  }
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
    if (page.cleanupStrokes) {
      db.updatePageCleanup(restoredPage.id, page.cleanupStrokes)
    }
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
  const mockBaseUrl = getLoopbackPixivMockBaseUrl()
  const pagesUrl = mockBaseUrl
    ? new URL(`/ajax/illust/${artworkId}/pages?lang=en`, mockBaseUrl)
    : new URL(`https://www.pixiv.net/ajax/illust/${artworkId}/pages?lang=en`)

  const response = await fetch(pagesUrl, {
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

function assertPixivDownloadUrl(rawUrl: string, mockBaseUrl: URL | null): URL {
  const url = new URL(rawUrl)
  if (mockBaseUrl && url.origin === mockBaseUrl.origin) {
    return url
  }
  return assertPixivImageUrl(rawUrl)
}

function getLoopbackPixivMockBaseUrl(): URL | null {
  const raw = process.env.PTM_PIXIV_MOCK_BASE_URL?.trim()
  if (!raw) {
    return null
  }

  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopbackHost(url.hostname)) {
    throw new Error('PTM_PIXIV_MOCK_BASE_URL must point to a loopback HTTP(S) server')
  }
  return url
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
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

export function detectImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase()
  if (normalizedMime === 'image/png') {
    return detectPngDimensions(buffer)
  }
  if (normalizedMime === 'image/jpeg') {
    return detectJpegDimensions(buffer)
  }
  if (normalizedMime === 'image/webp') {
    return detectWebpDimensions(buffer)
  }
  if (normalizedMime === 'image/svg+xml') {
    return detectSvgDimensions(buffer)
  }
  return null
}

function detectPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null
  }
  return validDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20))
}

function detectJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      return null
    }
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return validDimensions(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5))
    }
    offset += 2 + segmentLength
  }
  return null
}

function detectWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null
  }

  const chunkType = buffer.toString('ascii', 12, 16)
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return validDimensions(1 + readUInt24LE(buffer, 24), 1 + readUInt24LE(buffer, 27))
  }
  if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return validDimensions(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
  }
  if (chunkType === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return validDimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff)
  }
  return null
}

function detectSvgDimensions(buffer: Buffer): { width: number; height: number } | null {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 20_000))
  const svgMatch = text.match(/<svg\b[^>]*>/i)
  if (!svgMatch) return null
  const tag = svgMatch[0]
  const width = parseSvgNumber(tag.match(/\bwidth=["']([0-9.]+)/i)?.[1])
  const height = parseSvgNumber(tag.match(/\bheight=["']([0-9.]+)/i)?.[1])
  if (width && height) {
    return validDimensions(width, height)
  }
  const viewBox = tag.match(/\bviewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i)
  return viewBox ? validDimensions(parseSvgNumber(viewBox[1]), parseSvgNumber(viewBox[2])) : null
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16)
}

function parseSvgNumber(value?: string): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function validDimensions(width: number | null, height: number | null): { width: number; height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) {
    return null
  }
  return { width: Math.round(width), height: Math.round(height) }
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
