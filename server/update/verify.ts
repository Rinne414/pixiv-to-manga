import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

const HEX_64 = /^[0-9a-f]{64}$/

/** GitHub's asset `digest` field looks like `sha256:<hex>`. */
export function parseDigest(digest: string | null | undefined): string | null {
  if (!digest) return null
  const match = /^sha256:([0-9a-fA-F]{64})$/.exec(digest.trim())
  return match ? match[1].toLowerCase() : null
}

/** Parses `sha256sum` output: `<hex>  name` or `<hex> *name`. */
export function parseSha256Sums(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim())
    if (match) result.set(match[2].trim(), match[1].toLowerCase())
  }
  return result
}

export function expectedSha256(asset: { name: string; digest?: string | null }, sumsText: string | null): string | null {
  const fromApi = parseDigest(asset.digest)
  if (fromApi) return fromApi
  return sumsText ? (parseSha256Sums(sumsText).get(asset.name) ?? null) : null
}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function verifyFileSha256(file: string, expected: string): Promise<void> {
  const wanted = expected.toLowerCase()
  if (!HEX_64.test(wanted)) throw new Error('Expected SHA256 is not a valid hex digest')
  const actual = await sha256OfFile(file)
  if (actual !== wanted) {
    throw new Error(`SHA256 mismatch: the download is ${actual} but the release says ${wanted}. The update was refused.`)
  }
}
