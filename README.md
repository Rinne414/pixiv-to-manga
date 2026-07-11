# Pixiv-to-Manga Studio

Local-first AI manga creation workspace.

Pixiv-to-Manga Studio imports Pixiv or local image sets, asks an AI model to create a story bible and page-level dialogue, overlays editable manga text on the images, and exports rendered PNG pages as a ZIP archive.

## Current Scope

- Local web service with React, Vite, TypeScript, Fastify, and SQLite.
- Pixiv artwork import and local image import.
- Two-stage AI workflow: vision-assisted story analysis, then page dialogue generation.
- Continuity-aware dialogue generation: each page request carries the previous page's dialogue lines plus the next page's image and beat summary (the last page gets closure guidance instead).
- Batch page-range generation on the Layout tab (from/to page inputs); completed pages are always skipped so hand-edited dialogue survives.
- First-run onboarding checklist in the left rail with progress derived from project state and a persistent dismiss.
- Story Continue entry for uploading/Pixiv-importing reference images, extracting generation metadata/tags, and generating continuation drafts.
- Editable Story Bible, character settings, and vertical manga dialogue bubbles with drag, scale, rotation, lock, and style controls.
- Manual bubble add/delete: double-click the whiteboard (or use the Dialogue tab) to add, delete from the Dialogue tab; Generate All skips completed pages so hand-edited dialogue is never overwritten.
- Manual character add/delete plus a per-character font picker (CJK presets); the chosen font applies to both the whiteboard and PNG export.
- Undo/redo for dialogue and Story Bible edits (toolbar buttons and Ctrl/Cmd+Z / Shift+Z / Y), backed by server-side restore so ids survive.
- Page management: move pages up/down (story beats follow) and delete pages with confirmation.
- Custom font upload (TTF/OTF/WOFF/WOFF2) into a global font library, available in every character font picker and in PNG export.
- Speech-bubble tail control: drag the tail handle on a selected bubble to point it at the speaker; thought bubbles trail dots, exports match the editor.
- Vertical-writing typography: CJK kinsoku line-breaking plus vertical presentation forms for punctuation (、。「」！？ etc.).
- Single-page PNG export next to the full ZIP export.
- Reusable style prompt on the Story tab, injected into every story analysis and dialogue generation as a mandatory style rule.
- Infinite whiteboard canvas: wheel zoom anchored at the cursor, drag-to-pan, fit/100% controls; WYSIWYG with PNG export.
- Light/dark theme switch and English / Traditional Chinese (zh-TW) UI language switch, both persisted locally.
- Keyless local providers: Ollama / LM Studio profiles (`isLocal`) work without an API key; external providers still require one.
- Local project persistence in SQLite plus an asset folder.
- API keys and Pixiv cookies saved through the system credential store with `keytar`.
- PNG ZIP export with project manifest.
- Project Backup ZIP export/restore with manifest, database slice, and project assets for migration.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Using a local Ollama model

1. Start Ollama (default `http://127.0.0.1:11434`) and pull a vision-capable model, e.g. `ollama pull qwen3-vl:8b`.
2. In the app: Settings tab → Provider Lab → Create provider:
   - Base URL `http://127.0.0.1:11434/v1`, Default model `qwen3-vl:8b`, check **Local provider**, leave API key empty.
3. Click **Discover** to list installed models, then **Run test** (enable `vision`) to verify capability flags.
4. In the Capability Matrix, confirm **Vision**; for NSFW routing, explicitly enable **Adult input** / **Adult generation** on that model (user-confirmed only), and turn on R-18 in the Story panel per project. Routes fail closed without matching flags.
5. Leave the global Settings Base URL/Model empty (or point them at the same profile) — generation picks the first usable provider automatically.

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
