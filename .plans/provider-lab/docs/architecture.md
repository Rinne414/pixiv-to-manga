# Architecture Notes

## Current System

- Frontend: React + Vite + TypeScript.
- Canvas/editor: react-konva.
- Backend: Fastify + TypeScript.
- Storage: SQLite via `node:sqlite`, project assets on disk.
- Secrets: `keytar`; no plaintext fallback.
- Image import: local and Pixiv imports parse PNG, JPEG, WebP, and SVG dimensions before creating asset/page records.
- Pixiv E2E tests can set `PTM_PIXIV_MOCK_BASE_URL` to a loopback HTTP(S) server. Production/default imports still call Pixiv directly and still reject non-Pixiv image hosts.

## Bounded Pixiv Import Queue

- `server/pixivBatch.ts` owns preview, session-test, and persisted task lifecycle routes. The browser never sends the stored Pixiv cookie and never calls Pixiv directly.
- Preview accepts explicit artwork URLs/IDs only, reports per-artwork failures, selects at most 200 pages, and returns the effective request delay.
- Preview and download requests share one process-wide serial request queue, and download tasks share one serial task queue. The default delay is 1800 ms. `PTM_PIXIV_REQUEST_DELAY_MS=0` is reserved for tests; `PTM_PIXIV_MOCK_BASE_URL` remains restricted to loopback HTTP(S).
- SQLite tables `pixiv_tasks` and `pixiv_task_items` store resumable task/page state. Any queued/running task is marked paused when the application starts, so recovery requires an explicit resume.
- SQLite table `pixiv_import_records` records project, artwork, page, source URL/revision, asset, and page IDs. Asset, page, and import-record rows commit in one `BEGIN IMMEDIATE` transaction. A matching record skips the network request and prevents duplicate project pages.
- Pixiv 401/403/429 responses fail closed by pausing the task. The backend enforces the task `retryAt`, persists the process-wide 429 cooldown in `settings`, and restores the shared request throttle before any preview, session-test, or download request after restart. Network/5xx retries are bounded to three attempts; ordinary page failures are explicit and retained on the item.
- Page responses are streamed with a 30 MB limit and cancelled as soon as the limit is exceeded. Missing/unsupported MIME types and invalid image dimensions fail explicitly. Files use a stable task-item path and a `.part` rename before the atomic database commit, preventing concurrent page-path collisions.
- Public requests omit Cookie unless `usePixivSession` is selected. Private non-R-18 requests can opt in, while R-18 always uses the saved session. Cookie material is read from keytar only inside the backend request path and is absent from API responses, SQLite, URLs, structured logs, and asset metadata.

## Provider Lab Components

- Provider Lab UI
  - Lives inside the existing Settings inspector as two mutually exclusive workspaces: `Local LLM` and `External API`.
  - Local mode only renders trusted local profiles and keyless local setup; it does not render or submit the external Base URL/model/API-key form.
  - External mode only renders public HTTPS profiles and their write-only keys. Pixiv import access remains a separate section in both modes.
  - The default path shows only the selected connection mode, current engine, saved connections, and the required add/edit controls. Pixiv credentials are independent and collapsed below the connection workspace.
  - The old direct API route is labeled `Legacy API fallback`, appears only when legacy settings already exist and no keyed external Provider is available, and stays in its own collapsed disclosure. Provider profiles always have priority.
  - Capability-aware generation skips incompatible Provider profiles and continues to the next usable profile. The legacy route is considered only after saved profiles, so stale settings cannot block generation.
  - Existing connections render as a compact provider list. The create/edit form opens only for an explicit add/edit action, and model discovery, capability overrides, test probes, and redacted traces live in a collapsed `Advanced diagnostics` disclosure.
  - Uses typed local backend clients and adapter mapping in `src/api.ts`.
  - Shows provider metadata, model discovery output, editable capability flags, backend test results, and redacted traces.
  - API key input is write-only. The UI clears the field after save and only displays `hasApiKey`.
  - Browser never calls external model providers directly.
  - Empty/error states are shown when backend endpoints are unavailable; the UI does not simulate successful provider calls.
  - Discovery and test actions refresh `GET /api/model-capabilities` so the matrix reflects backend-upserted records immediately.
  - The legacy global API fallback keeps a separate collapsed form with backend-only `POST /api/settings/models` and `POST /api/settings/test` actions. These one-shot actions do not persist provider metadata or capability evidence; fetched model IDs populate a local model picker.

