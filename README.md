# Pixiv-to-Manga Studio

Privacy-first, local-AI manga creation workspace: your images, your API keys, and your generations never leave your machine — keyless local models (Ollama / LM Studio) are the primary path, not a fallback.

Pixiv-to-Manga Studio imports Pixiv or local image sets, asks an AI model to create a story bible and page-level dialogue, overlays editable manga text on the images, and exports rendered PNG pages as a ZIP archive or a CBZ comic book for any manga reader.

## Quick Start (no dev tools needed)

Once the package is published to npm, the fastest path is:

```bash
npx pixiv-to-manga
```

That downloads the prebuilt studio, starts the local server, and opens your browser (set `PTM_OPEN_BROWSER=0` to suppress). Requires [Node.js 24 LTS or newer](https://nodejs.org/).

Running from a clone works the same way:

1. Install [Node.js 24 LTS or newer](https://nodejs.org/).
2. Download or clone this repository.
3. Double-click `start-studio.cmd` (Windows) or run `./start-studio.sh` (macOS/Linux).

The first run installs dependencies and builds the app; afterwards it starts in seconds and opens in your browser automatically. Everything is stored locally under your home directory (`.pixiv-to-manga-studio`). Developers can do the same with `npm start`.

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
- SFX text style for onomatopoeia: bubble-less outlined display text (1.6x size), also available to AI generation for sound effects.
- Single-page PNG export next to the full ZIP export.
- CBZ comic-book export with ComicRack `ComicInfo.xml` metadata (title, page count, reading direction) for Komga, Kavita, Mihon, and other readers.
- Per-project reading direction (right-to-left manga default or left-to-right), persisted with the project, embedded in CBZ exports, and round-tripped through backups.
- Toast notifications for errors and milestones plus styled in-app confirm dialogs (destructive actions focus Cancel; Escape/backdrop cancels).
- Active-engine card in the Provider Lab showing exactly which AI route generations will use (local vs cloud, key state), mirroring the backend resolution.
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
4. Under **Detected capabilities**, confirm **Vision** was picked up; for NSFW routing, explicitly enable **Adult input** / **Adult generation** in the NSFW / R-18 section (never auto-detected, user-confirmed only), and turn on R-18 in the Story panel per project. Routes fail closed without matching flags.
5. Leave the global Settings Base URL/Model empty (or point them at the same profile) — generation picks the first usable provider automatically.

## Verification

```bash
npm run lint
npm test
npm run build
npm run e2e
```

`npm run e2e` starts isolated local services with a mock OpenAI-compatible provider, a temporary data directory, and an in-memory keytar test store. The same suite runs in GitHub Actions CI (`.github/workflows/ci.yml`) on Node 24.

## Known Notes

- The SQLite layer uses Node's built-in `node:sqlite`, which is still marked experimental upstream — the startup warning is expected. If a future Node release changes the API, the planned fallback is `better-sqlite3` behind the same `StudioDatabase` interface.
- `keytar` is an optional dependency: when the system credential store is unavailable the app runs, but refuses to persist API keys/cookies as plain text.

## License

Apache-2.0. See [LICENSE](./LICENSE).
