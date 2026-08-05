# API Contracts

## Existing API

- `GET /api/settings/secrets`
- `PUT /api/settings/secrets`
- `POST /api/settings/models`
- `POST /api/settings/test`
- `POST /api/story/analyze`
- `PUT /api/projects/:projectId/story-bible`
- `POST /api/pages/:pageId/generate`
- `POST /api/continuation/references/local`
- `POST /api/continuation/references/pixiv`
- `POST /api/continuation/generate`
- `GET /api/jobs/:jobId/events`
- `POST /api/jobs/:jobId/cancel`

## Bounded Pixiv Batch Import API

The browser calls only these local routes. Pixiv cookies remain in keytar and are never included in task, error, project, log, or preview payloads. The existing single-artwork `POST /api/import/pixiv` route remains available.

### `POST /api/import/pixiv/preview`

Resolves up to 50 explicit Pixiv artwork URLs/IDs into a selectable page list. At most 200 pages are selected, and invalid/inaccessible artworks return an artwork-scoped `error` instead of hiding the failure.

Request:

```json
{ "urls": ["https://www.pixiv.net/artworks/123456"], "r18Enabled": false, "usePixivSession": false, "maxImages": 200 }
```

Response:

```json
{
  "artworks": [{
    "artworkId": "123456",
    "artworkUrl": "https://www.pixiv.net/artworks/123456",
    "pageCount": 1,
    "pages": [{ "artworkId": "123456", "pageIndex": 0, "sourceUrl": "https://i.pximg.net/...", "fileName": "pixiv-123456-001", "selected": true }]
  }],
  "totalPages": 1,
  "selectedPages": 1,
  "maxImages": 200,
  "requestDelayMs": 1800
}
```

### `POST /api/import/pixiv/tasks`

Creates a persisted sequential download task and starts it in the background. `pages` must contain between 1 and 200 entries. Omitting `projectId` creates a new Pixiv project.

```json
{
  "projectId": "optional-existing-project-id",
  "title": "Optional project/task title",
  "r18Enabled": false,
  "usePixivSession": false,
  "pages": [{ "artworkId": "123456", "pageIndex": 0, "sourceUrl": "https://i.pximg.net/...", "fileName": "pixiv-123456-001" }],
  "requestDelayMs": 1800
}
```

Returns a `PixivBatchTask` including page items. Task statuses are `queued`, `running`, `paused`, `completed`, `cancelled`, and `failed`; item statuses are `queued`, `downloading`, `complete`, `skipped`, and `failed`.

### Task lifecycle

- `GET /api/import/pixiv/tasks/:id` returns the persisted task and all page item states.
- `GET /api/import/pixiv/tasks?projectId=:id` returns up to 10 queued/running/paused/failed tasks so the project UI can restore unfinished work after navigation or restart.
- `POST /api/import/pixiv/tasks/:id/pause` pauses before the next page and aborts an active request.
- `POST /api/import/pixiv/tasks/:id/resume` resumes queued work.
- `POST /api/import/pixiv/tasks/:id/cancel` terminates the task.
- `POST /api/import/pixiv/tasks/:id/retry` requeues failed items.
- `GET /api/pixiv/session/test` validates the saved Pixiv session and returns only `{ status, message, httpStatus?, canImportPublic, canImportPrivate }`. Status is `not_configured`, `authenticated`, `unauthenticated`, `rate_limited`, or `error`.

`usePixivSession` opts private non-R-18 requests into the saved Pixiv session. Public requests omit Cookie by default; R-18 forces session use. Pixiv 401, 403, and 429 responses pause the task with `pauseReason` and optional `retryAt`. A resume request made before a 429 `retryAt` is rejected with HTTP 429 by the backend, even if the browser control is bypassed. Network errors and 5xx responses use at most three attempts. Other page failures remain attached to that page and do not silently disappear. Imports are de-duplicated within a project by artwork ID, page index, source URL, and source revision.

### Project lettering and cleanup contracts