- Provider Profile Store
  - Implemented in `StudioDatabase` with the `providers` table.
  - Stored fields: `id`, `name`, `baseUrl`, `defaultModel`, `isLocal`, `createdAt`, `updatedAt`.
  - API keys are not represented in SQLite. API responses expose only `hasApiKey`.
  - Per-provider API keys live in keytar account IDs prefixed by `provider-api-key:`.
  - Provider URLs are normalized and constrained in both directions: external providers require public HTTPS; `isLocal: true` requires a loopback/private-network hostname. Stored legacy rows are also rechecked at route time.
  - AIHubMix website-root values are canonicalized to `https://aihubmix.com/v1` before persistence or use; stored rows are reconciled when Provider Lab routes register.

- Model Capability Registry
  - Implemented in `StudioDatabase` with the `model_capabilities` table.
  - Unique key: `(providerId, modelId)`.
  - Stores `supportsVision`, `supportsImageGeneration`, `supportsStreaming`, `supportsJsonSchema`, `allowsAdultInput`, `allowsAdultGeneration`, `contextWindow`, `notes`, `source`, and per-flag `capabilitySources` evidence.
  - `source` values are `discovered`, `tested`, and `user`.
  - Per-flag evidence values are `unknown`, `provider`, `tested`, `local-policy`, and `user`. Stored legacy values outside this set are normalized to `unknown` at the database boundary. A `false` value with `unknown` evidence is displayed as unknown. Adult-content and image-generation gates fail closed; unknown Vision may be tried for a safety-classified safe image, while explicit negative Vision evidence still blocks.
  - Every capability gate has a model-scoped UI override. The client submits only changed flags, and the backend marks only those fields as `user` evidence so unrelated automatic evidence is preserved.
  - Discovery reads explicit provider metadata without inferring capability from model names. Trusted local providers (`isLocal` plus loopback/private URL) automatically receive adult input/generation routing through `local-policy`. External adult routes can be established by explicit adult capability fields, `top_provider.is_moderated=false`, or a model-scoped user override. `is_moderated=true` remains unknown rather than becoming an automatic denial.
  - Existing databases add `capabilitySourcesJson` without destructive migration. Invalid legacy evidence is reset to unknown; provider, tested, local-policy, and user evidence is preserved.

- Provider Test Runner
  - Implemented in `server/providers.ts`.
  - All external provider calls happen in the backend through `fetch`.
  - Uses keytar secrets only inside the backend request path.
  - Returns structured redacted traces. Authorization, secret-like fields, cookies, tokens, image data URLs, and request-sensitive values echoed in provider responses are redacted.
  - Tests text, vision, JSON schema, and streaming support; all checks are selected by default.
  - Probe responses are structurally validated. Authentication failures, rate limits, server errors, malformed responses, and network failures remain indeterminate instead of being stored as unsupported.
  - Connection-level failures stop the remaining probes and return one structured `connectionError`; capability checks are not repeated after authentication, endpoint, rate-limit, outage, or network failure.
  - Only successful validated probes or explicit provider rejections update capability flags.

- NSFW Router
  - Implemented as pure helper `evaluateRouteSafety` in `src/shared/routeSafety.ts`.
  - Blocks illegal content, failed/unknown image safety classification, R-18 when disabled, images for non-vision models, explicit image input for models not marked adult-compatible, and R-18 generation for models without `allowsAdultGeneration`.
  - `server/ai.ts` also exposes `evaluateAiGenerationRoute`, which matches legacy global AI settings against Provider Lab provider/model metadata before external R-18 or image-capable routes.
  - `POST /api/story/analyze` and `POST /api/pages/:pageId/generate` pass `db` into the AI service; R-18 generation now fails closed unless the matching Provider Lab capability record allows adult generation.
  - When the matched model capability has `supportsStreaming`, story/page generation requests OpenAI-compatible streaming chat completions and aggregates `delta.content` chunks before JSON validation/repair.

- Story Continue Workspace
  - Implemented as a separate top-level entry in `src/StoryContinuePanel.tsx`.
  - Local/Pixiv reference inspection calls only the local backend and returns preview data URLs plus extracted metadata.
  - Metadata extraction lives in `server/imageMetadata.ts` and covers PNG text/iTXt/zTXt chunks, JPEG comment/UserComment, WebP EXIF/XMP text, SVG title/desc, and normalized A1111/ComfyUI/NovelAI shapes.
  - `POST /api/continuation/generate` builds a continuation prompt from user prompt, edited tags, and extracted metadata.
  - If no image-generation provider is configured, the backend returns local mock SVG drafts for offline development.
  - If an external provider/key is configured, the selected model must have `supportsImageGeneration: true`; R-18 routes still require `allowsAdultGeneration: true`.
  - V1 does not send reference image binary to external providers. Only extracted/edited tags and prompt text are sent to the image generation endpoint.

