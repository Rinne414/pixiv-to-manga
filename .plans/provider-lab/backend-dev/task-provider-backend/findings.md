# task-provider-backend Findings

## Status

Complete on 2026-06-20.

## Implemented

- Provider metadata storage in SQLite via `providers`.
- Per-provider API key storage/status/delete in keytar using `provider-api-key:<providerId>` accounts.
- Model capability registry in SQLite via `model_capabilities`.
- Provider Lab routes:
  - `GET /api/providers`
  - `POST /api/providers`
  - `PATCH /api/providers/:id`
  - `DELETE /api/providers/:id`
  - `POST /api/providers/:id/models/discover`
  - `POST /api/providers/:id/test`
  - `GET /api/model-capabilities`
  - `PATCH /api/model-capabilities/:id`
- Redacted provider traces for Authorization, secret-like fields, cookies/tokens, and image data URLs.
- Model discovery parsing for OpenAI-compatible `data`, `models`, and simple array responses.
- Pure route safety helper with fail-closed behavior for illegal content, missing R-18 opt-in, missing vision support, and explicit-image adult capability blocks.
- Tests for CRUD, secret redaction, discovery parsing, provider test trace redaction, capability patching, and route safety.
- API and architecture docs updated.

## Verification

- `npm test`: passed, 5 files / 22 tests.
- `npm run build`: passed. Vite reported a chunk-size warning.
- `npm run lint`: passed.

## Risks / Follow-ups

- Capability inference from model IDs is intentionally conservative and should be supplemented by researcher/provider-specific metadata.
- Superseded 2026-07-26: adult capability now comes from local routing policy, explicit provider metadata, or a model-scoped user override.
- Route safety helper is tested but not yet wired into story/page generation.
- Provider test uses OpenAI-compatible `/chat/completions`; non-compatible providers need adapters before they can be tested reliably.