- `PATCH /api/projects/:id` accepts `readingDirection`, `letteringDefaults`, `applyLetteringToExisting`, and `colorDialoguesByCharacter`.
- `letteringDefaults` is `{ fontFamily?, scale, color, sfxStrokeColor, sfxStrokeWidth }`. Saving defaults does not alter existing dialogue unless `applyLetteringToExisting` is `true`.
- `colorDialoguesByCharacter: true` updates every dialogue with a resolvable character to that character's color.
- `PUT /api/pages/:pageId/panels` remains the panel-frame contract; `PUT /api/pages/:pageId/cleanup` stores normalized, non-destructive cleanup strokes.
- Cleanup payloads are `{ cleanupStrokes: [{ mode: 'mosaic' | 'paint', points: [{x, y}], size, intensity, color }] }`; coordinates are normalized to `[0, 1]` and the backend validates all bounds.
- Browser clients only call these local API routes. Rendered preview/export consumes the same cleanup and lettering data, and secrets are not included in either payload.

## Provider Lab API

Frontend status: `src/api.ts` includes typed clients for the endpoints below. Backend implementation is now available in `server/providers.ts`.

### `POST /api/settings/models`

Performs one-shot model discovery for the legacy global API settings form. The local backend handles the provider request without creating or updating a Provider profile. A supplied `apiKey` is write-only for this request; when it is empty, the saved legacy key is used.

Request:

```json
{
  "apiBaseUrl": "https://api.openai.com/v1",
  "apiKey": "write-only optional secret"
}
```

Response contains only model metadata and a redacted trace:

```json
{
  "models": [{ "id": "gpt-4o", "name": "gpt-4o", "ownedBy": "openai" }],
  "trace": { "request": {}, "response": {}, "latencyMs": 120 }
}
```

### `POST /api/settings/test`

Runs a one-shot text completion test for the legacy global API settings form. It never persists the submitted values or capability records. The browser only calls this local endpoint.

Request:

```json
{
  "apiBaseUrl": "https://api.openai.com/v1",
  "modelName": "gpt-4o",
  "apiKey": "write-only optional secret"
}
```

Response uses the same redacted probe shape as Provider Lab tests, with `providerId: "legacy-settings"` and only the `text` result.

### `GET /api/providers`

Returns saved provider profile metadata and secret status. Must not return API keys.

Response:

```json
{
  "providers": [
    {
      "id": "provider-id",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "defaultModel": "gpt-4o",
      "isLocal": false,
      "hasApiKey": true,
      "createdAt": "2026-06-20T00:00:00.000Z",
      "updatedAt": "2026-06-20T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/providers`

Creates a provider profile. Non-secret metadata goes to SQLite. API key goes to keytar.

Provider URL safety:

- `baseUrl` is normalized by trimming trailing slashes.
- The known AIHubMix website root `https://aihubmix.com` is canonicalized to its OpenAI-compatible API root `https://aihubmix.com/v1` for new, existing, test, discovery, and generation routes.
- External providers (`isLocal: false`) must use public `https://` URLs.
- Local HTTP URLs such as `http://127.0.0.1:11434/v1` are allowed only when `isLocal: true`.
- External providers cannot target localhost or private network hosts.
- Local providers must target loopback/private-network hosts; a public endpoint cannot become trusted merely by setting `isLocal: true`.

Request:

```json
{
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "defaultModel": "gpt-4o",
  "isLocal": false,
  "apiKey": "write-only optional secret"
}
```

Response: `{ "provider": ProviderProfile }`. `apiKey` is never returned.

### `PATCH /api/providers/:id`

Updates provider metadata and optionally replaces API key. API key is write-only.

Request: partial `POST /api/providers` body. Empty or omitted `apiKey` keeps the existing key.

Response: `{ "provider": ProviderProfile }`. `apiKey` is never returned.

### `DELETE /api/providers/:id`

Deletes provider metadata and associated keytar secret.

Response:

```json
{ "ok": true }
```

### `POST /api/providers/:id/models/discover`

Calls provider `/models` by default, or a caller-provided relative path, and stores/returns candidate model capability records.

`path` must be a relative path beginning with `/`. Absolute URLs and protocol-relative URLs are rejected.

Request:

```json
{
  "path": "/models"
}
```

