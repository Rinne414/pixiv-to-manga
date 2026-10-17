// Installs production dependencies for a target platform from the lockfile, without running
// any install scripts, then drops in the one native addon that needs a manual prebuild.
//
// Native modules in this app:
//  - sharp: N-API; the binaries ship as per-platform optional packages (@img/sharp-*), which
//    npm selects with --os/--cpu/--libc, so cross-installing from Windows works.
//  - keytar: N-API v3 (ABI-stable across Node versions). Its install script would fetch the
//    host platform's prebuild, so scripts are skipped and the official prebuild for the target
//    is fetched and pinned by SHA256 below.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractArchive } from '../../server/update/archive.ts'
import { verifyFileSha256 } from '../../server/update/verify.ts'
import { downloadTo } from './node-runtime.mjs'

const KEYTAR_VERSION = '7.9.0'

/** SHA256 of each official keytar prebuild tarball (napi v3), recorded when first fetched and reviewed. */
const KEYTAR_PREBUILDS = {
  'win-x64': {
    file: `keytar-v${KEYTAR_VERSION}-napi-v3-win32-x64.tar.gz`,
    sha256: 'f00156103976f77847f9ff96ca96c3facac2b4527edf41dfee5d50be39736459',
  },
  'linux-x64': {
    file: `keytar-v${KEYTAR_VERSION}-napi-v3-linux-x64.tar.gz`,
    sha256: '2d75753fabf9dceb49537ae231e1897de53727bc0fadbc2a01e6374a1443c67c',
  },
}

const NPM_TARGETS = {
  'win-x64': ['--os=win32', '--cpu=x64'],
  'linux-x64': ['--os=linux', '--cpu=x64', '--libc=glibc'],
}

export async function stageProductionModules(root, cacheDir, target, destination) {
  const stage = path.join(cacheDir, `stage-${target}`)
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  await copyFile(path.join(root, 'package.json'), path.join(stage, 'package.json'))
  await copyFile(path.join(root, 'package-lock.json'), path.join(stage, 'package-lock.json'))

  const result = spawnSync(
    'npm',
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...NPM_TARGETS[target]],
    { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (result.status !== 0) throw new Error(`npm ci failed for ${target}`)

  await installKeytarPrebuild(cacheDir, target, path.join(stage, 'node_modules', 'keytar'))
  await rm(destination, { recursive: true, force: true })
  await cp(path.join(stage, 'node_modules'), destination, { recursive: true })
  await rm(stage, { recursive: true, force: true })
}

async function installKeytarPrebuild(cacheDir, target, keytarDir) {
  if (!existsSync(keytarDir)) throw new Error('keytar was not installed; check optionalDependencies')
  const spec = KEYTAR_PREBUILDS[target]
  const archivePath = path.join(cacheDir, 'keytar', spec.file)
  if (!existsSync(archivePath)) {
    console.log(`Downloading ${spec.file}...`)
    await downloadTo(`https://github.com/atom/node-keytar/releases/download/v${KEYTAR_VERSION}/${spec.file}`, archivePath)
  }
  await verifyFileSha256(archivePath, spec.sha256).catch(async (error) => {
    await rm(archivePath, { force: true })
    throw error
  })
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ptm-keytar-'))
  try {
    await extractArchive(archivePath, scratch) // the single top folder (build/) is stripped
    const release = path.join(keytarDir, 'build', 'Release')
    await mkdir(release, { recursive: true })
    await copyFile(path.join(scratch, 'Release', 'keytar.node'), path.join(release, 'keytar.node'))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Hash of the locked dependency set only, so a version bump alone does not trigger a reinstall. */
export async function depsStamp(root) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const { '': _project, ...dependencies } = lock.packages
  return createHash('sha256').update(JSON.stringify(dependencies)).digest('hex')
}

export async function writeStamp(file, value) {
  await writeFile(file, `${value}\n`)
}
