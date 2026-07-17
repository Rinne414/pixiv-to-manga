#!/usr/bin/env node
// Launches the packaged studio: the bundled server serves the built client
// from ../dist and opens the browser unless PTM_OPEN_BROWSER=0.
process.env.PTM_OPEN_BROWSER = process.env.PTM_OPEN_BROWSER ?? '1'
await import('../dist-server/index.mjs')