Authentication failures, missing chat endpoints, rate limits, provider outages, and network failures are connection-level errors rather than model-capability evidence. The runner stops the remaining probes after the first such failure and returns one optional `connectionError`:

```json
{
  "connectionError": {
    "code": "authentication_or_base_url",
    "message": "Authentication failed. Check the API key and confirm the Base URL points to the provider API.",
    "status": 401
  }
}
```

Full redacted traces remain available for diagnostics, but the frontend keeps them collapsed by default.

Response:

```json
{
  "models": [
    {
      "id": "capability-id",
      "providerId": "provider-id",
      "modelId": "gpt-4o",
      "supportsVision": true,
      "supportsImageGeneration": false,
      "supportsStreaming": true,
      "supportsJsonSchema": true,
      "allowsAdultInput": false,
      "allowsAdultGeneration": false,
      "contextWindow": 128000,
      "notes": "owned_by=openai",
      "source": "discovered",
      "capabilitySources": {
        "supportsVision": "provider",
        "supportsImageGeneration": "unknown",
        "supportsStreaming": "provider",
        "supportsJsonSchema": "provider",
        "allowsAdultInput": "unknown",
        "allowsAdultGeneration": "unknown"
      },
      "createdAt": "2026-06-20T00:00:00.000Z",
      "updatedAt": "2026-06-20T00:00:00.000Z"
    }
  ],
  "trace": {
    "request": { "method": "GET", "url": "https://api.openai.com/v1/models", "headers": {} },
    "response": { "status": 200, "body": {} },
    "latencyMs": 123
  }
}
```

Accepted provider response shapes: OpenAI-compatible `{ "data": [{ "id": "..." }] }`, `{ "models": [...] }`, and simple arrays. Common explicit metadata is parsed from capability booleans, input/output modalities, supported parameters, context-window fields, and provider moderation metadata. Unrecognized fields are ignored. `top_provider.is_moderated=false` is positive provider-policy evidence for adult routing; `true` remains indeterminate rather than being treated as a blanket denial.

The backend does not infer capability from model IDs. Local profiles set adult input/generation evidence to `local-policy`; external adult capabilities can come from explicit provider fields, unmoderated provider metadata, or a user override. Historical `model-id` evidence is reset to unknown while provider/test/user evidence is preserved.

### `POST /api/providers/:id/test`

Runs backend-only provider capability tests. Browser clients never call external LLM providers directly with secrets.

When `tests` is omitted, all safe checks (`text`, `vision`, `json`, and `streaming`) run. The default vision request uses a valid minimal PNG.

Request:

```json
{
  "modelId": "gpt-4o",
  "tests": ["text", "vision", "json", "streaming"],
  "imageDataUrl": "data:image/png;base64,..."
}
```

Response:

```json
{
  "providerId": "provider-id",
  "modelId": "gpt-4o",
  "ok": true,
  "results": [
    { "kind": "text", "ok": true, "outcome": "supported", "status": 200, "latencyMs": 120 }
  ],
  "inferredCapabilities": {
      "modelId": "gpt-4o",
      "supportsVision": false,
      "supportsImageGeneration": false,
      "supportsStreaming": true,
    "supportsJsonSchema": true,
    "allowsAdultInput": false,
    "allowsAdultGeneration": false,
    "contextWindow": 128000,
    "notes": "Updated from provider capability checks.",
    "source": "tested",
    "capabilitySources": {
      "supportsVision": "tested",
      "supportsImageGeneration": "unknown",
      "supportsStreaming": "tested",
      "supportsJsonSchema": "tested",
      "allowsAdultInput": "unknown",
      "allowsAdultGeneration": "unknown"
    }
  },
  "trace": [
    {
      "request": { "method": "POST", "url": "https://api.openai.com/v1/chat/completions", "headers": {}, "body": {} },
      "response": { "status": 200, "body": {} },
      "latencyMs": 120
    }
  ]
}
```

Trace redaction:

