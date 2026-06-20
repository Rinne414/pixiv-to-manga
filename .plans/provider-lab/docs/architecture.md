# Architecture Notes

## Current System

- Frontend: React + Vite + TypeScript.
- Canvas/editor: react-konva.
- Backend: Fastify + TypeScript.
- Storage: SQLite via `node:sqlite`, project assets on disk.
- Secrets: `keytar`; no plaintext fallback.
- Image import: local and Pixiv imports parse PNG, JPEG, WebP, and SVG dimensions before creating asset/page records.

## Provider Lab Components

- Provider Lab UI
  - Lives inside the existing Settings inspector, below the current credential settings.
  - Uses typed local backend clients and adapter mapping in `src/api.ts`.
  - Shows provider metadata, model discovery output, editable capability flags, backend test results, and redacted traces.
  - API key input is write-only. The UI clears the field after save and only displays `hasApiKey`.
  - Browser never calls external model providers directly.
  - Empty/error states are shown when backend endpoints are unavailable; the UI does not simulate successful provider calls.
  - Discovery and test actions refresh `GET /api/model-capabilities` so the matrix reflects backend-upserted records immediately.

- Provider Profile Store
  - Implemented in `StudioDatabase` with the `providers` table.
  - Stored fields: `id`, `name`, `baseUrl`, `defaultModel`, `isLocal`, `createdAt`, `updatedAt`.
  - API keys are not represented in SQLite. API responses expose only `hasApiKey`.
  - Per-provider API keys live in keytar account IDs prefixed by `provider-api-key:`.
  - Provider URLs are normalized and constrained: external providers require public HTTPS; local HTTP/private network endpoints require `isLocal: true`.

- Model Capability Registry
  - Implemented in `StudioDatabase` with the `model_capabilities` table.
  - Unique key: `(providerId, modelId)`.
  - Stores `supportsVision`, `supportsStreaming`, `supportsJsonSchema`, `allowsAdultInput`, `allowsAdultGeneration`, `contextWindow`, `notes`, and `source`.
  - `source` values are `discovered`, `tested`, and `user`.
  - Adult capability flags default to `false` and require user confirmation.

- Provider Test Runner
  - Implemented in `server/providers.ts`.
  - All external provider calls happen in the backend through `fetch`.
  - Uses keytar secrets only inside the backend request path.
  - Returns structured redacted traces. Authorization, secret-like fields, cookies, tokens, image data URLs, and request-sensitive values echoed in provider responses are redacted.
  - Tests text, vision, JSON schema, and streaming support where selected.

- NSFW Router
  - Implemented as pure helper `evaluateRouteSafety` in `src/shared/routeSafety.ts`.
  - Blocks illegal content, failed/unknown image safety classification, R-18 when disabled, images for non-vision models, explicit image input for models not marked adult-compatible, and R-18 generation for models without `allowsAdultGeneration`.
  - `server/ai.ts` also exposes `evaluateAiGenerationRoute`, which matches legacy global AI settings against Provider Lab provider/model metadata before external R-18 or image-capable routes.
  - `POST /api/story/analyze` and `POST /api/pages/:pageId/generate` pass `db` into the AI service; R-18 generation now fails closed unless the matching Provider Lab capability record allows adult generation.

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
5. Discovery calls a validated relative provider path such as `/models`, parses OpenAI-compatible/simple model shapes, and upserts conservative capability records.
6. Test calls provider `/chat/completions` with selected capability probes, upserts tested capability records, and returns redacted traces.
7. Capability edits patch SQLite records and default `source` to `user`.
8. Story/page generation checks legacy global settings against provider/capability rows before R-18 external calls.
9. Generation jobs pass `AbortSignal` through the AI service before provider fetches, so cancel requests can stop external calls when supported by the runtime/provider.
10. User edits to Story Bible or characters are validated and persisted as a full Story Bible replacement.
11. Invalid AI JSON output is repaired once; if it still fails, raw output is returned through the local job event stream and surfaced in the log panel.

## Provider Lab Frontend Data Flow

1. Settings tab mounts `ProviderLabPanel`.
2. UI calls local backend:
   - `GET /api/providers`
   - `GET /api/model-capabilities`
3. Create/edit forms send provider metadata plus optional write-only `apiKey` to backend.
4. Model discovery and test controls call backend-only endpoints.
5. Capability matrix edits patch stored capability records.
6. NSFW route hint is derived from selected provider locality and capability flags:
   - no vision means image payloads are blocked;
   - external provider without adult-input flag blocks R-18 image input;
   - missing adult-generation flag blocks R-18 generation.
7. Analyze Story, Generate Page, and Generate All call local POST endpoints, store the returned `jobId`, subscribe to SSE until a terminal event, and expose a toolbar Cancel action for the active job.
8. Story and Characters inspector tabs update local state immediately and save the edited Story Bible back to the backend on commit.
