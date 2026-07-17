#!/usr/bin/env node
// Launches the packaged studio: the bundled server serves the built client
// from ../dist and opens the browser unless PTM_OPEN_BROWSER=0.

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 23 || (major === 23 && minor < 4)) {
  console.error(
    `Pixiv-to-Manga Studio needs Node.js 23.4 or newer (built-in SQLite); you are running ${process.versions.node}.\n` +
      'Install the current LTS from https://nodejs.org/ and try again.',
  )
  process.exit(1)
}

process.env.PTM_OPEN_BROWSER = process.env.PTM_OPEN_BROWSER ?? '1'
await import('../dist-server/index.mjs')