- `Authorization`, API key, cookie, token, and secret-looking fields become `[redacted]`.
- Image data URLs become `[redacted image payload]`.
- Known sensitive values from the request, including bearer tokens and image payload/base64 segments, are also removed from provider response traces if the provider echoes them.
- Full API keys and full image payloads must never appear in responses.
- `outcome` is `supported`, `unsupported`, or `indeterminate`. Only supported or explicit unsupported results update stored capability evidence.
- HTTP 401/403/408/429/5xx, network failures, and malformed success responses are indeterminate and never downgrade a model to unsupported.
- Provider tests do not send adult content. Adult capability comes from local policy, explicit provider metadata, unmoderated provider metadata, or a model-scoped user override.

### `GET /api/model-capabilities`

Returns stored capability records. Optional query: `providerId`.

Response:

```json
{
  "capabilities": [
    {
      "id": "capability-id",
      "providerId": "provider-id",
      "modelId": "gpt-4o",
      "supportsVision": true,
      "supportsImageGeneration": false,
      "supportsStreaming": true,
      "supportsJsonSchema": true,
      "allowsAdultInput": false,
      "allowsAdultGeneration": false,
      "contextWindow": 128000,
      "notes": "",
      "source": "tested",
      "capabilitySources": {
        "supportsVision": "tested",
        "supportsImageGeneration": "unknown",
        "supportsStreaming": "tested",
        "supportsJsonSchema": "tested",
        "allowsAdultInput": "unknown",
        "allowsAdultGeneration": "unknown"
      },
      "createdAt": "2026-06-20T00:00:00.000Z",
      "updatedAt": "2026-06-20T00:00:00.000Z"
    }
  ]
}
```

`source` values remain `discovered`, `tested`, and `user` for compatibility. `capabilitySources` is authoritative per flag and uses `unknown`, `provider`, `tested`, `local-policy`, or `user`. Stored legacy values outside this set, including `model-id`, are normalized to `unknown` at the database boundary and cleaned during startup reconciliation.

### `PATCH /api/model-capabilities/:id`

Updates user-confirmed capability flags.

Request:

```json
{
  "supportsVision": true,
  "supportsImageGeneration": false,
  "supportsStreaming": true,
  "supportsJsonSchema": true,
  "allowsAdultInput": false,
  "allowsAdultGeneration": false,
  "contextWindow": 128000,
  "notes": "User confirmed."
}
```

Response: `{ "capability": ModelCapability }`. All six routing flags are model-scoped escape hatches. The backend marks only capability flags present in the patch as `user` evidence; unrelated detected/tested sources remain unchanged.

## Story Continue API

Story Continue is a separate workspace entry for reference-image-driven continuation drafts. Browser clients call only the local backend. API keys, Pixiv cookies, and provider calls remain backend-only.

### `POST /api/continuation/references/local`

Multipart upload field: `files`.

The backend validates image MIME/size, reads dimensions, extracts generation metadata, and returns reference objects with preview data URLs for local display. Supported extraction includes PNG text/iTXt/zTXt chunks, JPEG comment/UserComment, WebP EXIF/XMP text, SVG title/desc, and normalized A1111/ComfyUI/NovelAI metadata shapes.

Response:

```json
{
  "references": [
    {
      "id": "reference-id",
      "fileName": "page.png",
      "mimeType": "image/png",
      "width": 768,
      "height": 1024,
      "source": "upload",
      "previewDataUrl": "data:image/png;base64,...",
      "tags": ["same heroine", "school rooftop"],
      "metadata": {
        "format": "a1111",
        "positivePrompt": "same heroine, school rooftop",
        "negativePrompt": "low quality",
        "tags": ["same heroine", "school rooftop"],
        "raw": {},
        "settings": {},
        "sourceFields": ["parameters"]
      }
    }
  ]
}
```

### `POST /api/continuation/references/pixiv`

Downloads Pixiv pages through the backend and applies the same reference inspection. R-18 imports require the saved Pixiv cookie.

Request:

```json
{
  "url": "https://www.pixiv.net/artworks/123456789",
  "r18Enabled": false,
  "maxPages": 4
}
```

Response shape is the same as local reference inspection.

### `POST /api/continuation/generate`

