import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { StudioDatabase } from './database'
import { getAppDataDir, getFontsDir } from './paths'

export interface FontRoutesContext {
  db: StudioDatabase
}

const FONT_FORMATS: Record<string, string> = {
  '.ttf': 'truetype',
  '.otf': 'opentype',
  '.woff': 'woff',
  '.woff2': 'woff2',
}

/** CJK font files run large; anything beyond this is almost certainly not a font. */
const MAX_FONT_BYTES = 64 * 1024 * 1024

/** Global dialogue-font library routes; files live under <appData>/fonts and serve via /assets/fonts/. */
export function registerFontRoutes(server: FastifyInstance, context: FontRoutesContext): void {
  const { db } = context

  server.get('/api/fonts', async () => ({ fonts: db.listFonts() }))

  server.post('/api/fonts', async (request) => {
    const file = await request.file()
    if (!file) {
      throw new Error('Font file is required')
    }
    const extension = path.extname(file.filename || '').toLowerCase()
    const format = FONT_FORMATS[extension]
    if (!format) {
      throw new Error('Unsupported font format. Use TTF, OTF, WOFF, or WOFF2.')
    }
    const buffer = await file.toBuffer()
    if (!buffer.length) {
      throw new Error('Font file is empty')
    }
    if (buffer.length > MAX_FONT_BYTES) {
      throw new Error('Font file is too large (64MB max)')
    }
    const familyName = familyNameFromFileName(file.filename, extension)
    // Server-generated file names keep user input out of filesystem paths.
    const fileName = `${randomUUID()}${extension}`
    await writeFile(path.join(getFontsDir(), fileName), buffer)
    return db.createFont({
      familyName,
      fileName,
      relativePath: path.join('fonts', fileName),
      format,
    })
  })

  server.delete('/api/fonts/:id', async (request) => {
    const { id } = request.params as { id: string }
    const relativePath = db.deleteFont(id)
    try {
      await unlink(path.join(getAppDataDir(), relativePath))
    } catch {
      // A missing file only means the library entry was already stale.
    }
    return { ok: true }
  })
}

/** Derives a CSS-safe family name from the uploaded file name. */
function familyNameFromFileName(fileName: string, extension: string): string {
  const base = path.basename(fileName || '', extension)
  const cleaned = base.replace(/["',\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned || 'Custom Font'
}
