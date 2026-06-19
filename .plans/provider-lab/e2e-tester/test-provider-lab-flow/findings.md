# test-provider-lab-flow Findings

Status: PASS.

## Summary

E2E validation has run on the maintained Playwright path and passed.

## Current Findings

- `package.json` has `@playwright/test` and `npm run e2e`.
- `playwright.config.ts` starts a mock OpenAI-compatible provider, backend, and Vite client.
- Backend E2E uses isolated `PTM_DATA_DIR` and `PTM_TEST_MEMORY_KEYTAR=1`.
- Secret and NSFW invariants are checked as blocking acceptance criteria where covered by the automated flow.

## Planned Pass Criteria

- Provider create/edit works without exposing API keys.
- Model discovery handles success/mock/error paths.
- Capability edits persist and affect routing checks.
- Provider test traces redact Authorization, API keys, cookies, and image payloads.
- Browser never calls external LLM providers directly with user secrets.
- R-18 is default-off and unsupported explicit-image routes fail closed before external calls.
- Existing Analyze Story, Generate Page, and Export ZIP flows still work.

## Planned Failure Criteria

- Any API key or Pixiv cookie appears in localStorage, sessionStorage, SQLite/plaintext files, URLs, logs, screenshots, traces, or exported ZIPs.
- Browser sends user-secret-bearing requests directly to external LLM provider domains.
- Explicit/R-18 image route proceeds without explicit opt-in and compatible provider/model capability flags.
- Provider Lab breaks the existing manga workflow.

## Executed Evidence

- `npm run e2e`: passed, 2 Chromium tests.
- Provider Lab flow passed: keyed local provider creation, model discovery, provider test, redacted trace, browser storage secret scan, no direct browser calls to mock provider, clipping check.
- Manga workflow regression passed: local SVG import, Analyze Story mock, Generate Page mock, dialogue edit persistence, lock toggle, layout adjustment, rendered PNG ZIP export, backup export, and backup restore.

## Recommended Next Action

Keep this Playwright path as the maintained E2E gate.
