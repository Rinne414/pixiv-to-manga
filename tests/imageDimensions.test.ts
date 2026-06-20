import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MultipartFile } from '@fastify/multipart'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { detectImageDimensions, importLocalImages } from '../server/importers'

afterEach(() => {
  delete process.env.PTM_DATA_DIR
})

describe('detectImageDimensions', () => {
  it('reads PNG dimensions from IHDR', () => {
    const buffer = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buffer, 0)
    buffer.writeUInt32BE(800, 16)
    buffer.writeUInt32BE(1200, 20)

    expect(detectImageDimensions(buffer, 'image/png')).toEqual({ width: 800, height: 1200 })
  })

  it('reads JPEG dimensions from SOF markers', () => {
    const buffer = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x08, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03,
      0xff, 0xd9,
    ])

    expect(detectImageDimensions(buffer, 'image/jpeg')).toEqual({ width: 800, height: 600 })
  })

  it('reads WebP VP8X canvas dimensions', () => {
    const buffer = Buffer.alloc(30)
    buffer.write('RIFF', 0, 'ascii')
    buffer.write('WEBP', 8, 'ascii')
    buffer.write('VP8X', 12, 'ascii')
    writeUInt24LE(buffer, 24, 1023)
    writeUInt24LE(buffer, 27, 767)

    expect(detectImageDimensions(buffer, 'image/webp')).toEqual({ width: 1024, height: 768 })
  })

  it('reads SVG dimensions from viewBox when width and height are omitted', () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 960"></svg>')

    expect(detectImageDimensions(buffer, 'image/svg+xml')).toEqual({ width: 640, height: 960 })
  })

  it('stores detected dimensions when importing local images', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-image-import-test-'))
    process.env.PTM_DATA_DIR = dataDir
    const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"></svg>')

    const detail = await importLocalImages(db, localFiles([{ filename: 'page.svg', mimetype: 'image/svg+xml', buffer }]), {
      title: 'Sized Project',
    })

    expect(detail.assets[0]).toMatchObject({ width: 640, height: 960 })
    expect(detail.pages[0]).toMatchObject({ width: 640, height: 960 })
  })
})

function writeUInt24LE(buffer: Buffer, offset: number, value: number): void {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >> 8) & 0xff
  buffer[offset + 2] = (value >> 16) & 0xff
}

async function* localFiles(files: Array<{ filename: string; mimetype: string; buffer: Buffer }>): AsyncIterable<MultipartFile> {
  for (const file of files) {
    yield {
      filename: file.filename,
      mimetype: file.mimetype,
      toBuffer: async () => file.buffer,
    } as MultipartFile
  }
}
