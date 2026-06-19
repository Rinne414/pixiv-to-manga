# Review Provider Lab Findings

## Status

- Review gate: prepared
- Full review: waiting for backend-dev/frontend-dev completion message
- Verdict: pending

## Review Checklist

### Secrets

- [ ] API keys and Pixiv cookies are never written to localStorage, sessionStorage, IndexedDB, SQLite plaintext columns, project files, exports, screenshots, or temporary plaintext files.
- [ ] API keys are stored only through keytar/system credential storage.
- [ ] If keytar/system credential storage is unavailable, secret save fails closed and does not silently fall back to plaintext.
- [ ] Secret fields are write-only in frontend and API responses return only redacted/boolean secret status.
- [ ] Secrets never appear in URLs, query strings, route params, logs, error messages, job events, debug traces, telemetry, or test snapshots.
- [ ] Provider debug traces redact Authorization headers, API keys, cookies, and image payloads.

### Provider Calls

- [ ] Browser never calls external LLM providers directly with user secrets.
- [ ] All provider discovery, testing, and generation requests go through the local backend.
- [ ] Backend validates provider base URLs and request configuration before outbound calls.
- [ ] Provider/model test results do not leak request secrets or raw image payloads.
- [ ] Streaming, JSON, vision, and text tests have bounded errors and redacted failure output.

### NSFW Routing

- [ ] R-18 is default-off for new installs, new projects, and unset settings.
- [ ] R-18 requires explicit user opt-in before any external route can receive explicit image/content requests.
- [ ] Explicit images are blocked unless both provider and model capability flags explicitly allow adult image input.
- [ ] Models without vision support never receive image payloads.
- [ ] Unsupported or unknown provider/model capability combinations fail closed.
- [ ] Illegal sexual content and apparent-minor sexual content are blocked regardless of user settings.
- [ ] Route checks happen before prompt construction and before any external provider request.

### Pixiv Import

- [ ] Backend accepts Pixiv artwork URL/ID only.
- [ ] No arbitrary URL image proxy is introduced.
- [ ] Pixiv cookies are never passed in query strings or frontend-visible request data.
- [ ] Pixiv import errors do not echo cookies or internal fetch headers.

### API Validation

- [ ] `GET /api/providers` returns metadata and secret status only, never API keys.
- [ ] `POST /api/providers` stores non-secret metadata separately from API keys and validates user-controlled fields.
- [ ] `PATCH /api/providers/:id` treats API key as write-only and validates partial updates.
- [ ] `DELETE /api/providers/:id` removes both metadata and associated keytar secret.
- [ ] `POST /api/providers/:id/models/discover` handles provider response shape variance without trusting unvalidated model flags.
- [ ] `POST /api/providers/:id/test` returns redacted trace, latency, pass/fail results, and inferred capability flags only.
- [ ] `GET /api/model-capabilities` and `PATCH /api/model-capabilities/:id` enforce valid capability enums/booleans and do not permit unsafe implicit defaults.
- [ ] API errors are specific enough for UI handling but do not disclose secrets or sensitive request payloads.

### Doc-Code Sync

- [ ] Implemented backend/frontend API behavior matches `.plans/provider-lab/docs/api-contracts.md`.
- [ ] New components, storage, data flow, and route-check behavior are reflected in `.plans/provider-lab/docs/architecture.md`.
- [ ] Any invariant-affecting decision is documented in `.plans/provider-lab/docs/invariants.md` or the team plan.
- [ ] Tests and UI copy do not contradict the documented default-off R-18 behavior.

### Test Coverage

- [ ] Secret handling tests cover save, update, delete, keytar unavailable, API response redaction, and log/trace redaction.
- [ ] Provider discovery tests cover OpenAI-compatible success, malformed response, provider error, and network failure.
- [ ] Provider test API covers text, vision, JSON, streaming, and redacted failure paths.
- [ ] NSFW routing tests cover default-off, explicit opt-in, unknown capability, no-vision model, external adult-image block, allowed compatible route, illegal content block, and apparent-minor block.
- [ ] Frontend tests cover write-only API key UI, provider switching, capability matrix display, and debug trace redaction.
- [ ] CI command remains `npm run lint && npm test && npm run build`.

## Pre-Review Notes

- No source review has been performed yet. Current gate is based on `docs/invariants.md`, `docs/api-contracts.md`, `docs/architecture.md`, and team task plans.
- Full review is blocked until backend-dev/frontend-dev publish completion details or changed file list.

