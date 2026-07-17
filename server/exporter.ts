import { createWriteStream, mkdirSync } from 'node:fs'
import { copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { getAppDataDir, getExportsDir } from './paths'
import type { ReadingDirection } from '../src/shared/types'
import type { StudioDatabase } from './database'

export type RenderedExportFormat = 'zip' | 'cbz'

export async function exportRenderedZip(
  db: StudioDatabase,
  input: { projectId: string; format?: RenderedExportFormat; pages: Array<{ pageId: string; dataUrl: string }> },
): Promise<{ fileName: string; absolutePath: string; url: string }> {
  const project = db.getProject(input.projectId)
  const format = input.format || 'zip'
  const exportId = `${safeExportName(project.title)}-${Date.now()}`
  const exportsDir = getExportsDir()
  const exportDir = path.join(exportsDir, exportId)
  mkdirSync(exportDir, { recursive: true })

  for (let index = 0; index < input.pages.length; index += 1) {
    const encoded = input.pages[index].dataUrl.replace(/^data:image\/png;base64,/, '')
    await writeFile(path.join(exportDir, pageFileName(index)), Buffer.from(encoded, 'base64'))
  }

  if (format === 'cbz') {
    // CBZ readers (Komga, Kavita, Mihon, CDisplayEx, ...) read title and page-turn
    // direction from ComicInfo.xml; the app-internal manifest stays zip-only.
    await writeFile(
      path.join(exportDir, 'ComicInfo.xml'),
      buildComicInfoXml({ title: project.title, pageCount: input.pages.length, readingDirection: project.readingDirection }),
      'utf8',
    )
  } else {
    const manifest = {
      project,
      exportedAt: new Date().toISOString(),
      pages: input.pages.map((page, index) => ({ pageId: page.pageId, file: pageFileName(index) })),
    }
    await writeFile(path.join(exportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  const archiveName = `${exportId}.${format}`
  const archivePath = path.join(exportsDir, archiveName)
  await zipDirectory(exportDir, archivePath)
  return { fileName: archiveName, absolutePath: archivePath, url: `/assets/exports/${archiveName}` }
}

/** ComicRack-schema ComicInfo.xml; the de-facto metadata standard for CBZ archives. */
export function buildComicInfoXml(input: { title: string; pageCount: number; readingDirection: ReadingDirection }): string {
  const manga = input.readingDirection === 'rtl' ? 'YesAndRightToLeft' : 'No'
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <Title>${escapeXml(input.title)}</Title>`,
    `  <Series>${escapeXml(input.title)}</Series>`,
    `  <PageCount>${input.pageCount}</PageCount>`,
    '  <LanguageISO>zh</LanguageISO>',
    `  <Manga>${manga}</Manga>`,
    '</ComicInfo>',
    '',
  ].join('\n')
}

function pageFileName(index: number): string {
  return `page_${String(index + 1).padStart(3, '0')}.png`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function exportProjectBackup(
  db: StudioDatabase,
  input: { projectId: string },
): Promise<{ fileName: string; absolutePath: string; url: string }> {
  const detail = db.getProjectDetail(input.projectId)
  const exportId = `${safeExportName(detail.project.title)}-backup-${Date.now()}`
  const exportsDir = getExportsDir()
  const backupDir = path.join(exportsDir, exportId)
  const assetsDir = path.join(backupDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })

  const assets = []
  for (const asset of detail.assets) {
    const sourcePath = path.join(getAppDataDir(), asset.url.replace(/^\/assets\//, ''))
    const assetName = `${asset.id}${path.extname(sourcePath) || extensionForMime(asset.mimeType)}`
    const backupRelativePath = path.join('assets', assetName).replaceAll(path.sep, '/')
    await copyFile(sourcePath, path.join(backupDir, backupRelativePath))
    assets.push({ ...asset, backupPath: backupRelativePath })
  }

  const manifest = {
    format: 'pixiv-to-manga-project-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    projectId: detail.project.id,
    title: detail.project.title,
    assetCount: assets.length,
    pageCount: detail.pages.length,
    dialogueCount: detail.dialogues.length,
  }
  const databaseSlice = {
    project: detail.project,
    pages: detail.pages,
    assets,
    characters: detail.characters,
    dialogues: detail.dialogues,
  }

  await writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await writeFile(path.join(backupDir, 'project-data.json'), JSON.stringify(databaseSlice, null, 2), 'utf8')

  const zipName = `${exportId}.zip`
  const zipPath = path.join(exportsDir, zipName)
  await zipDirectory(backupDir, zipPath)
  return { fileName: zipName, absolutePath: zipPath, url: `/assets/exports/${zipName}` }
}

function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(sourceDir, false)
    archive.finalize().catch(reject)
  })
}

function safeExportName(value: string): string {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('png')) return '.png'
  if (mimeType.includes('webp')) return '.webp'
  if (mimeType.includes('svg')) return '.svg'
  return '.jpg'
}
