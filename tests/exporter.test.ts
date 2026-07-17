import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { PDFDocument, ReadingDirection } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import type { MultipartFile } from '@fastify/multipart'
import { StudioDatabase } from '../server/database'
import { buildComicInfoXml, exportProjectBackup, exportRenderedPdf, exportRenderedZip } from '../server/exporter'
import { importProjectBackup } from '../server/importers'

const PNG_1X1_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function createDb(): StudioDatabase {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-export-test-'))
  process.env.PTM_DATA_DIR = dir
  return new StudioDatabase(path.join(dir, 'studio.sqlite'), false)
}

describe('project backup export', () => {
  afterEach(() => {
    delete process.env.PTM_DATA_DIR
  })

  it('writes manifest, database slice, and project assets into a portable zip', async () => {
    const db = createDb()
    const project = db.createProject({ title: 'Backup Project', mode: 'story', source: 'local' })
    const assetRelativePath = path.join('projects', project.id, 'originals', 'page-001.svg')
    const assetAbsolutePath = path.join(process.env.PTM_DATA_DIR!, assetRelativePath)
    mkdirSync(path.dirname(assetAbsolutePath), { recursive: true })
    writeFileSync(assetAbsolutePath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath: assetRelativePath,
      mimeType: 'image/svg+xml',
      width: 1200,
      height: 1600,
    })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })
    db.saveStoryBible(project.id, {
      synopsis: 'Backup story',
      tone: 'quiet',
      userBrief: 'restore this',
      r18Enabled: false,
      characters: [
        {
          id: 'character-1',
          projectId: project.id,
          name: '夏海',
          description: 'Lead',
          voice: 'Clear',
          color: '#c9282d',
          bubbleStyle: 'speech',
        },
      ],
      pageBeats: [{ pageIndex: 0, summary: 'Opening', intent: 'Start' }],
    })
    db.replaceDialogues(page.id, [
      {
        id: 'dialogue-1',
        pageId: page.id,
        characterId: 'character-1',
        characterName: '夏海',
        text: '备份对白',
        x: 0.5,
        y: 0.25,
        scale: 1,
        rotation: 0,
        bubbleStyle: 'speech',
        color: '#c9282d',
        locked: false,
      },
    ])

    const result = await exportProjectBackup(db, { projectId: project.id })
    const zip = await JSZip.loadAsync(await readFile(result.absolutePath))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { format: string; pageCount: number }
    const projectData = JSON.parse(await zip.file('project-data.json')!.async('string')) as {
      project: { id: string }
      assets: Array<{ id: string; backupPath: string }>
    }

    expect(manifest.format).toBe('pixiv-to-manga-project-backup')
    expect(manifest.pageCount).toBe(1)
    expect(projectData.project.id).toBe(project.id)
    expect(projectData.assets[0].id).toBe(asset.id)
    expect(zip.file(projectData.assets[0].backupPath)).toBeTruthy()

    const restored = await importProjectBackup(db, {
      mimetype: 'application/zip',
      toBuffer: async () => readFile(result.absolutePath),
    } as MultipartFile)
    expect(restored.project.id).not.toBe(project.id)
    expect(restored.project.title).toBe(project.title)
    expect(restored.pages).toHaveLength(1)
    expect(restored.assets).toHaveLength(1)
    expect(restored.characters[0].name).toBe('夏海')
    expect(restored.dialogues[0].text).toBe('备份对白')
    expect(restored.dialogues[0].pageId).toBe(restored.pages[0].id)
  })

  it('round-trips the project reading direction through backup and restore', async () => {
    const db = createDb()
    const project = db.createProject({ title: 'Direction Project', mode: 'story', source: 'local' })
    db.updateProjectReadingDirection(project.id, 'ltr')

    const result = await exportProjectBackup(db, { projectId: project.id })
    const restored = await importProjectBackup(db, {
      mimetype: 'application/zip',
      toBuffer: async () => readFile(result.absolutePath),
    } as MultipartFile)
    expect(restored.project.readingDirection).toBe('ltr')
  })
})

