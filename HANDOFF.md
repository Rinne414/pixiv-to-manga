# Agent Handoff Notes

Last updated: 2026-07-05. Written after shipping: infinite whiteboard canvas, dark mode,
en/zh-TW i18n, keyless local provider (Ollama) support, and sidebar legibility fixes.
Everything below is verified green: `npx tsc -b`, `npm test` (82 tests), `npm run lint`,
`npm run build`, `npx playwright test` (11 E2E). A live run against local Ollama
(qwen3-vl:8b, keyless, isLocal) produced a real Story Bible (`usedMock: false`).

## What just landed (2026-07-05 session)

1. **Keyless local providers.** `resolveAiTarget` (server/ai.ts) and
   `resolveImageGenerationTarget` (server/continuation.ts) now accept providers with a
   stored key OR `isLocal: true`. Keyless requests omit the `Authorization` header
   entirely. Keyless EXTERNAL providers are still skipped (fail closed / mock fallback).
   A keyless local provider whose model lacks `supportsImageGeneration` still 400s
   continuation with `image_generation_required` — same invariant as keyed providers.
2. **i18n (en / zh-TW).** `src/i18n/` — dependency-free dictionary layer.
   `I18nProvider` (main.tsx) + `useI18n().t(key, params)`; strings in
   `src/i18n/strings/{common,providerLab,storyContinue}.ts`, merged in
   `src/i18n/messages.ts` (`MessageKey` is the compile-time union of all keys).
   Locale persists to localStorage `ptm-locale`; auto-detects `zh*` browsers.
   **The E2E suite asserts English copy verbatim — `en` values are contract.**
   playwright.config.ts pins `locale: 'en-US'` for this reason.
3. **Dark mode.** `src/theme.ts` `useTheme` → `<html data-theme>`; all colors are CSS
   variables in src/index.css with a `:root[data-theme='dark']` block. index.html has a
   pre-paint inline script to avoid theme flash. Persists to localStorage `ptm-theme`.
   The log panel and trace box intentionally stay dark in both themes.
4. **Infinite whiteboard.** `src/WhiteboardCanvas.tsx` replaced App's fixed-fit canvas.
   Konva Stage fills the panel; wheel zoom anchors at the cursor; dragging the
   background pans (bubbles stay draggable — Konva drags the innermost draggable node);
   fit / 100% controls bottom-right; zoom state lives in App and is shared with the
   Layout tab slider (range 0.1–4 via `WHITEBOARD_MIN/MAX_ZOOM`).
   **Bubble geometry mirrors canvasExport.drawDialogue in page-pixel space** (34px base
   font, +52/+56 padding) so the editor is WYSIWYG with PNG export — keep them in sync.
   `toVerticalColumns` is shared from src/shared/text.ts (used by both).
5. **Sidebar legibility.** Root font 15px, rails 288/416px, inspector tabs 12px, muted
   contrast raised. `.field-hint` class exists for small helper copy.

## Traps for the next agent

- **Do not reword `en` strings casually** — e2e matches them exactly (e.g.
  '{count} image(s) imported.', 'Story Bible generated with local mock engine.',
  provider-form labels). Change string + spec together or not at all.
- **WhiteboardCanvas uses a callback ref** (`setContainer`) for its ResizeObserver
  because the whiteboard div mounts only after a page exists. A plain ref + mount
  effect silently never measures (stage never renders). Regression-tested by
  e2e/ui-chrome.spec.ts.
- **Wheel zoom pre-writes `prevZoomRef`** before calling `onZoomChange` so the
  center-stable effect doesn't double-adjust the pan. Fit does the same.
- Ollama vision rejects non-decodable images with HTTP 400 — the PNG builders in
  tests/helpers/imageFixtures.ts are metadata fixtures, NOT valid rasters. Use a real
  PNG when exercising a live vision model.
- qwen3-vl (Ollama) returns a `reasoning` field next to `content`; the OpenAI parser
  reads `message.content` only, which is correct — don't "fix" it to concatenate.

## Architecture decisions you should not accidentally undo (carried forward)

- **Provider resolution is shared.** `server/providerResolution.ts` is the single source
  for provider/capability matching. Both `server/ai.ts` and `server/continuation.ts`
  import it. Do not re-inline copies.
- **Generate requests never carry image bytes.** `continuationReferenceSchema` omits
  `previewDataUrl`; the client strips it via `toReferenceInput`.
- **Schema limits are the source of truth.** `CONTINUATION_LIMITS` /
  `GENERATION_METADATA_LIMITS` in src/shared/schemas.ts drive zod and the UI caps;
  `clampMetadataToSchemaLimits` keeps inspect responses self-consistent.
- **Image-generation target selection fails closed on purpose** (see item 1 above for
  the keyless-local extension of this rule).
- **Capability upserts must not clobber user data.** Only test kinds that ran update
  flags; `supportsImageGeneration` + adult flags are name-inference/user-only;
  `source: 'user'` is sticky; `db.upsertModelCapability` filters `undefined`.
- **Safety classification excludes negative prompts** (`buildSafetyClassificationText`).
- **Pixiv import streams** (`forEachPixivArtworkImage`); `downloadPixivArtworkImages`
  buffers and is only safe for callers that cap `maxPages`.
- **EXIF is parsed as binary TIFF** (`readExifMetadata`); do not string-search payloads.

## Known debts (deliberately deferred)

1. `src/App.tsx` (~1100 lines) still exceeds the 800-line guideline (whiteboard/canvas
   code moved out, i18n added back). Next structural task remains extracting a
   `StudioWorkspace` component. `src/index.css` (~1300 lines) likewise — split
   Story-Continue + Provider-Lab CSS into feature files. Keep `data-testid`s working.
2. Inspect responses still ship full-resolution base64 previews for thumbnails.
3. `server/secrets.ts` has its own `normalizeBaseUrl` (settings normalizer), not
   consolidated into providerResolution — semantically similar, low risk.
4. `StoryContinuePanel` keeps a local `loadingLabel` mirroring App's busy label.
5. JIS-encoded EXIF UserComment unsupported (rare; degrades to no metadata).
6. No rate limiting anywhere — accepted for a 127.0.0.1-only tool.
7. Log entries keep the language they were written in (history is not re-translated on
   locale switch) — accepted behavior. Same for `useState(() => t(...))` default seeds
   (create-title, continuation prompt) and in-flight busy-label spinner comparisons in
   ProviderLabPanel: a locale switch mid-request shows the wrong icon until the request
   ends. All self-correcting, reviewed and accepted.
8. Vertical text columns don't apply CJK punctuation kinsoku rules (、。 can start a
   column) — pre-existing; affects editor and export equally.

## Verification workflow

```
npx tsc -b
npm test               # vitest, 82 tests
npm run lint
npm run build
npx playwright test    # 11 E2E; starts its own isolated servers; locale pinned en-US
```

E2E screenshots for visual review land in `.tmp-run/ui-preview/` (generated by
e2e/ui-preview.spec.ts as part of the suite). Test fixtures for binary image formats
live in `tests/helpers/imageFixtures.ts` — reuse them for metadata tests; use a real
raster for live vision-model tests.
