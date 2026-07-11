import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { registerFontRoutes } from '../server/fonts'

let dataDir = ''

function createDb(): StudioDatabase {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-fonts-test-'))
  process.env.PTM_DATA_DIR = dataDir
  return new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
}

async function createServer(db: StudioDatabase): Promise<FastifyInstance> {
  const server = fastify()
  await server.register(multipart)
  registerFontRoutes(server, { db })
  return server
}

function multipartUpload(fileName: string, contentType: string, body: string) {
  const boundary = 'ptmfonttestboundary'
  const payload = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: ${contentType}`,
    '',
    body,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

afterEach(() => {
  delete process.env.PTM_DATA_DIR
})

describe('font library routes', () => {
  it('uploads a font, lists it, and serves a stable asset URL', async () => {
    const db = createDb()
    const server = await createServer(db)

    const upload = multipartUpload('My Manga Font.woff2', 'font/woff2', 'fake-font-bytes')
    const response = await server.inject({ method: 'POST', url: '/api/fonts', ...upload })
    const body = response.json() as { id: string; familyName: string; url: string; format: string; fileName: string }

    expect(response.statusCode).toBe(200)
    expect(body.familyName).toBe('My Manga Font')
    expect(body.format).toBe('woff2')
    expect(body.url).toMatch(/^\/assets\/fonts\/.+\.woff2$/)
    // Server-generated file name, not the user-provided one.
    expect(body.fileName).not.toContain('My Manga Font')
    expect(existsSync(path.join(dataDir, 'fonts', body.fileName))).toBe(true)

    const listed = await server.inject({ method: 'GET', url: '/api/fonts' })
    expect((listed.json() as { fonts: unknown[] }).fonts).toHaveLength(1)
  })

  it('rejects non-font extensions and empty files', async () => {
    const db = createDb()
    const server = await createServer(db)

    const wrongType = await server.inject({
      method: 'POST',
      url: '/api/fonts',
      ...multipartUpload('not-a-font.txt', 'text/plain', 'hello'),
    })
    expect(wrongType.statusCode).not.toBe(200)

    const empty = await server.inject({
      method: 'POST',
      url: '/api/fonts',
      ...multipartUpload('empty.ttf', 'font/ttf', ''),
    })
    expect(empty.statusCode).not.toBe(200)
    expect(db.listFonts()).toHaveLength(0)
  })

  it('deletes a font row and its file', async () => {
    const db = createDb()
    const server = await createServer(db)
    const upload = await server.inject({
      method: 'POST',
      url: '/api/fonts',
      ...multipartUpload('Removable.ttf', 'font/ttf', 'bytes'),
    })
    const font = upload.json() as { id: string; fileName: string }
    const absolutePath = path.join(dataDir, 'fonts', font.fileName)
    expect(existsSync(absolutePath)).toBe(true)

    const deleted = await server.inject({ method: 'DELETE', url: `/api/fonts/${font.id}` })
    expect(deleted.statusCode).toBe(200)
    expect(db.listFonts()).toHaveLength(0)
    expect(existsSync(absolutePath)).toBe(false)

    const repeat = await server.inject({ method: 'DELETE', url: `/api/fonts/${font.id}` })
    expect(repeat.statusCode).not.toBe(200)
  })
})
