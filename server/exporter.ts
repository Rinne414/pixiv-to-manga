import { createWriteStream, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { exportsDir } from './paths'
import type { StudioDatabase } from './database'

export async function exportRenderedZip(
  db: StudioDatabase,
  input: { projectId: string; pages: Array<{ pageId: string; dataUrl: string }> },
): Promise<{ fileName: string; absolutePath: string; url: string }> {
  const project = db.getProject(input.projectId)
  const exportId = `${project.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}-${Date.now()}`
  const exportDir = path.join(exportsDir, exportId)
  mkdirSync(exportDir, { recursive: true })

  const manifest = {
    project,
    exportedAt: new Date().toISOString(),
    pages: input.pages.map((page, index) => ({ pageId: page.pageId, file: `page_${String(index + 1).padStart(3, '0')}.png` })),
  }
  await writeFile(path.join(exportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  for (let index = 0; index < input.pages.length; index += 1) {
    const encoded = input.pages[index].dataUrl.replace(/^data:image\/png;base64,/, '')
    await writeFile(path.join(exportDir, `page_${String(index + 1).padStart(3, '0')}.png`), Buffer.from(encoded, 'base64'))
  }

  const zipName = `${exportId}.zip`
  const zipPath = path.join(exportsDir, zipName)
  await zipDirectory(exportDir, zipPath)
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
