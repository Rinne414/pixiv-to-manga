# test-provider-lab-flow Task Plan

## Status

PASS - executed through the maintained Playwright Chromium E2E path.

## Scope

Validate Provider Lab browser/API behavior and original manga workflow regression:

- Provider create/edit.
- Model discovery success, mock, and error handling.
- Capability edit persistence and route impact.
- Provider test trace redaction.
- NSFW route blocking and fail-closed behavior.
- Existing Analyze Story, Generate Page, and Export ZIP regression.

## Preconditions

- Team-lead announces a testable build/branch.
- CI baseline is available: `npm run lint && npm test && npm run build`.
- Backend and frontend can run with `npm run dev`, or team-lead provides equivalent commands.
- Test secrets must be dummy values only.
- No real Pixiv cookies or production provider keys are used in artifacts.

## Browser Verification Strategy

1. Prefer Playwright if the project adds it before execution:
   - Use Chromium desktop as the minimum project.
   - Capture trace/screenshot/video only on failure.
   - Assert network requests through local backend only.
2. Current dependency scan result:
   - `package.json` has `@playwright/test`.
   - `npm run e2e` is the maintained E2E command.
3. Fallback if Playwright is still absent:
   - Launch installed Chrome/Chromium in headless mode with remote debugging enabled.
   - Drive the app through Chrome DevTools Protocol.
   - Capture screenshots via CDP `Page.captureScreenshot`.
   - Inspect network events via CDP `Network.requestWillBeSent` and `Network.responseReceived`.
   - Fail any direct browser request to external LLM provider domains when user secrets are involved.

## Test Matrix

| Area | Scenario | Expected Result |
|---|---|---|
| Provider create | Create profile with base URL, display name, provider type, dummy API key | Metadata appears in provider list; API key is write-only and never shown back |
| Provider edit | Update display name/base URL and replace API key | Metadata updates; secret status changes without exposing key |
| Secret storage | Inspect localStorage/sessionStorage and exported/screenshotted artifacts | No API key or Pixiv cookie present |
| Model discovery success/mock | Backend mock returns multiple models with mixed capabilities | UI lists models and stores/display candidates without leaking secrets |
| Model discovery error | Mock provider returns 401/500/malformed payload | UI shows actionable error; no raw secret or Authorization value in trace |
| Capability edit | Toggle text/vision/JSON/streaming/adult-image flags | Capability registry persists edits and UI reflects saved state after reload |
| Provider test trace | Run text/vision/JSON/streaming test modes | Trace shows redacted request/response metadata and pass/fail per mode |
| Browser provider calls | Monitor browser network during discovery/test/generation | Browser only calls local backend, never external LLM provider endpoints directly |
| NSFW default-off | Attempt R-18/explicit-image route while disabled | Request is blocked before external provider call |
| NSFW incompatible model | Enable R-18 but choose model without adult image or vision support | Route fails closed before external call |
| NSFW compatible route | Use explicit opt-in plus compatible mocked provider/model | Route may proceed only through backend and still redacts trace/artifacts |
| Analyze Story regression | Run existing story analysis flow with normal SFW input | Flow succeeds or reports existing known limitation, no Provider Lab regression |
| Generate Page regression | Generate a manga page from analyzed story | Page generation completes and canvas/editor remains usable |
| Export ZIP regression | Export generated project ZIP | ZIP downloads and contains expected project assets without secrets |

## Execution Steps After Build Is Ready

1. Pull team-lead's testable build instructions and record commit/build identifier.
2. Run `npm run lint && npm test && npm run build`.
3. Start the app using the agreed command.
4. Run automated browser validation using Playwright if present; otherwise use Chrome headless/CDP fallback.
5. Manually spot-check any flow blocked by missing selectors or missing deterministic mocks.
6. Inspect browser storage, network logs, screenshots, traces, server logs, and exported ZIP for secret leakage.
7. Update `findings.md` with pass/fail details, artifacts, and recommended fixes.

## Required Evidence

- Command results for lint/test/build.
- Browser automation method used and browser version.
- Network assertion result for no external provider calls from browser.
- Storage/artifact secret scan result.
- Provider Lab flow screenshots or failure artifacts.
- Export ZIP inspection result.

## Open Dependencies

- None for the maintained Chromium E2E gate.
