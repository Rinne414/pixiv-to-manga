import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { expectedSha256, parseDigest, parseSha256Sums, verifyFileSha256 } from '../server/update/verify'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempFile(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-verify-'))
  dirs.push(dir)
  const file = path.join(dir, 'a.bin')
  writeFileSync(file, content)
  return file
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex')

describe('checksum sources', () => {
  it('parses the API digest field', () => {
    expect(parseDigest('sha256:' + 'AB'.repeat(32))).toBe('ab'.repeat(32))
    expect(parseDigest('sha1:abc')).toBeNull()
    expect(parseDigest('sha256:short')).toBeNull()
    expect(parseDigest(null)).toBeNull()
  })

  it('parses SHA256SUMS lines including binary-mode stars', () => {
    const text = `${'a'.repeat(64)}  one.zip\n${'b'.repeat(64)} *two.tar.gz\n\ngarbage line\n`
    const map = parseSha256Sums(text)
    expect(map.get('one.zip')).toBe('a'.repeat(64))
    expect(map.get('two.tar.gz')).toBe('b'.repeat(64))
    expect(map.size).toBe(2)
  })

  it('prefers the API digest and falls back to SHA256SUMS', () => {
    const sums = `${'c'.repeat(64)}  x.zip\n`
    expect(expectedSha256({ name: 'x.zip', digest: 'sha256:' + 'd'.repeat(64) }, sums)).toBe('d'.repeat(64))
    expect(expectedSha256({ name: 'x.zip', digest: null }, sums)).toBe('c'.repeat(64))
    expect(expectedSha256({ name: 'y.zip', digest: null }, sums)).toBeNull()
  })
})

describe('verifyFileSha256', () => {
  it('passes on a match', async () => {
    const file = tempFile('hello')
    await expect(verifyFileSha256(file, sha('hello'))).resolves.toBeUndefined()
  })

  it('refuses a mismatch', async () => {
    const file = tempFile('hello')
    await expect(verifyFileSha256(file, sha('tampered'))).rejects.toThrow(/SHA256/)
  })
})
