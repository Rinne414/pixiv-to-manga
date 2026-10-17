// Launcher scripts for the three package kinds. Exit code 75 means "restarting for an update":
// the apply helper relaunches the studio in a fresh window, so the old window just closes.

const WINDOWS_BODY = (nodeExpr, prelude) => `@echo off
setlocal
cd /d "%~dp0"
title Pixiv-to-Manga Studio
${prelude}
if not exist dist\\index.html (
  echo Missing prebuilt client under dist\\. Re-download the package.
  pause
  exit /b 1
)
if not exist dist-server\\index.mjs (
  echo Missing prebuilt server under dist-server\\. Re-download the package.
  pause
  exit /b 1
)

echo Starting Pixiv-to-Manga Studio... the app will open in your browser.
echo Keep this window open while you work; close it to stop the studio.
if not defined PTM_OPEN_BROWSER set PTM_OPEN_BROWSER=1
rem One line on purpose: cmd re-reads this file while it runs, and an update replaces it. The exit
rem decision is parsed together with the node call so nothing after it is read from the new file.
${nodeExpr} bin\\studio.mjs & if errorlevel 76 (pause & exit /b 1) else (if errorlevel 75 (exit /b 0) else (pause & exit /b 0))
`

const WINDOWS_BUNDLED_PRELUDE = `if not exist runtime\\node.exe (
  echo The bundled Node.js runtime is missing. Re-download the package.
  pause
  exit /b 1
)`

const WINDOWS_PORTABLE_PRELUDE = `where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 LTS or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

rem Reinstall when dependencies are missing or an update changed them.
fc /b deps.stamp node_modules\\.deps.stamp >nul 2>nul
if errorlevel 1 (
  echo Installing production dependencies...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Dependency install failed. See the messages above.
    pause
    exit /b 1
  )
  copy /y deps.stamp node_modules\\.deps.stamp >nul
)`

const crlf = (text) => text.replace(/\r?\n/g, '\r\n')

export const windowsBundledLauncher = crlf(WINDOWS_BODY('"%~dp0runtime\\node.exe"', WINDOWS_BUNDLED_PRELUDE))
export const windowsPortableLauncher = crlf(WINDOWS_BODY('node', WINDOWS_PORTABLE_PRELUDE))

const SH_BODY = (nodeExpr, prelude) => `#!/usr/bin/env bash
self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$self")"
${prelude}
if [ ! -f dist/index.html ] || [ ! -f dist-server/index.mjs ]; then
  echo "Missing prebuilt bundles. Re-download the package."
  exit 1
fi

echo "Starting Pixiv-to-Manga Studio... the app will open in your browser."
echo "Keep this terminal open while you work; press Ctrl+C to stop the studio."
export PTM_OPEN_BROWSER="\${PTM_OPEN_BROWSER:-1}"
export PTM_LAUNCHER_HANDLES_UPDATE=1
${nodeExpr} bin/studio.mjs
code=$?
# 75 = an update is staged. Apply it here, in this terminal, then start the new version.
if [ "$code" -eq 75 ]; then
  if [ -f .update-pending ]; then
    { read -r upd_cmd; read -r upd_helper; read -r upd_job; } < .update-pending
    rm -f .update-pending
    echo "Installing the update..."
    "$upd_cmd" "$upd_helper" "$upd_job"
  fi
  export PTM_OPEN_BROWSER=0
  exec "$self"
fi
exit "$code"
`

const SH_BUNDLED_PRELUDE = `if [ ! -x runtime/node ]; then
  echo "The bundled Node.js runtime is missing or not executable. Re-extract the package with tar -xzf."
  exit 1
fi`

const SH_PORTABLE_PRELUDE = `if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 LTS or newer is required. Install it from https://nodejs.org/ and re-run."
  exit 1
fi

# Reinstall when dependencies are missing or an update changed them.
if ! cmp -s deps.stamp node_modules/.deps.stamp 2>/dev/null; then
  echo "Installing production dependencies..."
  npm install --omit=dev || exit 1
  cp deps.stamp node_modules/.deps.stamp
fi`

export const shBundledLauncher = SH_BODY('./runtime/node', SH_BUNDLED_PRELUDE)
export const shPortableLauncher = SH_BODY('node', SH_PORTABLE_PRELUDE)

export function readmeFor(kind, version) {
  const title = `# Pixiv-to-Manga Studio ${version}`
  const data = `Your projects, settings and exports are stored under your home folder (\`.pixiv-to-manga-studio\`), outside this folder, so updating or deleting this folder never touches them. API keys and Pixiv cookies use the system credential store when available.\n\nUpdates: open Settings > Version and updates inside the app and press "Check for updates". Source and issues: https://github.com/Rinne414/pixiv-to-manga`
  if (kind === 'win-x64') {
    return `${title} (Windows x64)\n\nNo Node.js install needed.\n\n1. Unzip this folder anywhere.\n2. Double-click \`start-portable.cmd\`.\n\n${data}\n`
  }
  if (kind === 'linux-x64') {
    return `${title} (Linux x64)\n\nNo Node.js install needed (glibc-based distributions; the system keychain needs libsecret).\n\n\`\`\`bash\ntar -xzf pixiv-to-manga-${version}-linux-x64.tar.gz\ncd pixiv-to-manga-${version}-linux-x64\n./start-portable.sh\n\`\`\`\n\n${data}\n`
  }
  return `${title} (portable, macOS and others)\n\nRequires [Node.js 24 LTS or newer](https://nodejs.org/). The first launch runs \`npm install --omit=dev\`.\n\nWindows: double-click \`start-portable.cmd\`. macOS / Linux: \`chmod +x start-portable.sh && ./start-portable.sh\`.\n\n${data}\n`
}