- Generation Job Hub
  - Implemented in `server/jobs.ts`.
  - Story analysis and page dialogue generation create local jobs and return `jobId` immediately.
  - `GET /api/jobs/:jobId/events` streams Server-Sent Events and replays recent in-memory history for clients that connect after a fast job completes.
  - `POST /api/jobs/:jobId/cancel` marks the job terminal, aborts the active `AbortController`, and prevents later progress/complete/fail calls from overwriting `cancelled`.
  - Cancelled controllers stay available briefly so workers that start right after cancellation still receive an already-aborted signal, then are cleaned up.
  - `server/ai.ts` passes the job `AbortSignal` into both initial OpenAI-compatible calls and one-shot JSON repair calls.
  - If schema validation fails after one JSON repair attempt, the job error payload includes original and repaired raw model output for local user repair.

- Editable AI Output
  - Story Bible and character edits are saved through `PUT /api/projects/:projectId/story-bible`.
  - The backend validates the full Story Bible with zod, normalizes character project IDs, fills missing character IDs, and reuses `StudioDatabase.saveStoryBible`.
  - The frontend edits synopsis, tone, page beats, R-18 flag, character name, description, voice, color, and bubble style in the inspector.

## Provider Lab Backend Data Flow

1. `server/index.ts` registers `registerProviderLabRoutes(server, { db, secrets })`.
2. Create/update provider requests validate input with zod schemas from `src/shared/schemas.ts`.
3. Provider metadata writes use parameterized SQLite statements.
4. Optional `apiKey` writes go to keytar only. Reads return `hasApiKey`.
5. Discovery calls a validated relative provider path such as `/models`, parses OpenAI-compatible/simple model shapes plus common capability metadata, and reconciles per-flag evidence without overwriting stronger test/user evidence.
6. Test calls provider `/chat/completions` with capability probes, validates the returned chat/JSON/SSE shape, upserts conclusive tested evidence only, and returns redacted traces.
7. Capability edits mark only the patched flags with `user` evidence; unrelated per-flag evidence is preserved.
8. Story/page generation tries saved Provider profiles first, skips profiles that cannot satisfy safety-critical capability requirements, and uses the legacy global route only as a fallback. A safe image may test unknown Vision support at the Provider; a successful image request records tested Vision evidence. R-18 and adult-image routes must still match provider/capability rows and fail closed on unknown adult capability evidence.
   - Provider selection accepts a stored key OR a trusted local profile (`isLocal: true` plus loopback/private URL, such as Ollama at `http://127.0.0.1:11434/v1`); requests without a key omit the `Authorization` header. Keyless public profiles are never selected, including legacy rows incorrectly marked local.
9. Generation jobs pass `AbortSignal` through the AI service before provider fetches, so cancel requests can stop external calls when supported by the runtime/provider.
10. User edits to Story Bible or characters are validated and persisted as a full Story Bible replacement.
11. Invalid AI JSON output is repaired once; if it still fails, raw output is returned through the local job event stream and surfaced in the log panel.
12. Story Continue reference inspection validates image uploads, extracts generation metadata, and keeps Pixiv cookie usage backend-only.
13. Story Continue generation checks Provider Lab image-generation capability before calling external `/images/generations`; without a configured image provider it stays local with mock output. Keyless local providers participate in target resolution the same way as keyed ones.

## Dialogue Editing

- Dialogue CRUD + layout routes live in `server/dialogues.ts` (`registerDialogueRoutes`).
- Manual bubbles: double-click the whiteboard page/background (WhiteboardCanvas `onDblClick`/`onDblTap`, page-space coordinates) or the Dialogue tab "Add dialogue" button; delete from the Dialogue tab. Defaults come from `dialogueCreateSchema` (`text: '……'`, center position).
- Generate All only regenerates pages whose status is not `complete`; completed pages (which may hold hand-edited dialogue) are skipped and the skip count is logged. When all pages are complete it logs guidance instead of regenerating.

## Character Tools & Style Prompt

