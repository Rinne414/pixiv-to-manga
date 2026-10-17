import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isAllowedDownloadUrl, isReleaseDownloadUrl } from './urls'

const MAX_REDIRECTS = 5

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DownloadOptions {
  fetchImpl: FetchLike
  maxBytes: number
  onProgress?: (received: number, total: number | null) => void
  signal?: AbortSignal
}

/** GETs a URL, following redirects by hand so every hop stays on an allowed GitHub host over HTTPS. */
async function fetchAllowed(url: string, options: DownloadOptions): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const permitted = hop === 0 ? isReleaseDownloadUrl(current) : isAllowedDownloadUrl(current)
    if (!permitted) throw new Error(`Refusing to download from ${redactUrl(current)}`)
    const response = await options.fetchImpl(current, {
      redirect: 'manual',
      signal: options.signal,
      headers: { 'User-Agent': 'pixiv-to-manga-updater', Accept: 'application/octet-stream' },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Download redirected without a location')
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
    return response
  }
  throw new Error('Download redirected too many times')
}

function redactUrl(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return 'an invalid URL'
  }
}

export async function downloadToFile(url: string, destination: string, options: DownloadOptions): Promise<void> {
  const response = await fetchAllowed(url, options)
  if (!response.body) throw new Error('Download returned no data')
  const declared = Number(response.headers.get('content-length'))
  const total = Number.isFinite(declared) && declared > 0 ? declared : null
  if (total !== null && total > options.maxBytes) throw new Error('The update download is larger than allowed')

  let received = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > options.maxBytes) {
        callback(new Error('The update download is larger than allowed'))
        return
      }
      options.onProgress?.(received, total)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), counter, createWriteStream(destination))
}

export async function downloadText(url: string, options: DownloadOptions): Promise<string> {
  const response = await fetchAllowed(url, options)
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    if (received > options.maxBytes) {
      await reader.cancel()
      throw new Error('The checksum file is larger than allowed')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
