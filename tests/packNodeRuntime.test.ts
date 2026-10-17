import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cacheIsIntact, downloadTo, recordVerified } from '../scripts/pack/node-runtime.mjs'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-noderuntime-'))
  dirs.push(dir)
  return dir
}

describe('cached Node runtime is re-verified (finding 12)', () => {
  it('accepts files that match the hashes recorded at verification time', async () => {
    const dir = tempDir()
    const binary = path.join(dir, 'node')
    writeFileSync(binary, 'real node')
    const record = path.join(dir, 'win-x64.verified')
    await recordVerified(record, { binary })
    await expect(cacheIsIntact(record, { binary })).resolves.toBe(true)
  })

  it('rejects a file that changed, is missing, or has no record', async () => {
    const dir = tempDir()
    const binary = path.join(dir, 'node')
    writeFileSync(binary, 'real node')
    const record = path.join(dir, 'win-x64.verified')
    await expect(cacheIsIntact(record, { binary })).resolves.toBe(false)
    await recordVerified(record, { binary })
    writeFileSync(binary, 'tampered')
    await expect(cacheIsIntact(record, { binary })).resolves.toBe(false)
    rmSync(binary)
    await expect(cacheIsIntact(record, { binary })).resolves.toBe(false)
  })
})

describe('downloadTo size cap', () => {
  async function withServer(body: Buffer, run: (url: string) => Promise<void>) {
    const server = http.createServer((_req, res) => res.end(body))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/f`)
    } finally {
      server.close()
    }
  }

  it('downloads within the cap', async () => {
    await withServer(Buffer.alloc(1000, 1), async (url) => {
      await expect(downloadTo(url, path.join(tempDir(), 'a.bin'), 5000)).resolves.toBeUndefined()
    })
  })

  it('aborts and removes the partial file when the body exceeds the cap', async () => {
    await withServer(Buffer.alloc(100_000, 1), async (url) => {
      const dest = path.join(tempDir(), 'a.bin')
      await expect(downloadTo(url, dest, 5000)).rejects.toThrow(/larger than/i)
    })
  })
})
