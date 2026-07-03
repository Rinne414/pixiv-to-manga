# API Contracts

## Existing API

- `GET /api/settings/secrets`
- `PUT /api/settings/secrets`
- `POST /api/story/analyze`
- `PUT /api/projects/:projectId/story-bible`
- `POST /api/pages/:pageId/generate`
- `POST /api/continuation/references/local`
- `POST /api/continuation/references/pixiv`
- `POST /api/continuation/generate`
- `GET /api/jobs/:jobId/events`
- `POST /api/jobs/:jobId/cancel`

## Provider Lab API

Frontend status: `src/api.ts` includes typed clients for the endpoints below. Backend implementation is now available in `server/providers.ts`.

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
- External providers (`isLocal: false`) must use public `https://` URLs.
- Local HTTP URLs such as `http://127.0.0.1:11434/v1` are allowed only when `isLocal: true`.
- External providers cannot target localhost or private network hosts.

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

Accepted provider response shapes: OpenAI-compatible `{ "data": [{ "id": "..." }] }`, `{ "models": [...] }`, and simple arrays. Adult capability flags default to `false`.

### `POST /api/providers/:id/test`

Runs backend-only provider capability tests. Browser clients never call external LLM providers directly with secrets.

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
    { "kind": "text", "ok": true, "status": 200, "latencyMs": 120 }
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
    "notes": "Updated from provider test endpoint. Adult capability remains user-confirmed only.",
    "source": "tested"
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
- Provider tests do not auto-enable adult capability flags; those remain user-confirmed.

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
      "createdAt": "2026-06-20T00:00:00.000Z",
      "updatedAt": "2026-06-20T00:00:00.000Z"
    }
  ]
}
```

`source` values: `discovered`, `tested`, `user`.

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

Response: `{ "capability": ModelCapability }`. If `source` is omitted, backend sets it to `user`.

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
- Unknown image-generation capability fails closed with `image_generation_required`.

## Frontend Adapter Shapes

`src/api.ts` intentionally normalizes some backend responses for UI components:

- `POST /api/providers` and `PATCH /api/providers/:id`: unwrap `{ "provider": ProviderProfile }` to `ProviderProfile`.
- `PATCH /api/model-capabilities/:id`: unwrap `{ "capability": ModelCapability }` to `ModelCapability`.
- `POST /api/providers/:id/models/discover`: maps returned `ModelCapability[]` to UI `DiscoveredModel[]` using `modelId` as `id`.
- `POST /api/providers/:id/test`: converts checkbox state `{ text, vision, json, streaming }` into backend `tests: string[]`, then maps backend `ok/results/trace` into UI `passed/results/redactedTrace`.

## Story/Page Generation Safety Gate

`POST /api/story/analyze` and `POST /api/pages/:pageId/generate` still use the global OpenAI-compatible settings from `PUT /api/settings/secrets`, but the server checks Provider Lab metadata before external R-18 or image-capable routes.

`PUT /api/projects/:projectId/story-bible` saves user-edited AI output. The request body is a full `StoryBible` object validated by schema. Backend normalizes character `projectId` and fills any missing character IDs before persisting.

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

- Non-R-18 text-only generation can run with the legacy global model settings.
- R-18 generation requires a Provider Profile whose normalized `baseUrl` and `defaultModel` match the global `apiBaseUrl` and `modelName`.
- The matching model capability record must have `allowsAdultGeneration: true`.
- Story Continue external image generation requires `supportsImageGeneration: true`; future routes that send reference image binary externally must also require `supportsVision: true`, and explicit/suggestive image routes must have `allowsAdultInput: true`.
- Unknown or failed image safety classification blocks image routing.

Blocked requests return HTTP 400 with:

```json
{
  "error": "AI route blocked by provider safety policy: adult_generation_not_allowed"
}
```
