# e2e-tester Findings Index

## test-provider-lab-flow
- Status: complete
- Report: [test-provider-lab-flow/findings.md](test-provider-lab-flow/findings.md)
- Pass rate: Playwright Chromium E2E passed.
- Summary: Provider Lab and manga workflow regression are now covered by first-class Playwright E2E. The maintained flow verifies keyed provider creation, model discovery/test, trace redaction, browser secret storage checks, no direct browser provider calls, local image import, mock story analysis, mock dialogue generation, editable dialogue persistence, layout adjustment, rendered PNG ZIP export, backup export, and backup restore.

## test-provider-lab-main-thread
- Status: PASS
- Report: [test-provider-lab-main-thread/findings.md](test-provider-lab-main-thread/findings.md)
- Pass rate: API smoke with dummy key passed; lint/test/build/e2e passed.
- Summary: Provider API key save, model discovery/test, redaction, capability patching, the previous Provider Lab horizontal clipping issue, browser Provider Lab flow, and core manga workflow are covered by repeatable validation.
