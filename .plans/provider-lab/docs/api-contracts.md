# API Contracts

## Existing API

- `GET /api/settings/secrets`
- `PUT /api/settings/secrets`
- `POST /api/story/analyze`
- `PUT /api/projects/:projectId/story-bible`
- `POST /api/pages/:pageId/generate`
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
  "supportsStreaming": true,
  "supportsJsonSchema": true,
  "allowsAdultInput": false,
  "allowsAdultGeneration": false,
  "contextWindow": 128000,
  "notes": "User confirmed."
}
```

Response: `{ "capability": ModelCapability }`. If `source` is omitted, backend sets it to `user`.

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

`POST /api/jobs/:jobId/cancel` aborts the active job and returns:

```json
{ "ok": true }
```

The backend keeps recent job events in memory so fast mock jobs can be replayed to clients that connect after the job already completed. Browser clients wait for the SSE terminal event and do not call external providers directly.

Current v1 behavior:

- Non-R-18 text-only generation can run with the legacy global model settings.
- R-18 generation requires a Provider Profile whose normalized `baseUrl` and `defaultModel` match the global `apiBaseUrl` and `modelName`.
- The matching model capability record must have `allowsAdultGeneration: true`.
- Future image routes must also have `supportsVision: true`; explicit/suggestive image routes must have `allowsAdultInput: true`.
- Unknown or failed image safety classification blocks image routing.

Blocked requests return HTTP 400 with:

```json
{
  "error": "AI route blocked by provider safety policy: adult_generation_not_allowed"
}
```
