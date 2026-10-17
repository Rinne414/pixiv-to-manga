import { chmod, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import JSZip from 'jszip'

export interface ExtractOptions {
  maxTotalBytes?: number
  maxEntries?: number
  /** Packaging only: silently drop links instead of refusing the archive (the updater never sets this). */
  skipLinks?: boolean
}

const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 100_000
const SYMLINK_MODE = 0o120000
const FILE_TYPE_MASK = 0o170000

interface ArchiveEntry {
  name: string
  isDirectory: boolean
  mode: number | null
  read: () => Promise<Buffer>
}

/** Normalizes an archive entry name, refusing anything that could land outside the destination. */
export function sanitizeEntryPath(name: string): string {
  const fail = (): never => {
    throw new Error(`Unsafe path in update archive: ${JSON.stringify(name)}`)
  }
  if (!name || name.includes('\0')) return fail()
  const slashed = name.replaceAll('\\', '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return fail()
  const parts: string[] = []
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return fail()
    // Colons (drive letters, NTFS streams) and trailing dots/spaces mean something else on Windows.
    if (part.includes(':') || /[. ]$/.test(part)) return fail()
    parts.push(part)
  }
  if (!parts.length) return fail()
  return parts.join('/')
}

export async function extractArchive(file: string, destDir: string, options: ExtractOptions = {}): Promise<void> {
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  const entries = await readEntries(file, options.skipLinks ?? false, maxTotalBytes)
  const safe = entries.map((entry) => ({ ...entry, name: sanitizeEntryPath(entry.name) }))
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  if (safe.length > maxEntries) throw new Error('Update archive has too many entries')
  assertNoCaseCollisions(safe.map((entry) => entry.name))
  const strip = sharedTopFolder(safe)
  const root = path.resolve(destDir)
  await mkdir(root, { recursive: true })

  let total = 0
  const maxTotal = maxTotalBytes
  for (const entry of safe) {
    const relative = strip ? entry.name.slice(strip.length + 1) : entry.name
    if (!relative) continue
    const target = path.resolve(root, ...relative.split('/'))
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Unsafe path in update archive: ${JSON.stringify(entry.name)}`)
    }
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true })
      continue
    }
    const data = await entry.read()
    total += data.length
    if (total > maxTotal) throw new Error('Update archive is too large once extracted')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
    if (process.platform !== 'win32' && entry.mode !== null) await chmod(target, entry.mode & 0o777)
  }
}

/** Two names that differ only by case would overwrite each other on Windows and macOS. */
function assertNoCaseCollisions(names: string[]): void {
  const seen = new Map<string, string>()
  for (const name of names) {
    const key = name.toLowerCase()
    const earlier = seen.get(key)
    if (earlier !== undefined && earlier !== name) {
      throw new Error(`Update archive entries collide because they differ only by case: ${earlier} and ${name}`)
    }
    seen.set(key, name)
  }
}

/** The common first folder, only when every entry lives inside exactly one folder. */
function sharedTopFolder(entries: { name: string; isDirectory: boolean }[]): string | null {
  if (!entries.length) return null
  const first = entries[0].name.split('/')[0]
  const inside = entries.every((entry) => entry.name.split('/')[0] === first && (entry.name.includes('/') || entry.isDirectory))
  return inside && entries.some((entry) => entry.name.includes('/')) ? first : null
}

async function readEntries(file: string, skipLinks: boolean, maxTotalBytes: number): Promise<ArchiveEntry[]> {
  const handle = await open(file, 'r')
  const magic = Buffer.alloc(4)
  try {
    await handle.read(magic, 0, 4, 0)
  } finally {
    await handle.close()
  }
  if (magic[0] === 0x50 && magic[1] === 0x4b) return readZipEntries(await readFile(file), skipLinks, maxTotalBytes)
  if (magic[0] === 0x1f && magic[1] === 0x8b) return readTarEntries(inflateBounded(await readFile(file), maxTotalBytes), skipLinks)
  throw new Error('Unsupported update archive format (expected .zip or .tar.gz)')
}

/** Gunzips with a hard output cap (tar headers and padding allowed on top of the payload). */
function inflateBounded(buffer: Buffer, maxTotalBytes: number): Buffer {
  try {
    return gunzipSync(buffer, { maxOutputLength: Math.ceil(maxTotalBytes * 1.1) + 1024 * 1024 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new Error('Update archive is too large once extracted', { cause: error })
    throw error
  }
}

async function readZipEntries(buffer: Buffer, skipLinks: boolean, maxTotalBytes: number): Promise<ArchiveEntry[]> {
  const zip = await JSZip.loadAsync(buffer)
  // JSZip rejects entries whose data does not match the declared size, so the declared sum is a real bound.
  const declared = Object.values(zip.files).reduce((sum, entry) => sum + declaredSize(entry), 0)
  if (declared > maxTotalBytes) throw new Error('Update archive is too large once extracted')
  return Object.values(zip.files).flatMap((entry) => {
    const mode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : null
    if (mode !== null && (mode & FILE_TYPE_MASK) === SYMLINK_MODE) {
      if (skipLinks) return []
      throw new Error(`Update archive contains a symlink (${entry.name}); refusing to extract it`)
    }
    return [
      {
        name: entry.name,
        isDirectory: entry.dir,
        mode,
        read: () => entry.async('nodebuffer'),
      },
    ]
  })
}

function declaredSize(entry: JSZip.JSZipObject): number {
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  return typeof size === 'number' ? size : 0
}

const TAR_BLOCK = 512

function readTarEntries(tar: Buffer, skipLinks: boolean): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  let offset = 0
  let pendingPath: string | null = null
  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK)
    if (header.every((byte) => byte === 0)) break
    const size = parseTarNumber(header.subarray(124, 136))
    const type = String.fromCharCode(header[156] || 0x30)
    const body = tar.subarray(offset + TAR_BLOCK, offset + TAR_BLOCK + size)
    if (body.length < size) throw new Error('Update archive is truncated')
    offset += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK

    if (type === 'x') {
      pendingPath = paxPath(body) ?? pendingPath
      continue
    }
    if (type === 'g') continue
    if (type === 'L') {
      pendingPath = cString(body)
      continue
    }
    if ((type === '1' || type === '2') && skipLinks) {
      pendingPath = null
      continue
    }
    if (type === '1' || type === '2') {
      throw new Error(`Update archive contains a symlink or hard link (${cString(header.subarray(0, 100))}); refusing to extract it`)
    }
    if (type !== '0' && type !== '5') {
      throw new Error(`Update archive contains an unsupported entry type "${type}"`)
    }
    const prefix = cString(header.subarray(345, 500))
    const name = pendingPath ?? (prefix ? `${prefix}/${cString(header.subarray(0, 100))}` : cString(header.subarray(0, 100)))
    pendingPath = null
    const content = Buffer.from(body)
    entries.push({
      name,
      isDirectory: type === '5',
      mode: parseTarNumber(header.subarray(100, 108)),
      read: async () => content,
    })
  }
  return entries
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString('utf8')
}

function parseTarNumber(field: Uint8Array): number {
  // GNU base-256 sizes (high bit set) are used for entries over 8 GiB; nothing here is that big.
  if (field[0] & 0x80) throw new Error('Update archive entry is too large')
  const text = cString(field).trim()
  return text ? Number.parseInt(text, 8) : 0
}

function paxPath(body: Buffer): string | null {
  const text = body.toString('utf8')
  const match = /\d+ path=([^\n]*)\n/.exec(text)
  return match ? match[1] : null
}
