import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { exportProjectBackup } from '../server/exporter'

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
    db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

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
  })
})
