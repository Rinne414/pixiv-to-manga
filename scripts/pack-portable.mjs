#!/usr/bin/env node
/**
 * Builds the release packages into release/:
 *   pixiv-to-manga-<ver>-win-x64.zip        bundled Node runtime + production node_modules
 *   pixiv-to-manga-<ver>-linux-x64.tar.gz   same, for glibc Linux
 *   pixiv-to-manga-<ver>-portable.zip       needs Node 24+ installed (macOS and anything else)
 *   SHA256SUMS.txt                          covers every asset above
 *
 * Needs Node >= 22.18 (it imports the server's TypeScript verify/archive modules directly).
 * Downloads (Node runtime, keytar prebuilds) are verified and cached in .pack-cache/.
 * Usage: node scripts/pack-portable.mjs [--only win-x64,linux-x64,portable] [--skip-build]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TarArchive, ZipArchive } from 'archiver'
import { ensureNodeRuntime } from './pack/node-runtime.mjs'
import { depsStamp, stageProductionModules, writeStamp } from './pack/production-modules.mjs'
import {
  readmeFor,
  shBundledLauncher,
  shPortableLauncher,
  windowsBundledLauncher,
  windowsPortableLauncher,
} from './pack/launchers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.pack-cache')
const releaseDir = path.join(root, 'release')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

const args = process.argv.slice(2)
const onlyArg = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)
const only = onlyArg ? onlyArg.split(',') : ['win-x64', 'linux-x64', 'portable']

const TARGETS = {
  'win-x64': { extension: 'zip', launcher: 'start-portable.cmd', launcherBody: windowsBundledLauncher, bundled: true },
  'linux-x64': { extension: 'tar.gz', launcher: 'start-portable.sh', launcherBody: shBundledLauncher, bundled: true },
  portable: { extension: 'zip', launcher: null, launcherBody: null, bundled: false },
}

const EXECUTABLE = new Set(['runtime/node', 'start-portable.sh'])
const COPY_ENTRIES = ['bin', 'dist', 'dist-server', 'package.json', 'package-lock.json', 'LICENSE']

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!args.includes('--skip-build')) {
  run('npm', ['run', 'build'])
  run('npm', ['run', 'build:server'])
}

await mkdir(releaseDir, { recursive: true })
const assets = []
for (const name of only) {
  if (!TARGETS[name]) throw new Error(`Unknown package kind "${name}"`)
  assets.push(await buildPackage(name))
}
await writeChecksums(assets)

async function buildPackage(kind) {
  const spec = TARGETS[kind]
  const stamp = `pixiv-to-manga-${version}-${kind}`
  const folder = path.join(cacheDir, 'build', stamp)
  console.log(`\n== ${stamp} ==`)
  await rm(folder, { recursive: true, force: true })
  await mkdir(folder, { recursive: true })

  for (const entry of COPY_ENTRIES) await cp(path.join(root, entry), path.join(folder, entry), { recursive: true })
  await writeFile(path.join(folder, 'install-info.json'), `${JSON.stringify({ packageType: kind }, null, 2)}\n`)
  await writeFile(path.join(folder, 'README.md'), readmeFor(kind, version))

  if (spec.bundled) {
    const { binaryPath, licensePath } = await ensureNodeRuntime(cacheDir, kind)
    const runtimeDir = path.join(folder, 'runtime')
    await mkdir(runtimeDir, { recursive: true })
    await cp(binaryPath, path.join(runtimeDir, path.basename(binaryPath)))
    await cp(licensePath, path.join(runtimeDir, 'LICENSE-node'))
    await stageProductionModules(root, cacheDir, kind, path.join(folder, 'node_modules'))
    await writeFile(path.join(folder, spec.launcher), spec.launcherBody, 'utf8')
  } else {
    await writeStamp(path.join(folder, 'deps.stamp'), await depsStamp(root))
    await writeFile(path.join(folder, 'start-portable.cmd'), windowsPortableLauncher, 'utf8')
    await writeFile(path.join(folder, 'start-portable.sh'), shPortableLauncher, 'utf8')
    await chmod(path.join(folder, 'start-portable.sh'), 0o755)
  }

  const outFile = path.join(releaseDir, `${stamp}.${spec.extension}`)
  await rm(outFile, { force: true })
  if (spec.extension === 'zip') await writeZip(folder, stamp, outFile)
  else await writeTarGz(folder, stamp, outFile)
  const sizeMb = ((await stat(outFile)).size / (1024 * 1024)).toFixed(1)
  console.log(`Built ${outFile} (${sizeMb} MB)`)
  await rm(folder, { recursive: true, force: true })
  return outFile
}

/** Normalizes modes: Windows file systems carry no Unix permissions, so set them explicitly. */
function withUnixModes(entry) {
  // archiver names directory-walk entries relative to the folder (the archive prefix is added later).
  const relative = entry.name.replaceAll('\\', '/')
  entry.mode = entry.stats?.isDirectory() || EXECUTABLE.has(relative) ? 0o755 : 0o644
  return entry
}

function writeZip(folder, stamp, outFile) {
  return pipeArchive(new ZipArchive({ zlib: { level: 9 } }), outFile, (archive) => archive.directory(folder, stamp))
}

function writeTarGz(folder, stamp, outFile) {
  return pipeArchive(new TarArchive({ gzip: true, gzipOptions: { level: 9 } }), outFile, (archive) =>
    archive.directory(folder, stamp, withUnixModes),
  )
}

function pipeArchive(archive, outFile, populate) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outFile)
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    populate(archive)
    archive.finalize().catch(reject)
  })
}

async function writeChecksums(files) {
  // Re-hash every package of this version in release/, not only the ones built this run.
  const all = (await readdir(releaseDir)).filter((name) => name.startsWith(`pixiv-to-manga-${version}-`)).sort()
  const lines = []
  for (const name of all) lines.push(`${await sha256(path.join(releaseDir, name))}  ${name}`)
  await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
  console.log(`\n${lines.join('\n')}\n(${files.length} built this run; SHA256SUMS.txt written)`)
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
