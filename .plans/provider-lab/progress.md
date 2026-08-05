# Provider Lab Team Progress

## 2026-07-30 Bounded Pixiv batch import

- Added explicit artwork URL/ID preview for up to 50 artworks and 200 selected pages, with duplicate artwork removal and per-artwork failures.
- Added persisted sequential tasks with pause, resume, cancel, failed-item retry, restart recovery, stable item file paths, project-level de-duplication, and atomic page/import-record commits.
- Added a shared serial Pixiv request throttle, bounded network/5xx retries, automatic 401/403/429 pause, and backend-enforced 429 cooldown.
- Public imports omit Cookie by default. Private non-R-18 imports can explicitly use the saved session, R-18 requires it, and the session test returns capability state without returning the Cookie.
- Added streamed 30 MB image enforcement, MIME/dimension validation, active-request cancellation, responsive task controls, and user-facing account-risk guidance.
- Unified project-detail refreshes behind request version, selected-project, and mount-state checks so delayed imports or failed project loads cannot restore stale editable state; empty-workspace imports select their new project and failed loads can be retried in place.
- GPL reference material was used only for design and behavior study; no source, names, or copy were ported.
- Final verification passed: lint, 26 Vitest files / 197 tests, production build, four targeted Pixiv E2E scenarios, targeted 390 px overflow E2E, and the complete 31-test Chromium E2E suite. Final reviewer verdict: `[OK]`.

## 2026-07-30 Lettering defaults and non-destructive cleanup

- Added project-scoped lettering defaults for font, scale, text color, and SFX outline settings, with explicit save-defaults versus apply-to-existing actions.
- Added explicit character-color application and made generated/manual dialogue inherit project defaults while preserving intentional per-line overrides.
- Added normalized per-page cleanup strokes with mosaic, paint, erase, size, intensity, color, clear, backup restore, and shared PNG/ZIP/CBZ/PDF/reader rendering.
- Updated API/architecture docs, README, SQLite migrations, and regression tests. Verification: lint passed, build passed, 25 Vitest files / 177 tests passed; isolated lettering/cleanup browser smoke passed. Full Chromium suite passed 25/26; the custom-font case passed in isolation and timed out only when run after the complete serial suite.

## 2026-07-27 AIHubMix route and usability hardening

- AIHubMix website roots normalize to the OpenAI-compatible `/v1` API prefix, and authentication failures stop the remaining capability probes instead of emitting four misleading failures.
- Safe image requests can test unknown Vision support at the Provider; successful real image calls persist tested Vision evidence. Adult-content, illegal-content, image-generation, and explicit negative Vision gates remain fail closed.
- External model names no longer create capability evidence. Historical `model-id` evidence is reset to unknown and replaced only by provider metadata, active probes, successful real image requests, or user confirmation.
- The legacy global API fallback is hidden when a keyed external Provider connection is available.
- Real AIHubMix browser flow passed: local image import, Story Bible generation, and page dialogue generation with three saved lines.
- Final verification passed: lint, 24 Vitest files / 175 tests, and production build. The full Chromium run passed 25/26; its sole unrelated 390px overflow check passed immediately on isolated rerun, so all 26 scenarios have passing evidence without a narrow-screen product change.

## 2026-07-26 Capability detection hardening

- Replaced model-wide capability provenance with per-flag evidence while preserving the existing boolean routing fields.
- Added additive SQLite migration for `capabilitySourcesJson` and automatic reconciliation of stored default models.
- Discovery now parses common provider capability metadata without guessing capabilities from model names.
- Local providers automatically receive adult input/generation routing evidence; external providers can derive it from explicit capability fields, unmoderated provider metadata, active safe probes, successful real requests, or model-scoped overrides.
- Local trust now requires both `isLocal` and a loopback/private URL across save validation, capability inference, chat routing, and image routing; legacy public rows marked local fail closed.
- Provider checks now default to text, vision, JSON, and streaming; use a valid PNG; validate chat/JSON/SSE responses; and keep 401/429/5xx/network/malformed results indeterminate.
- Provider Lab now displays supported, unsupported, and unknown separately instead of rendering every false value as unsupported.
- Provider Lab exposes model-scoped overrides for every capability gate and submits only changed fields, preserving unrelated automatic evidence.
- Final verification passed: lint, build, 24 unit-test files / 162 tests, and 26 Chromium E2E tests.

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
