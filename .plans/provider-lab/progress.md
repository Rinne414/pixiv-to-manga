# Provider Lab Team Progress

## 2026-06-20

- Team setup started.
- Scope chosen: Provider Lab + Model Capability Registry + NSFW Routing.
- Agents dispatched:
  - researcher: provider/model capability and NSFW routing research.
  - backend-dev: provider backend/storage/routes/tests.
  - frontend-dev: Provider Lab UI and API client.
  - reviewer: review gate/checklist.
  - e2e-tester: test plan and later browser validation.
- Team-lead baseline scan:
  - Current backend has single `SecretStore` API key and Pixiv cookie accounts.
  - Current API redacts authorization/apiKey/pixivCookie at Fastify logger level.
  - Current frontend SettingsPanel is the natural Provider Lab entry point.
  - Current `src/api.ts` has one request helper and secret settings functions; provider API client can extend here or split into `providerLabApi.ts`.

## 2026-06-20 Main-thread integration pass

- Fixed Provider Lab frontend/backend response-shape mismatches:
  - `src/api.ts` now unwraps `{ provider }` and `{ capability }`.
  - Provider test UI checkbox state is converted to backend `tests: string[]`.
  - Backend `ok/results/trace` test response is normalized to UI `passed/results/redactedTrace`.
- Fixed Provider Lab UI refresh gap:
  - Discovery and provider tests now reload model capability records before updating the selected model draft.
- Strengthened trace redaction:
  - `server/providers.ts` now removes request-known secrets and image payloads from provider response traces if echoed.
- Strengthened NSFW fail-closed logic:
  - `src/shared/routeSafety.ts` now handles `unknown` and `failed` classifications.
  - Suggestive/explicit image routes require R-18 opt-in.
  - R-18 generation requires `allowsAdultGeneration`.
- Wired Provider Lab gate into existing AI generation:
  - `server/index.ts` passes `db` into `server/ai.ts`.
  - `server/ai.ts` blocks external R-18 generation unless global AI settings match a Provider Lab provider/model capability that allows adult generation.
- Added regression tests:
  - `tests/apiProviderClient.test.ts`
  - `tests/aiRouteSafety.test.ts`
  - Expanded `tests/providerBackend.test.ts`
- Main-thread verification after this pass:
  - `npm run lint` passed.
  - `npm test` passed during targeted runs; full run completed in the final completion pass.
  - `npm run build` passed with Vite chunk-size warning only.

## 2026-06-20 Review follow-up

- Reviewer returned `[WARN]` with no CRITICAL/HIGH issues.
- Addressed reviewer WARN items:
  - Added provider URL/path validation: external providers must use public HTTPS; local/private HTTP requires `isLocal: true`; model discovery path must be relative.
  - Changed `SafetyClass: unknown` to fail closed for all routes, not only image routes.
  - Wired Provider Lab capability gate into story/page AI generation for R-18 external calls.
  - Documented frontend adapter-normalized response shapes.
- Added `vitest.config.ts` so `npm test` only discovers project tests under `tests/` and ignores `.plans` browser profile artifacts.
- Added `.plans/**/.chrome-profile/**` to ESLint ignore because E2E browser profiles can contain extension source files.
- Final main-thread verification:
  - `npm run lint` passed.
  - `npm test` passed: 7 files / 36 tests.
  - `npm run build` passed with Vite chunk-size warning only.
- Browser smoke fallback:
  - Browser plugin unavailable; used Playwright with system Chrome.
  - `http://127.0.0.1:5173/` loaded, title `Pixiv-to-Manga Studio`, Provider Lab visible in Settings, no console errors.
  - Screenshot: `.vite-screenshots/provider-lab-smoke.png`.

## 2026-06-20 Final handoff hardening

- Fixed E2E-reported keytar runtime issue:
  - `server/secrets.ts` now normalizes keytar CommonJS and ESM `{ default }` module shapes.
  - Invalid keytar modules remain unavailable and fail closed; no plaintext fallback was added.
  - Added provider backend regression coverage for module normalization.
- Fixed Provider Lab narrow right-rail clipping:
  - `src/index.css` now stacks Provider Lab list/form by default and allows nested controls to shrink within the inspector.
- Re-ran current-code validation after restarting backend/frontend services:
  - `npm run lint` passed.
  - `npm test` passed: 7 files / 37 tests.
  - `npm run build` passed with Vite chunk-size warning only.
  - `node .plans/provider-lab/e2e-tester/test-provider-lab-main-thread/api-smoke.mjs` passed against the local mock provider with a dummy API key.
- Cleaned repository hygiene:
  - Browser smoke generated JSON/profiles/artifacts and temporary run logs are ignored.
  - API smoke scripts and mock provider scripts remain committed as repeatable diagnostics.
- Remaining note:
  - Raw CDP browser smoke harness is unstable locally and is kept only as a diagnostic artifact; the maintained browser gate is now Playwright.

## 2026-06-20 E2E hardening pass

- Added first-class Playwright E2E:
  - `playwright.config.ts`
  - `e2e/provider-lab.spec.ts`
  - `npm run e2e`
- Added isolated E2E secret/data handling:
  - `PTM_TEST_MEMORY_KEYTAR=1` enables an in-memory keytar only for explicit test processes.
  - Playwright backend uses a unique temporary `PTM_DATA_DIR`.
- Updated CI script and README verification commands to include `npm run e2e`.
- Final validation after E2E hardening:
  - `npm run lint` passed.
  - `npm test` passed: 7 files / 38 tests.
  - `npm run build` passed with Vite chunk-size warning only.
  - `npm run e2e` passed: 1 Chromium test.

## 2026-06-20 Final completion pass

- Completed a final "all done" audit against `.plans/provider-lab/`.
- Closed stale planning statuses for frontend, reviewer, and E2E execution.
- Expanded E2E from Provider Lab-only smoke to a core manga workflow regression:
  - local image import;
  - Analyze Story mock generation;
  - Generate Page mock dialogue generation;
  - editable dialogue persistence and lock toggle;
  - layout adjustment;
  - rendered PNG ZIP export;
  - Project Backup export and restore.
- Fixed final verification blockers:
  - removed an unused `Dialogue` type import in `server/importers.ts`;
  - tightened backup restore typing so restored story bible characters receive safe IDs;
  - waited for Provider Lab readiness in E2E before filling the provider form.
- Final validation:
  - `npm run lint` passed.
  - `npm test` passed: 9 files / 43 tests.
  - `npm run build` passed with Vite chunk-size warning only.
  - `npm run e2e` passed: 2 Chromium tests.
