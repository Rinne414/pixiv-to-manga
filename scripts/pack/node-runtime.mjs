// Downloads the official Node.js runtime for a target, verifies it against that release's
// SHASUMS256.txt, and caches it. Node >= 22.18 strips types, so the server's own verify/archive
// modules are reused instead of duplicating them.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'
import { extractArchive } from '../../server/update/archive.ts'
import { parseSha256Sums, verifyFileSha256 } from '../../server/update/verify.ts'

/** Node 24 LTS ("Krypton"). Bump deliberately; the SHASUMS check below protects whichever version is set. */
export const NODE_VERSION = '24.22.0'

const DIST_URL = `https://nodejs.org/dist/v${NODE_VERSION}`

const TARGET_FILES = {
  'win-x64': { archive: `node-v${NODE_VERSION}-win-x64.zip`, binary: 'node.exe' },
  'linux-x64': { archive: `node-v${NODE_VERSION}-linux-x64.tar.gz`, binary: 'bin/node' },
}

const MAX_SUMS_BYTES = 1024 * 1024
const MAX_NODE_ARCHIVE_BYTES = 200 * 1024 * 1024

/** Downloads to a file, refusing bodies larger than maxBytes (the partial file is removed). */
export async function downloadTo(url, destination, maxBytes) {
  const response = await fetch(url, { headers: { 'User-Agent': 'pixiv-to-manga-packer' } })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Download is larger than the ${maxBytes} byte limit: ${url}`)
  await mkdir(path.dirname(destination), { recursive: true })
  let received = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      if (received > maxBytes) callback(new Error(`Download is larger than the ${maxBytes} byte limit: ${url}`))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(destination))
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}

async function sha256OfFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Remembers the SHA256 of each extracted file at the moment it was verified. */
export async function recordVerified(recordPath, files) {
  const record = {}
  for (const [name, file] of Object.entries(files)) record[name] = await sha256OfFile(file)
  await writeFile(recordPath, JSON.stringify(record, null, 2))
}

/** True only if every file still exists and matches the hash recorded when it was verified. */
export async function cacheIsIntact(recordPath, files) {
  let record
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8'))
  } catch {
    return false
  }
  for (const [name, file] of Object.entries(files)) {
    if (!existsSync(file) || record[name] !== (await sha256OfFile(file))) return false
  }
  return true
}

/** Returns the absolute paths of the runtime binary and its licence, extracted into the cache. */
export async function ensureNodeRuntime(cacheDir, target) {
  const spec = TARGET_FILES[target]
  if (!spec) throw new Error(`No Node runtime mapping for ${target}`)
  const dir = path.join(cacheDir, 'node', `v${NODE_VERSION}`)
  const archivePath = path.join(dir, spec.archive)
  const sumsPath = path.join(dir, 'SHASUMS256.txt')
  const binaryPath = path.join(dir, target, path.basename(spec.binary))
  const licensePath = path.join(dir, target, 'LICENSE')

  const recordPath = path.join(dir, `${target}.verified`)
  const extracted = { binary: binaryPath, license: licensePath }
  if (await cacheIsIntact(recordPath, extracted)) return { binaryPath, licensePath }
  // Missing, unrecorded or changed since verification: throw the cached copy away and fetch it again.
  await rm(path.join(dir, target), { recursive: true, force: true })
  await rm(archivePath, { force: true })
  await rm(sumsPath, { force: true })

  if (!existsSync(sumsPath)) await downloadTo(`${DIST_URL}/SHASUMS256.txt`, sumsPath, MAX_SUMS_BYTES)
  const expected = parseSha256Sums(await readFile(sumsPath, 'utf8')).get(spec.archive)
  if (!expected) throw new Error(`${spec.archive} is not listed in the Node ${NODE_VERSION} SHASUMS256.txt`)

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${spec.archive}...`)
    await downloadTo(`${DIST_URL}/${spec.archive}`, archivePath, MAX_NODE_ARCHIVE_BYTES)
  }
  await verifyFileSha256(archivePath, expected).catch(async (error) => {
    await rm(archivePath, { force: true })
    throw error
  })

  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ptm-node-'))
  try {
    await extractArchive(archivePath, scratch, { skipLinks: true })
    await mkdir(path.dirname(binaryPath), { recursive: true })
    await copyFile(path.join(scratch, ...spec.binary.split('/')), binaryPath)
    await copyFile(path.join(scratch, 'LICENSE'), licensePath)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  await recordVerified(recordPath, extracted)
  return { binaryPath, licensePath }
}
