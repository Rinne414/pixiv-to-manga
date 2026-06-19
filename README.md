# Pixiv-to-Manga Studio

Local-first AI manga creation workspace.

Pixiv-to-Manga Studio imports Pixiv or local image sets, asks an AI model to create a story bible and page-level dialogue, overlays editable manga text on the images, and exports rendered PNG pages as a ZIP archive.

## Current Scope

- Local web service with React, Vite, TypeScript, Fastify, and SQLite.
- Pixiv artwork import and local image import.
- Two-stage AI workflow: story analysis, then page dialogue generation.
- Editable vertical manga dialogue bubbles with drag, scale, rotation, lock, and style controls.
- Local project persistence in SQLite plus an asset folder.
- API keys and Pixiv cookies saved through the system credential store with `keytar`.
- PNG ZIP export with project manifest.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Verification

```bash
npm run lint
npm test
npm run build
npm run e2e
```

`npm run e2e` starts isolated local services with a mock OpenAI-compatible provider, a temporary data directory, and an in-memory keytar test store.

## License

Apache-2.0. See [LICENSE](./LICENSE).
