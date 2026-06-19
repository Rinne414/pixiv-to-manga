# test-provider-lab-flow Findings

Status: planned - not executed.

## Summary

No E2E validation has run yet. The plan is ready and waiting for team-lead to provide a testable Provider Lab build.

## Current Findings

- `package.json` currently has no Playwright or Puppeteer dependency.
- There is no dedicated `test:e2e` script.
- Browser validation will use Playwright if added before execution; otherwise it will use installed Chrome/Chromium headless with Chrome DevTools Protocol.
- Secret and NSFW invariants are part of the blocking acceptance criteria, not optional checks.

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

## Artifacts

Pending execution.

## Recommended Next Action

Team-lead should notify e2e-tester when a deterministic build and mock provider path are ready.
