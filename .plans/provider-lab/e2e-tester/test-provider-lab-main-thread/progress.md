# test-provider-lab-main-thread Progress

## 2026-06-20

- Started independent E2E/API smoke validation.
- Confirmed frontend is available on `http://127.0.0.1:5173`.
- Confirmed backend health is available on `http://127.0.0.1:4174/api/health`.
- Started local mock provider planning on `http://127.0.0.1:5199`.
- Completed API smoke:
  - With API key: failed on `keytar.setPassword is not a function`.
  - Without API key: passed create/discover/test/capability update against local mock provider.
- Completed browser smoke with Playwright from agent runtime:
  - Provider Lab no-key mock flow passed.
  - Main workbench create project/navigation smoke passed.
  - Secret not visible in UI or browser storage after failed save.
  - Browser made no direct requests to mock provider.
  - Provider Lab horizontal clipping detected.
- Main-thread follow-up fixed the reported blockers:
  - `server/secrets.ts` now supports keytar ESM `{ default }` import shape and keeps invalid modules fail-closed.
  - `tests/providerBackend.test.ts` now covers keytar module normalization.
  - `src/index.css` now stacks Provider Lab into a narrow-inspector layout and removes the known horizontal clipping cause.
  - `node .plans/provider-lab/e2e-tester/test-provider-lab-main-thread/api-smoke.mjs` passed with a dummy API key after restarting the backend on current code.
  - Latest gate passed: `npm run lint`, `npm test` (7 files / 37 tests), and `npm run build`.
- Raw CDP browser smoke remains unstable locally; generated JSON/profile/artifacts are ignored and should not be committed.
