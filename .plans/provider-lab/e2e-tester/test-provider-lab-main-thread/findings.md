# test-provider-lab-main-thread Findings

Status: PASS

Date: 2026-06-20

## Summary

Main-thread validation now passes for the Provider Lab backend/API path, the UI clipping regression that previously failed, and a first-class Playwright browser E2E path.

- App services: PASS
- Provider Lab API smoke with dummy API key: PASS
- Provider Lab secret redaction: PASS
- Model discovery/test/capability patch: PASS
- Unit/lint/build/e2e gate: PASS
- Provider Lab horizontal clipping fix: implemented in CSS
- Browser Playwright E2E: PASS

## Current Verified Results

### PASS: Quality Gate

Commands:

```text
npm run lint
npm test
npm run build
npm run e2e
```

Result:

- `npm run lint`: passed.
- `npm test`: passed, 7 files / 38 tests.
- `npm run build`: passed with Vite chunk-size warning only.
- `npm run e2e`: passed, 1 Chromium browser test.

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

## Browser Validation

The project now has a first-class Playwright E2E test:

- `playwright.config.ts` starts the mock provider, backend, and Vite client.
- Backend E2E runs with a temporary `PTM_DATA_DIR` and `PTM_TEST_MEMORY_KEYTAR=1`, so browser tests do not write provider secrets into the user's real keychain or local project database.
- `e2e/provider-lab.spec.ts` covers project creation, Provider Lab provider creation with a dummy API key, model discovery, provider capability tests, trace redaction, browser storage secret checks, no direct browser calls to the mock provider, and horizontal clipping checks.

The older raw CDP browser smoke script remains only as a diagnostic artifact.

## Remaining Risk

- Vite reports one chunk-size warning after production build.
- Playwright currently covers Chromium desktop only; mobile/narrow viewport coverage remains future work.
