// Downloads the official Node.js runtime for a target, verifies it against that release's
// SHASUMS256.txt, and caches it. Node >= 22.18 strips types, so the server's own verify/archive
// modules are reused instead of duplicating them.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
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

export async function downloadTo(url, destination) {
  const response = await fetch(url, { headers: { 'User-Agent': 'pixiv-to-manga-packer' } })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`)
  await mkdir(path.dirname(destination), { recursive: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
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

  if (existsSync(binaryPath) && existsSync(licensePath)) return { binaryPath, licensePath }

  if (!existsSync(sumsPath)) await downloadTo(`${DIST_URL}/SHASUMS256.txt`, sumsPath)
  const expected = parseSha256Sums(await readFile(sumsPath, 'utf8')).get(spec.archive)
  if (!expected) throw new Error(`${spec.archive} is not listed in the Node ${NODE_VERSION} SHASUMS256.txt`)

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${spec.archive}...`)
    await downloadTo(`${DIST_URL}/${spec.archive}`, archivePath)
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
  await writeFile(path.join(dir, `${target}.verified`), `${expected}  ${spec.archive}\n`)
  return { binaryPath, licensePath }
}
