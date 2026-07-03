# Agent Handoff Notes

Last updated: 2026-07-04. Written after shipping the Story Continue feature plus a full
code review and fix pass (10 confirmed findings, all resolved). Everything below is
verified green: `npx tsc -b`, `npm test` (77 tests), `npm run lint`, `npm run build`,
`npx playwright test` (8 E2E).

## What just landed

Story Continue mode: upload/Pixiv-import reference images, extract generation metadata
(A1111 / NovelAI / ComfyUI, from PNG/JPEG/WebP/SVG), and generate continuation drafts via
an image-capable provider or a local mock.

## Architecture decisions you should not accidentally undo

- **Provider resolution is shared.** `server/providerResolution.ts` is the single source
  for provider/capability matching (`findMatchingProvider`, `findMatchingCapability`,
  `normalizeBaseUrl`, `normalizeModelId`). Both `server/ai.ts` and
  `server/continuation.ts` import it. Do not re-inline copies — they drifted once and it
  caused real bugs.
- **Generate requests never carry image bytes.** `continuationReferenceSchema`
  (src/shared/schemas.ts) deliberately omits `previewDataUrl`; the client strips it via
  `toReferenceInput` in `StoryContinuePanel.tsx`. Zod silently drops the field if an old
  client still sends it. Previews exist only in the inspect response for thumbnails.
- **Schema limits are the source of truth.** `CONTINUATION_LIMITS` and
  `GENERATION_METADATA_LIMITS` in src/shared/schemas.ts drive both the zod schemas and
  the UI caps. `server/imageMetadata.ts` clamps every parser result through
  `clampMetadataToSchemaLimits` so an inspect response can never fail its own
  /generate validation. If you add a metadata field, add its limit there, not inline.
- **Image-generation target selection fails closed on purpose.**
  `resolveImageGenerationTarget` (server/continuation.ts) picks the first keyed provider
  whose default-model capability has `supportsImageGeneration`. If keyed providers exist
  but none can generate images → 400 `image_generation_required`. If nothing usable is
  configured at all → local mock. Global Settings without a matching Provider Lab
  profile also falls back to mock (do not restore the old hard-throw).
- **Capability upserts must not clobber user data.** `testProvider`/`discoverModels`
  (server/providers.ts) only update flags for test kinds that actually ran; discovery
  only seeds rows for unseen models; `supportsImageGeneration` and adult flags are
  name-inference/user-only and are preserved on existing rows; `source: 'user'` is
  sticky. `db.upsertModelCapability` filters `undefined` inputs — keep that.
- **Safety classification excludes negative prompts.**
  `buildSafetyClassificationText` (server/continuation.ts) classifies user prompt + tags
  + positive prompts only. Negative prompts ("Avoid: nsfw, ...") describe what must NOT
  appear; matching them blocked ordinary SFW references.
- **Pixiv import streams.** `forEachPixivArtworkImage` (server/importers.ts) hands over
  one page buffer at a time; the import path writes each page to disk immediately.
  `downloadPixivArtworkImages` buffers and is only safe for callers that cap `maxPages`
  (the continuation flow, max 8).
- **EXIF is parsed as binary TIFF.** `readExifMetadata` in server/imageMetadata.ts walks
  IFD0 → Exif IFD for UserComment (0x9286), ImageDescription, XPComment. UTF-16 byte
  order is auto-detected by an ASCII-weighted printable score (A1111 writes UTF-16BE).
  Do not replace with string-searching the payload — that never worked.

## Known debts (deliberately deferred)

1. `src/App.tsx` (~1350 lines) and `src/index.css` (~1220 lines) exceed the 800-line
   guideline. Next structural task: extract a `StudioWorkspace` component so App renders
   `entryMode === 'continue' ? <StoryContinuePanel/> : <StudioWorkspace/>`, and split
   Story-Continue CSS into a feature-scoped file. Do it as an isolated refactor — E2E
   selectors (`data-testid`) must keep working.
2. Inspect responses still ship full-resolution base64 previews to the browser for
   thumbnails. Fine for a localhost single-user tool; if large references become common,
   store references through the existing asset pipeline and serve URLs instead.
3. `server/secrets.ts` has its own `normalizeBaseUrl` (settings input normalizer) that
   was not consolidated into providerResolution — semantically similar, low risk.
4. `StoryContinuePanel` keeps a local `loadingLabel` state that mirrors App's busy
   label; harmless duplication, candidate for cleanup during the App.tsx split.
5. JIS-encoded EXIF UserComment is unsupported (rare; degrades to no metadata).
6. No rate limiting anywhere — accepted convention for a 127.0.0.1-only tool.

## Verification workflow

```
npx tsc -b
npm test
npm run lint
npm run build
npx playwright test   # starts its own server; uses PTM_PIXIV_MOCK_BASE_URL for Pixiv
```

Test fixtures for binary image formats (PNG chunks, JPEG/WebP EXIF builders) live in
`tests/helpers/imageFixtures.ts` — reuse them, do not hand-roll new byte builders in
individual test files.
