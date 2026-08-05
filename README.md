# Pixiv-to-Manga Studio

Privacy-first, local-AI manga creation workspace: your images, your API keys, and your generations never leave your machine — keyless local models (Ollama / LM Studio) are the primary path, not a fallback.

Pixiv-to-Manga Studio imports Pixiv or local image sets, asks an AI model to create a story bible and page-level dialogue, overlays editable manga text on the images, and exports rendered PNG pages as a ZIP archive or a CBZ comic book for any manga reader.

## Quick Start (no dev tools needed)

Requires [Node.js 24 LTS or newer](https://nodejs.org/).

### Option A — portable zip (recommended for non-developers)

1. Download the latest `pixiv-to-manga-*-portable.zip` from [GitHub Releases](https://github.com/Rinne414/pixiv-to-manga/releases).
2. Unzip it anywhere.
3. Double-click `start-portable.cmd` (Windows) or run `./start-portable.sh` (macOS/Linux).

The first run installs production dependencies only; afterwards it starts from the prebuilt bundles.

### Option B — npm / npx

```bash
npx pixiv-to-manga
```

That downloads the prebuilt studio, starts the local server, and opens your browser (set `PTM_OPEN_BROWSER=0` to suppress).

### Option C — clone this repository

1. Install [Node.js 24 LTS or newer](https://nodejs.org/).
2. Download or clone this repository.
3. Double-click `start-studio.cmd` (Windows) or run `./start-studio.sh` (macOS/Linux).

The first run installs dependencies and builds the app; afterwards it starts in seconds and opens in your browser automatically. Everything is stored locally under your home directory (`.pixiv-to-manga-studio`). Developers can do the same with `npm start`.

## Current Scope

- Local web service with React, Vite, TypeScript, Fastify, and SQLite.
- Bounded Pixiv batch import for up to 50 explicit artworks / 200 images, with preview selection, pause/resume/cancel/retry, restart recovery, low-frequency serial requests, and local image import.
- Two-stage AI workflow: vision-assisted story analysis, then page dialogue generation.
- Per-line AI rewrite: select any bubble, optionally type an instruction (shorter / funnier / a character note), and regenerate just that line with full page context — undoable like any edit.
- Manual panel frames: draw numbered reading-order frames on the whiteboard; generation prompts describe them (RTL-aware) and placement snaps strays into the nearest frame — panel-aware layout without OCR/ML.
- Locked dialogue lines survive page regeneration: the model is told to write around them.
- One-click local engine detection: probes running Ollama / LM Studio instances and creates a keyless local profile automatically.
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
- Project lettering defaults: change font, size, text color, and SFX outline globally after generation; save defaults for new lines or explicitly apply them to existing dialogue. A separate action recolors lines from their character cards.
- Non-destructive cleanup layer: paint/mosaic over unwanted source text or marks with an eraser, persisted per page and included in reader preview and PNG/ZIP/CBZ/PDF exports without changing the original asset.
- Bubble craft pack: shout (jagged burst) and whisper (dashed) bubble styles, per-line vertical/horizontal text direction, and per-line font overrides — all WYSIWYG with exports.
- Reading-order badges on every bubble in the editor (never exported) so page flow is visible at a glance.
- Single-page PNG export next to the full ZIP export.
- CBZ comic-book export with ComicRack `ComicInfo.xml` metadata (title, page count, reading direction) for Komga, Kavita, Mihon, and other readers.
- Per-project reading direction (right-to-left manga default or left-to-right), persisted with the project, embedded in CBZ exports, and round-tripped through backups.
- Toast notifications for errors and milestones plus styled in-app confirm dialogs (destructive actions focus Cancel; Escape/backdrop cancels).
- Active-engine card in the Provider Lab showing exactly which AI route generations will use (local vs cloud, key state), mirroring the backend resolution.
- Reusable style prompt on the Story tab, injected into every story analysis and dialogue generation as a mandatory style rule.
- Infinite whiteboard canvas: wheel zoom anchored at the cursor, drag-to-pan, fit/100% controls; WYSIWYG with PNG export.
- Light/dark theme switch and English / Traditional Chinese (zh-TW) UI language switch, both persisted locally.
- Keyless local providers: Ollama / LM Studio profiles work without an API key only when `isLocal` is set and the URL is loopback/private; external providers still require one.
- Local project persistence in SQLite plus an asset folder.
- API keys and Pixiv cookies saved through the system credential store with `keytar`.
- Public Pixiv imports omit Cookie by default; private imports can opt into the saved session and R-18 imports require it. The app exposes a session test and rate-limit/account-risk guidance, but cannot guarantee zero Pixiv account risk.
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
3. Click **Discover** to list installed models. Known vision models (including Qwen2/2.5/3-VL) and provider metadata are recognized automatically; **Run test** verifies all safe capabilities by default when a model remains unknown.
4. Local providers automatically allow adult-content routing because content stays on the configured local endpoint. R-18 remains off per project until enabled in the Story panel. External adult capability requires explicit provider metadata, unmoderated provider metadata, or a model-scoped user confirmation; model names never grant capability evidence.
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