describe('rendered archive export', () => {
  afterEach(() => {
    delete process.env.PTM_DATA_DIR
  })

  it('CBZ export writes pages plus ComicInfo.xml carrying the RTL reading direction', async () => {
    const db = createDb()
    const project = db.createProject({ title: 'CBZ & Friends', mode: 'story', source: 'local' })

    const result = await exportRenderedZip(db, {
      projectId: project.id,
      format: 'cbz',
      pages: [{ pageId: 'page-1', dataUrl: PNG_1X1_DATA_URL }],
    })

    expect(result.fileName.endsWith('.cbz')).toBe(true)
    const archive = await JSZip.loadAsync(await readFile(result.absolutePath))
    const comicInfo = await archive.file('ComicInfo.xml')!.async('string')
    expect(comicInfo).toContain('<Manga>YesAndRightToLeft</Manga>')
    expect(comicInfo).toContain('<Title>CBZ &amp; Friends</Title>')
    expect(comicInfo).toContain('<PageCount>1</PageCount>')
    expect(archive.file('page_001.png')).toBeTruthy()
    expect(archive.file('manifest.json')).toBeNull()
  })

  it('LTR projects mark CBZ as Manga=No while zip format keeps the app manifest', async () => {
    const db = createDb()
    const project = db.createProject({ title: 'LTR Comic', mode: 'story', source: 'local' })
    db.updateProjectReadingDirection(project.id, 'ltr')

    const cbz = await exportRenderedZip(db, {
      projectId: project.id,
      format: 'cbz',
      pages: [{ pageId: 'page-1', dataUrl: PNG_1X1_DATA_URL }],
    })
    const cbzArchive = await JSZip.loadAsync(await readFile(cbz.absolutePath))
    expect(await cbzArchive.file('ComicInfo.xml')!.async('string')).toContain('<Manga>No</Manga>')

    const zip = await exportRenderedZip(db, {
      projectId: project.id,
      pages: [{ pageId: 'page-1', dataUrl: PNG_1X1_DATA_URL }],
    })
    expect(zip.fileName.endsWith('.zip')).toBe(true)
    const zipArchive = await JSZip.loadAsync(await readFile(zip.absolutePath))
    expect(zipArchive.file('ComicInfo.xml')).toBeNull()
    const manifest = JSON.parse(await zipArchive.file('manifest.json')!.async('string')) as {
      project: { readingDirection: string }
      pages: Array<{ file: string }>
    }
    expect(manifest.project.readingDirection).toBe('ltr')
    expect(manifest.pages[0].file).toBe('page_001.png')
  })
})

describe('rendered PDF export', () => {
  afterEach(() => {
    delete process.env.PTM_DATA_DIR
  })

  it('embeds pages and honors the project reading direction in viewer preferences', async () => {
    const db = createDb()
    const project = db.createProject({ title: 'PDF 專案', mode: 'story', source: 'local' })

    const rtl = await exportRenderedPdf(db, { projectId: project.id, pages: [{ pageId: 'p1', dataUrl: PNG_1X1_DATA_URL }] })
    expect(rtl.fileName.endsWith('.pdf')).toBe(true)
    const rtlDoc = await PDFDocument.load(await readFile(rtl.absolutePath))
    expect(rtlDoc.getPageCount()).toBe(1)
    expect(rtlDoc.getTitle()).toBe('PDF 專案')
    expect(rtlDoc.catalog.getOrCreateViewerPreferences().getReadingDirection()).toBe(ReadingDirection.R2L)

    db.updateProjectReadingDirection(project.id, 'ltr')
    const ltr = await exportRenderedPdf(db, { projectId: project.id, pages: [{ pageId: 'p1', dataUrl: PNG_1X1_DATA_URL }] })
    const ltrDoc = await PDFDocument.load(await readFile(ltr.absolutePath))
    expect(ltrDoc.catalog.getOrCreateViewerPreferences().getReadingDirection()).toBe(ReadingDirection.L2R)
  })
})

describe('buildComicInfoXml', () => {
  it('escapes XML-reserved characters in titles', () => {
    const xml = buildComicInfoXml({ title: `<A & "B" 'C'>`, pageCount: 3, readingDirection: 'rtl' })
    expect(xml).toContain('<Title>&lt;A &amp; &quot;B&quot; &apos;C&apos;&gt;</Title>')
    expect(xml).toContain('<PageCount>3</PageCount>')
    expect(xml).toContain('<Manga>YesAndRightToLeft</Manga>')
  })
})
