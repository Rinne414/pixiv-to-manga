# Provider Lab Main Thread Review

## Verdict

[WARN]

No CRITICAL/HIGH blocker was found in the reviewed slice. The implementation is broadly aligned with the Provider Lab contract and secret/NSFW invariants, but there are WARN-level issues that should be addressed before treating this as a hardened provider-routing surface.

## Scope

Reviewed read-only:

- `src/api.ts`
- `server/providers.ts`
- `src/shared/routeSafety.ts`
- `src/shared/schemas.ts`
- `src/shared/types.ts`
- `src/ProviderLabPanel.tsx`
- `server/database.ts`
- `server/secrets.ts`
- `server/index.ts`
- `tests/providerBackend.test.ts`
- `.plans/provider-lab/docs/invariants.md`
- `.plans/provider-lab/docs/api-contracts.md`
- `.plans/provider-lab/docs/architecture.md`

Team-reported verification already passed:

- `npm run lint`
- `npm test` (25 tests)
- `npm run build` (chunk warning only)

## Findings

### [WARN-1] Provider outbound URL/path validation is permissive

Evidence:

- `server/providers.ts:112` stores `normalizeBaseUrl(input.baseUrl)` without URL host/scheme policy beyond adding `https://` when no scheme exists.
- `server/providers.ts:160` builds discovery URL from stored `provider.baseUrl` plus caller-provided `discoverPath`.
- `src/shared/schemas.ts:108-110` accepts any non-empty discovery `path` up to 120 chars; it does not enforce a relative path or block unexpected path forms.

Risk:

- The feature intentionally supports user-configured OpenAI-compatible and local provider endpoints, so this is not automatically a blocker in a local desktop app.
- Still, the local backend becomes a generic authenticated outbound requester for any saved provider base URL and discovery/test route. This should be constrained before exposing more provider operations, especially because Authorization headers may be attached to all outbound calls for that provider.

Recommendation:

- Validate `baseUrl` with `new URL()`, allow only `http:`/`https:`, and explicitly document the accepted local/private network behavior.
- Validate discovery `path` as a relative API path starting with `/`, rejecting absolute URLs, protocol-relative forms, control characters, and path values that are not intended provider API routes.
- Consider a confirmation/warning for remote non-HTTPS provider URLs unless `isLocal` is true.

### [WARN-2] `routeSafety` allows `unknown` safety class for non-image routes

Evidence:

- `src/shared/routeSafety.ts:36-38` blocks `unknown` only when `imagePresent` is true.
- `src/shared/routeSafety.ts:58-62` can allow `{ safetyClass: 'unknown', imagePresent: false, r18: true, allowsAdultGeneration: true }`.

Risk:

- If `safetyClass` is strictly an image classifier result, current behavior is defensible.
- If `safetyClass: 'unknown'` means the overall NSFW/content classification is unknown, this is not fully fail-closed for R-18/text-only generation decisions.

Recommendation:

- Either document that `safetyClass` applies only to image inputs, or change `unknown` to fail closed regardless of `imagePresent`.
- Add an explicit test for the no-image `unknown` case so future reviewers can see the intended semantics.

### [WARN-3] NSFW router is not wired into generation yet

Evidence:

- `.plans/provider-lab/docs/architecture.md` states the current slice includes `evaluateRouteSafety` tests only and is not yet wired into story/page generation.
- `rg` found `evaluateRouteSafety` usage only in tests and the helper file.

Risk:

- The pure helper behaves conservatively for tested image/R-18 cases, but it does not yet enforce Provider Lab routing on real generation calls.

Recommendation:

- Keep this as a documented phase limitation.
- Do not mark the NSFW routing success criterion complete until generation routes call the helper before prompt construction and before outbound provider calls.

### [WARN-4] API docs should clarify adapter-normalized frontend shapes

Evidence:

- Backend `POST /api/providers/:id/test` returns `{ ok, results[].ok, trace }`.
- `src/api.ts:317-332` normalizes that to frontend `{ passed, results[].passed, redactedTrace }`.
- Backend discovery returns `models: ModelCapability[]`; `src/api.ts:245-249` maps those to `DiscoveredModel[]` for UI display.

Risk:

- Code is correct, but the frontend adapter shape is not called out in API docs. This can create false contract mismatch reports later.

Recommendation:

- Add a short section to `api-contracts.md` documenting that `src/api.ts` intentionally adapts backend `ok/results/trace` to frontend `passed/results/redactedTrace`, and backend `ModelCapability` discovery records to UI `DiscoveredModel`.

## Checked Items

### `src/api.ts` contract adapter

- `createProvider` and `updateProvider` correctly unwrap backend `{ provider }`.
- `updateModelCapability` correctly unwraps backend `{ capability }`.
- Provider test adapter correctly converts selected boolean test map to backend test array.
- Provider test adapter correctly maps backend `ok` to `passed`, `results[].ok` to `results[].passed`, and `trace` to stringified `redactedTrace`.
- Discovery adapter correctly maps backend `ModelCapability[]` to UI `DiscoveredModel[]`.
- No frontend external provider calls with user secrets were found; UI calls local `/api/...` routes only.

### `server/providers.ts` redaction

- Authorization/API key/cookie/token/secret-like keys are redacted recursively.
- Exact Authorization bearer token values are collected and removed from response echoes.
- Request image data URLs and base64 payload fragments are collected and redacted from response echoes.
- Tests cover provider response echoing the secret and image payload.
- Remaining concern is not direct leakage in the tested paths, but the need to keep redaction coverage as provider response formats expand.

### `src/shared/routeSafety.ts`

- `illegal` and `failed` fail closed.
- Explicit/suggestive adult classes require `r18`.
- Image payloads require vision support.
- Explicit/adult image input requires adult input capability.
- `r18` generation requires adult generation capability.
- Unknown image safety fails closed; unknown non-image semantics need clarification or stricter handling.

### Docs

- `api-contracts.md` matches backend envelopes for `{ provider }`, `{ capability }`, provider test `ok/results/trace`, discovery, and capability endpoints.
- `architecture.md` accurately states the router is currently helper/tests only and not wired into generation.
- Suggested update: document frontend adapter-normalized shapes and URL/path validation policy.

## Gate Summary

- CRITICAL: none found.
- HIGH: none found.
- WARN: 4 items above.
- Blocker status: not blocked, but do not claim full NSFW runtime enforcement until route checks are wired into generation.

## Quick Re-Review - 2026-06-20

Verdict: [OK]

Scope: targeted re-review of the four previously reported WARN items after main-thread fixes. Reviewed `server/providers.ts`, `src/shared/routeSafety.ts`, `server/ai.ts`, `server/index.ts`, `src/shared/schemas.ts`, new/updated tests, and Provider Lab docs.

Results:

- Previous WARN-1: addressed. Provider base URL validation now requires external HTTPS, blocks localhost/private IPv4 hostnames for external providers, allows local/private HTTP only with `isLocal`, and discovery path rejects non-relative/absolute URL forms before fetch.
- Previous WARN-2: addressed. `safetyClass: 'unknown'` now fails closed globally.
- Previous WARN-3: addressed for current text-generation path. `server/index.ts` passes `db` into AI services, and `server/ai.ts` gates R-18 generation through Provider Lab provider/capability records before external calls.
- Previous WARN-4: addressed. API contracts and architecture docs now document frontend adapter shapes, URL/path policy, trace echo redaction, and generation safety gate behavior.

No CRITICAL or HIGH blocker found in the targeted re-review.
