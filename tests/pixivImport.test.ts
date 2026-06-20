import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioDatabase } from '../server/database'
import { importPixivArtwork } from '../server/importers'
import { SecretStore } from '../server/secrets'

function createDb(): { db: StudioDatabase; secrets: SecretStore; dataDir: string } {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-pixiv-import-test-'))
  process.env.PTM_DATA_DIR = dataDir
  process.env.PTM_TEST_MEMORY_KEYTAR = '1'
  const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
  return { db, secrets: new SecretStore(db), dataDir }
}

describe('importPixivArtwork', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.PTM_DATA_DIR
    delete process.env.PTM_TEST_MEMORY_KEYTAR
    delete process.env.PTM_PIXIV_MOCK_BASE_URL
  })

  it('downloads Pixiv pages with the saved R-18 cookie and stores real image dimensions', async () => {
    const { db, secrets } = createDb()
    await secrets.save({ pixivCookie: 'PHPSESSID=test-cookie' })
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const requestUrl = String(url)
      const headers = init?.headers as Record<string, string> | undefined
      if (requestUrl.includes('/ajax/illust/123456789/pages')) {
        expect(headers?.Cookie).toBe('PHPSESSID=test-cookie')
        return new Response(
          JSON.stringify({
            error: false,
            body: [{ urls: { original: 'https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123456789_p0.png' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      expect(requestUrl).toBe('https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123456789_p0.png')
      expect(headers?.Cookie).toBe('PHPSESSID=test-cookie')
      expect(headers?.Referer).toBe('https://www.pixiv.net/artworks/123456789')
      return new Response(pngWithDimensions(320, 480), { status: 200, headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const detail = await importPixivArtwork(db, secrets, {
      url: 'https://www.pixiv.net/artworks/123456789',
      r18Enabled: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(detail.project.source).toBe('pixiv')
    expect(detail.assets[0]).toMatchObject({
      sourceUrl: 'https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123456789_p0.png',
      width: 320,
      height: 480,
    })
    expect(detail.pages[0]).toMatchObject({ width: 320, height: 480 })
  })

  it('allows loopback Pixiv mock imports without allowing arbitrary external image proxying', async () => {
    const { db, secrets } = createDb()
    process.env.PTM_PIXIV_MOCK_BASE_URL = 'http://127.0.0.1:5199'
    await secrets.save({ pixivCookie: 'PHPSESSID=mock-cookie' })
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const requestUrl = String(url)
      const headers = init?.headers as Record<string, string> | undefined
      if (requestUrl === 'http://127.0.0.1:5199/ajax/illust/123456789/pages?lang=en') {
        expect(headers?.Cookie).toBe('PHPSESSID=mock-cookie')
        return new Response(
          JSON.stringify({
            error: false,
            body: [{ urls: { original: 'http://127.0.0.1:5199/pixiv-assets/123456789_p0.png' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      expect(requestUrl).toBe('http://127.0.0.1:5199/pixiv-assets/123456789_p0.png')
      expect(headers?.Cookie).toBe('PHPSESSID=mock-cookie')
      return new Response(pngWithDimensions(640, 960), { status: 200, headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const detail = await importPixivArtwork(db, secrets, {
      url: '123456789',
      r18Enabled: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(detail.assets[0]).toMatchObject({
      sourceUrl: 'http://127.0.0.1:5199/pixiv-assets/123456789_p0.png',
      width: 640,
      height: 960,
    })
  })

  it('rejects non-loopback Pixiv mock bases', async () => {
    const { db, secrets } = createDb()
    process.env.PTM_PIXIV_MOCK_BASE_URL = 'https://example.com'

    await expect(
      importPixivArtwork(db, secrets, {
        url: '123456789',
        r18Enabled: false,
      }),
    ).rejects.toThrow(/loopback/)
  })
})

function pngWithDimensions(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buffer, 0)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}
