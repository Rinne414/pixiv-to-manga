import { createWriteStream, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { MultipartFile } from '@fastify/multipart'
import { appDataDir, projectAssetDir } from './paths'
import type { StudioDatabase } from './database'
import type { SecretStore } from './secrets'
import { assertPixivImageUrl, extractPixivArtworkId } from '../src/shared/pixiv'
import type { ProjectDetail } from '../src/shared/types'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

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
    const absolutePath = path.join(appDataDir, relativePath)
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
    const absolutePath = path.join(appDataDir, relativePath)
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
