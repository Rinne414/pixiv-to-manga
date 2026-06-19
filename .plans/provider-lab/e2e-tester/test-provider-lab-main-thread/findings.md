# test-provider-lab-main-thread Findings

Status: PASS_WITH_NOTE

Date: 2026-06-20

## Summary

Main-thread validation now passes for the Provider Lab backend/API path and the UI clipping regression that previously failed.

- App services: PASS
- Provider Lab API smoke with dummy API key: PASS
- Provider Lab secret redaction: PASS
- Model discovery/test/capability patch: PASS
- Unit/lint/build gate: PASS
- Provider Lab horizontal clipping fix: implemented in CSS
- Browser/CDP full smoke script: TOOLING NOTE, unstable in this local run

## Current Verified Results

### PASS: Quality Gate

Commands:

```text
npm run lint
npm test
npm run build
```

Result:

- `npm run lint`: passed.
- `npm test`: passed, 7 files / 37 tests.
- `npm run build`: passed with Vite chunk-size warning only.

### PASS: Provider API Smoke With Dummy Key

Command:

```text
node .plans/provider-lab/e2e-tester/test-provider-lab-main-thread/api-smoke.mjs
```

Environment:

- Backend: `http://127.0.0.1:4174`
- Mock provider: `http://127.0.0.1:5199`

Result:

- Created local provider with dummy API key.
- API key did not appear in create/list/discover/test responses.
- Model discovery returned `gpt-4o-smoke`, `text-only-smoke`, and `qwen-vl-smoke`.
- Provider text/vision/JSON/streaming tests passed against the mock provider.
- Authorization and image payloads were redacted from traces.
- Capability record was created and user adult-input flag patch succeeded.

### Fixed: Keytar ESM Import Shape

Previous failure:

```text
keytar.setPassword is not a function
```

Fix:

- `server/secrets.ts` now normalizes both CommonJS keytar shape and ESM `{ default }` shape.
- Invalid keytar module shapes return `null` and keep the existing fail-closed behavior.
- `tests/providerBackend.test.ts` includes regression coverage for keytar module normalization.

### Fixed: Provider Lab Horizontal Clipping

Previous failure:

```json
[
  {"cls":"right-rail panel","scrollWidth":414,"clientWidth":363},
  {"cls":"provider-lab","scrollWidth":414,"clientWidth":363},
  {"cls":"provider-form","scrollWidth":236,"clientWidth":171}
]
```

Fix:

- `src/index.css` now treats Provider Lab as a narrow inspector-first surface:
  - Provider list/form stack into one column by default.
  - Provider action buttons use `minmax(0, 1fr)`.
  - Provider Lab containers explicitly allow shrinking with `min-width: 0`.

## Browser Validation Note

The checked-in CDP browser smoke script is still useful as a diagnostic artifact, but repeated local runs through raw Chrome DevTools Protocol timed out or returned unstable `Uncaught`/CDP timeout results. Those failures were in the test harness path, not in the API/backend path.

Current recommendation:

- Do not commit generated browser result JSON or Chrome profiles.
- Keep API smoke scripts and mock provider scripts.
- Add a first-class Playwright dependency/config in a future E2E hardening slice if browser flow automation becomes a release gate.

## Remaining Risk

- Full browser interaction E2E is not yet a stable committed test suite.
- Vite reports one chunk-size warning after production build.
- The local app currently stores test provider rows in the user's local app database during manual smoke runs; this is acceptable for local testing but should be isolated in future automated E2E.