Builds an expanded continuation prompt from user prompt, edited tags, and extracted metadata. If no image-generation provider is configured, the backend returns local mock SVG drafts. If an external provider/key is configured, the matching Provider Lab model capability must set `supportsImageGeneration: true`; R-18 routes additionally require `allowsAdultGeneration: true`.

Request:

```json
{
  "prompt": "Continue with the heroine opening the letter.",
  "r18Enabled": false,
  "outputCount": 1,
  "keepCharacterConsistency": true,
  "keepBackgroundConsistency": true,
  "references": []
}
```

Response:

```json
{
  "images": [
    {
      "id": "image-id",
      "mimeType": "image/png",
      "dataUrl": "data:image/png;base64,...",
      "prompt": "expanded prompt",
      "usedMock": false
    }
  ],
  "expandedPrompt": "expanded prompt",
  "usedMock": false,
  "routeTrace": ["Generated with Provider / model."]
}
```

Current v1 continuation behavior:

- Reference image binary is not sent to external providers; extracted/edited tags and prompt text are used for consistency.
- External image generation uses OpenAI-compatible `POST /images/generations` with `response_format: "b64_json"`.
- Unknown image-generation capability fails closed with `image_generation_capability_unknown`; an explicitly unsupported capability uses `image_generation_required`.

## Dialogue CRUD

Routes live in `server/dialogues.ts` (extracted from `server/index.ts`; also hosts the pre-existing PATCH dialogue/layout routes).

### `POST /api/pages/:pageId/dialogues`

Creates a manual dialogue bubble on a page. Body: `dialogueCreateSchema` — every field optional; `text` defaults to `……`, position defaults to page center (0.5/0.5). 400 when the page does not exist or coordinates are out of range.

Response: the created `Dialogue`.

### `DELETE /api/dialogues/:id`

Deletes one dialogue. Response `{ "ok": true }`; 400 when the id does not exist.

## Keyless Local Providers (Ollama / LM Studio)

Trusted local providers are usable without a stored API key. Trust requires both `isLocal: true` and a loopback/private-network URL:

- `resolveAiTarget` (server/ai.ts) and `resolveImageGenerationTarget` (server/continuation.ts) accept a provider when it has a keytar key OR passes the trusted-local URL check.
- When no key exists, backend requests omit the `Authorization` header entirely (chat completions, image generations, discovery, and tests all share this rule via empty-key handling).
- Public providers still require a key even if a legacy database row incorrectly has `isLocal: true`; keyless public profiles are skipped.
- A keyless local provider whose default model explicitly lacks `supportsImageGeneration` still fails continuation closed with `image_generation_required`; unknown evidence uses `image_generation_capability_unknown`.
- Local adult input/generation route capability is automatic (`local-policy`), but each project's R-18 switch remains default-off and explicit.
- Typical Ollama profile: `baseUrl: http://127.0.0.1:11434/v1`, `isLocal: true`, no key, default model discovered via `/models`.

## Frontend Adapter Shapes

`src/api.ts` intentionally normalizes some backend responses for UI components:

- `POST /api/providers` and `PATCH /api/providers/:id`: unwrap `{ "provider": ProviderProfile }` to `ProviderProfile`.
- `PATCH /api/model-capabilities/:id`: unwrap `{ "capability": ModelCapability }` to `ModelCapability`.
- `POST /api/providers/:id/models/discover`: maps returned `ModelCapability[]` to UI `DiscoveredModel[]` using `modelId` as `id`.
- `POST /api/providers/:id/test`: converts checkbox state `{ text, vision, json, streaming }` into backend `tests: string[]`, then maps backend `ok/results/trace` into UI `passed/results/redactedTrace`.

## Story/Page Generation Safety Gate

`POST /api/story/analyze` and `POST /api/pages/:pageId/generate` use saved Provider profiles first. The legacy global OpenAI-compatible settings from `PUT /api/settings/secrets` are considered only when no saved Provider route is usable. Before external R-18 or adult-image calls, the server checks Provider Lab safety metadata. A safety-classified safe image may be sent when Vision evidence is unknown so the Provider can return an authoritative result.

