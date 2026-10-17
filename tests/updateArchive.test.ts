import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import JSZip from 'jszip'
import { TarArchive } from 'archiver'
import { afterEach, describe, expect, it } from 'vitest'
import { extractArchive, sanitizeEntryPath } from '../server/update/archive'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-archive-'))
  dirs.push(dir)
  return dir
}

async function zipOf(entries: Record<string, string | { content: string; unixPermissions: number }>): Promise<string> {
  const zip = new JSZip()
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === 'string') zip.file(name, value)
    else zip.file(name, value.content, { unixPermissions: value.unixPermissions })
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
  const file = path.join(tempDir(), 'a.zip')
  writeFileSync(file, buffer)
  return file
}

async function tarGzOf(build: (archive: TarArchive) => void): Promise<string> {
  const archive = new TarArchive({ gzip: true })
  const chunks: Buffer[] = []
  archive.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })
  build(archive)
  await archive.finalize()
  await done
  const file = path.join(tempDir(), 'a.tar.gz')
  writeFileSync(file, Buffer.concat(chunks))
  return file
}

/** archiver normalizes names, so hostile entries are written by hand. */
function rawTarEntry(name: string, content: string): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124)
  header.write('00000000000\0', 136)
  header.write('        ', 148)
  header.write('0', 156)
  header.write('ustar\0' + '00', 257)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  body.write(content)
  return Buffer.concat([header, body, Buffer.alloc(1024)])
}

describe('sanitizeEntryPath', () => {
  it('accepts ordinary relative paths and normalizes separators', () => {
    expect(sanitizeEntryPath('pkg/dist/index.html')).toBe('pkg/dist/index.html')
    expect(sanitizeEntryPath('pkg\\dist\\a.js')).toBe('pkg/dist/a.js')
    expect(sanitizeEntryPath('./pkg/a')).toBe('pkg/a')
  })

  it('rejects absolute paths, drive letters, UNC and traversal', () => {
    const bad = ['/etc/passwd', 'C:\\evil', 'C:/evil', '\\\\host\\share', '../x', 'a/../../x', 'a/..', 'a\\..\\..\\x', 'a\0b', '']
    for (const name of bad) {
      expect(() => sanitizeEntryPath(name), JSON.stringify(name)).toThrow()
    }
  })
})

describe('extractArchive zip', () => {
  it('extracts files and strips the single top-level folder', async () => {
    const file = await zipOf({ 'pkg-1/a.txt': 'A', 'pkg-1/sub/b.txt': 'B' })
    const dest = tempDir()
    await extractArchive(file, dest)
    expect(readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('A')
    expect(readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8')).toBe('B')
  })

  it('refuses traversal and writes nothing outside the destination', async () => {
    const file = await zipOf({ 'pkg/ok.txt': 'ok', '../escape.txt': 'bad' })
    const dest = tempDir()
    await expect(extractArchive(file, dest)).rejects.toThrow(/unsafe/i)
    expect(existsSync(path.join(path.dirname(dest), 'escape.txt'))).toBe(false)
  })

  it('refuses symlink entries', async () => {
    const file = await zipOf({ 'pkg/ok.txt': 'ok', 'pkg/link': { content: '/etc/passwd', unixPermissions: 0o120777 } })
    await expect(extractArchive(file, tempDir())).rejects.toThrow(/symlink/i)
  })

  it('refuses an archive that expands beyond the size cap', async () => {
    const file = await zipOf({ 'pkg/big.txt': 'x'.repeat(5000) })
    await expect(extractArchive(file, tempDir(), { maxTotalBytes: 1000 })).rejects.toThrow(/too large/i)
  })

  it('does not strip when entries do not share one top-level folder', async () => {
    const file = await zipOf({ 'a.txt': 'A', 'b/c.txt': 'C' })
    const dest = tempDir()
    await extractArchive(file, dest)
    expect(existsSync(path.join(dest, 'a.txt'))).toBe(true)
    expect(existsSync(path.join(dest, 'b', 'c.txt'))).toBe(true)
  })
})

describe('extractArchive tar.gz', () => {
  it('extracts files and handles long names', async () => {
    const longName = 'pkg/' + 'd'.repeat(80) + '/' + 'e'.repeat(80) + '/file.txt'
    const file = await tarGzOf((archive) => {
      archive.append('run', { name: 'pkg/run.sh', mode: 0o755 })
      archive.append('long', { name: longName })
    })
    const dest = tempDir()
    await extractArchive(file, dest)
    expect(readFileSync(path.join(dest, 'run.sh'), 'utf8')).toBe('run')
    expect(readFileSync(path.join(dest, ...longName.split('/').slice(1)), 'utf8')).toBe('long')
  })

  it('refuses symlinks and traversal entries', async () => {
    const link = await tarGzOf((archive) => {
      archive.append('x', { name: 'pkg/a' })
      archive.symlink('pkg/link', '/etc/passwd')
    })
    await expect(extractArchive(link, tempDir())).rejects.toThrow(/symlink/i)
    const traversal = path.join(tempDir(), 'evil.tar.gz')
    writeFileSync(traversal, gzipSync(rawTarEntry('pkg/../../evil', 'x')))
    await expect(extractArchive(traversal, tempDir())).rejects.toThrow(/unsafe/i)
  })

  it('refuses a file that is neither zip nor gzip', async () => {
    const file = path.join(tempDir(), 'junk.bin')
    writeFileSync(file, 'plain text, not an archive')
    await expect(extractArchive(file, tempDir())).rejects.toThrow(/unsupported/i)
  })
})
