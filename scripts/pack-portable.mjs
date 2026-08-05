#!/usr/bin/env node
/**
 * Builds a portable release zip with prebuilt client + server bundles.
 * Consumers only need Node.js 24+ and `npm install --omit=dev`.
 *
 * Output: release/pixiv-to-manga-<version>-portable.zip
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const stamp = `pixiv-to-manga-${version}-portable`
const outDir = path.join(root, 'release', stamp)
const zipPath = path.join(root, 'release', `${stamp}.zip`)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`Building portable package ${stamp}…`)
run('npm', ['run', 'build'])
run('npm', ['run', 'build:server'])

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const copyEntries = [
  'bin',
  'dist',
  'dist-server',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'start-studio.cmd',
  'start-studio.sh',
]

for (const entry of copyEntries) {
  await cp(path.join(root, entry), path.join(outDir, entry), { recursive: true })
}

// Prefer prebuilt bundles so first launch does not recompile from source.
const portableCmd = `@echo off
setlocal
cd /d "%~dp0"
title Pixiv-to-Manga Studio (portable)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 LTS or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing production dependencies...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Dependency install failed. See the messages above.
    pause
    exit /b 1
  )
)

if not exist dist\\index.html (
  echo Missing prebuilt client under dist\\. Re-download the portable package.
  pause
  exit /b 1
)
if not exist dist-server\\index.mjs (
  echo Missing prebuilt server under dist-server\\. Re-download the portable package.
  pause
  exit /b 1
)

echo Starting Pixiv-to-Manga Studio... the app will open in your browser.
echo Keep this window open while you work; close it to stop the studio.
set PTM_OPEN_BROWSER=1
node bin\\studio.mjs
pause
`

const portableSh = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 LTS or newer is required. Install it from https://nodejs.org/ and re-run."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing production dependencies..."
  npm install --omit=dev
fi

if [ ! -f dist/index.html ] || [ ! -f dist-server/index.mjs ]; then
  echo "Missing prebuilt bundles. Re-download the portable package."
  exit 1
fi

echo "Starting Pixiv-to-Manga Studio... the app will open in your browser."
echo "Keep this terminal open while you work; press Ctrl+C to stop the studio."
export PTM_OPEN_BROWSER="\${PTM_OPEN_BROWSER:-1}"
exec node bin/studio.mjs
`

await writeFile(path.join(outDir, 'start-portable.cmd'), portableCmd, 'utf8')
await writeFile(path.join(outDir, 'start-portable.sh'), portableSh, 'utf8')

const note = `# Pixiv-to-Manga Studio ${version} (portable)

Requires [Node.js 24 LTS or newer](https://nodejs.org/).

## Windows

1. Unzip this folder anywhere.
2. Double-click \`start-portable.cmd\`.
3. The first run installs production dependencies; afterwards it starts in seconds.

## macOS / Linux

\`\`\`bash
chmod +x start-portable.sh
./start-portable.sh
\`\`\`

Data is stored under your home directory (\`.pixiv-to-manga-studio\`). API keys and Pixiv cookies use the system credential store when available.

Source and issue tracker: https://github.com/Rinne414/pixiv-to-manga
`
await writeFile(path.join(outDir, 'PORTABLE.md'), note, 'utf8')

await rm(zipPath, { force: true })
await mkdir(path.dirname(zipPath), { recursive: true })

await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  output.on('close', resolve)
  archive.on('error', reject)
  archive.pipe(output)
  archive.directory(outDir, stamp)
  archive.finalize().catch(reject)
})

// Keep the unzipped folder for local smoke checks; zip is the ship artifact.
const sizeMb = ((await stat(zipPath)).size / (1024 * 1024)).toFixed(2)
console.log(`Portable package ready: ${zipPath} (${sizeMb} MB)`)
console.log(`Unzipped preview: ${outDir}`)