`PUT /api/projects/:projectId/story-bible` saves user-edited AI output. The request body is a full `StoryBible` object validated by schema. Backend normalizes character `projectId` and fills any missing character IDs before persisting.

`storyBibleSchema` optional fields (no migration needed; the bible is stored as a JSON blob in `projects.storyBibleJson`):

- `stylePrompt?: string` (max 2000 chars) — reusable style rules. When present (after trim), both `analyzeStoryWithAi` and `generateDialoguesWithAi` inject it into the prompt as `风格要求（必须遵守）：<stylePrompt>。`. Re-analysis (`POST /api/story/analyze`) preserves the saved value: the model/mock response never includes `stylePrompt`, so the server re-attaches it before persisting.
- `characters[].fontFamily?: string` (max 300 chars) — CSS font-family stack used by the whiteboard bubble renderer and PNG export (`canvasExport`). Empty/absent falls back to `DEFAULT_DIALOGUE_FONT` from `src/fonts.ts`; UI presets live in `FONT_PRESETS` (same file).
- `characters` stays `min(1).max(20)`; the Characters panel mirrors these bounds (add disabled at 20, delete disabled at 1).

Response: updated `ProjectDetail`.

Both endpoints are asynchronous local jobs. The POST response returns immediately:

```json
{
  "jobId": "job-id"
}
```

Clients then subscribe to `GET /api/jobs/:jobId/events`, which is a local Server-Sent Events stream. Each event is sent as a `data:` JSON payload:

```json
{
  "jobId": "job-id",
  "type": "progress",
  "progress": 0.45,
  "message": "Generating Page 1"
}
```

Terminal event types are `complete`, `error`, and `cancelled`. On `complete`, `payload` contains the updated `ProjectDetail` plus optional `raw` and `usedMock` fields:

```json
{
  "jobId": "job-id",
  "type": "complete",
  "progress": 1,
  "message": "Dialogue generated",
  "payload": {
    "project": {},
    "pages": [],
    "assets": [],
    "characters": [],
    "dialogues": [],
    "raw": "{}",
    "usedMock": false
  }
}
```

On `error`, `payload` may contain raw model output for user repair when JSON schema validation fails after one repair attempt:

```json
{
  "jobId": "job-id",
  "type": "error",
  "progress": 1,
  "message": "Failed",
  "error": "AI output could not be parsed after repair",
  "payload": {
    "raw": "original invalid model output",
    "repairedRaw": "repair attempt output",
    "schemaHint": "Expected JSON shape"
  }
}
```

`POST /api/jobs/:jobId/cancel` aborts the active job and returns:

```json
{ "ok": true }
```

The backend keeps recent job events in memory so fast mock jobs can be replayed to clients that connect after the job already completed. Browser clients wait for the SSE terminal event and do not call external providers directly.

When the selected Provider Lab capability record has `supportsStreaming: true`, the backend may call the OpenAI-compatible `/chat/completions` endpoint with `stream: true` and aggregate streamed `delta.content` chunks into the JSON string before schema validation. Browser clients still receive only local job events and the final parsed project payload.

Current v1 behavior:

- Non-R-18 text-only generation prefers a usable Provider profile and may use the legacy global model settings only as a fallback.
- Capability-aware generation skips usable-but-incompatible Provider profiles and tries the next profile before returning a blocking error.
- A legacy global R-18 or adult-image route still requires a matching Provider Profile whose normalized `baseUrl` and `defaultModel` provide adult capability evidence. A safe image route may try unknown Vision support.
- The matching model capability record must have `allowsAdultGeneration: true`.
- Missing or unknown adult evidence returns a distinct `*_capability_unknown` reason. Unknown Vision does not block a safe image request; successful image calls persist tested Vision evidence, while explicit negative Vision evidence returns `vision_required`.
- Story Continue external image generation requires `supportsImageGeneration: true`; future routes that send reference image binary externally must also require `supportsVision: true`, and explicit/suggestive image routes must have `allowsAdultInput: true`.
- Unknown or failed image safety classification blocks image routing.

Blocked requests return HTTP 400 with:

```json
{
  "error": "AI route blocked by provider safety policy: adult_generation_not_allowed"
}
```