- Fonts: `src/fonts.ts` owns `DEFAULT_DIALOGUE_FONT` and `FONT_PRESETS` (CJK system stacks). `Character.fontFamily` flows Characters tab select → `WhiteboardCanvas` BubbleNode → `canvasExport.drawDialogue`, so the editor and PNG export always agree. Unknown stored values render as an extra `<option>` instead of being dropped.
- Dialogue→character resolution: AI responses only carry `characterName`, so `generateDialoguesWithAi` resolves `characterId` by name before saving. Renderers resolve via `findDialogueCharacter` (`src/shared/characters.ts`): id first, name fallback — manually edited dialogues and dangling ids (after character delete) degrade to the default styling instead of crashing.
- Manual characters: Characters tab add/delete mutates the Story Bible immutably and commits via `PUT /api/projects/:projectId/story-bible`. UI mirrors `storyBibleSchema` bounds — add disabled at 20 characters, delete disabled at 1.
- Style prompt: `StoryBible.stylePrompt` (Story tab textarea, max 2000 chars) is injected into both `analyzeStoryWithAi` and `generateDialoguesWithAi` prompts as a mandatory style rule when non-empty. Stored inside `projects.storyBibleJson`, so no schema migration.

## UI Chrome (theme / i18n / whiteboard)

- Motion UI: `src/MotionUI.tsx` owns state-aware icon transitions and shared active indicators, while `src/motionTokens.ts` owns the 160 ms response curve and compact spring used by workspace switches, inspector tabs, page/provider selection, status islands, canvas tools, onboarding, and toasts. `MotionConfig` wraps the complete UI tree so both app content and overlays honor `prefers-reduced-motion`.
- Theme: `src/theme.ts` `useTheme` writes `<html data-theme="light|dark">`; `index.html` applies the persisted/OS theme before first paint. All colors flow through CSS custom properties in `src/index.css` with a `:root[data-theme='dark']` override block. Preference persists in `localStorage` (`ptm-theme`, non-secret).
- i18n: `src/i18n/` holds a dependency-free dictionary layer (`en` / `zh-TW`). `I18nProvider` + `useI18n().t(key, params)`; strings live in `src/i18n/strings/{common,providerLab,storyContinue}.ts`. Locale persists in `localStorage` (`ptm-locale`) and auto-detects `zh*` browsers. Playwright pins `locale: 'en-US'` because the E2E suite asserts English copy.
- Whiteboard: `src/WhiteboardCanvas.tsx` renders the active page on an infinite pan/zoom Konva stage (wheel zoom anchored at cursor, background drag pans, fit/100% controls). Bubble geometry mirrors `canvasExport.drawDialogue` (page-pixel space) so the editor is WYSIWYG with PNG export. The Layout tab zoom slider drives the same zoom state (0.1–4).
- Project lettering defaults: `projects.letteringJson` stores the shared font, scale, default text color, and SFX outline settings. The Settings inspector exposes separate save-defaults and apply-to-existing actions; a backend character-color action updates existing lines only when explicitly requested. Generated lines inherit project defaults and resolve character colors before persistence.
- Non-destructive cleanup: `pages.cleanupJson` stores normalized `mosaic`/`paint` strokes. The Whiteboard cleanup tools append or erase strokes without modifying the original asset. `src/canvasExport.ts` draws the cleanup layer after the source image and before dialogue, so PNG, ZIP, CBZ, PDF, reader preview, and future render consumers share the same layer order.

## Provider Lab Frontend Data Flow

1. Settings tab mounts `ProviderLabPanel`.
2. UI calls local backend:
   - `GET /api/providers`
   - `GET /api/model-capabilities`
3. Create/edit forms send provider metadata plus optional write-only `apiKey` to backend.
4. Model discovery and test controls call backend-only endpoints.
5. Capability matrix overrides can patch any of the six routing flags and submit only values changed for the selected model.
6. Capability status is rendered per flag as supported, unsupported, or unknown. NSFW route state is derived from provider locality, provider policy metadata, and model-scoped overrides:
   - no vision means image payloads are blocked;
   - external provider without positive adult-input evidence blocks R-18 image input;
   - missing adult-generation flag blocks R-18 generation.
7. Analyze Story, Generate Page, and Generate All call local POST endpoints, store the returned `jobId`, subscribe to SSE until a terminal event, and expose a toolbar Cancel action for the active job.
8. Story and Characters inspector tabs update local state immediately and save the edited Story Bible back to the backend on commit.
9. Story Continue entry manages its own reference list, editable tags, continuation prompt, generated previews, and expanded prompt readout.
