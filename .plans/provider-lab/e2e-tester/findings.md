# e2e-tester Findings Index

## test-provider-lab-flow
- Status: planned - awaiting testable build
- Report: [test-provider-lab-flow/findings.md](test-provider-lab-flow/findings.md)
- Pass rate: pending
- Summary: Provider Lab E2E flow and existing manga workflow regression plan are ready. Execution is blocked until team-lead provides a testable build.

## test-provider-lab-main-thread
- Status: PASS_WITH_NOTE
- Report: [test-provider-lab-main-thread/findings.md](test-provider-lab-main-thread/findings.md)
- Pass rate: API smoke with dummy key passed; lint/test/build passed; browser CDP harness remains unstable.
- Summary: Provider API key save, model discovery/test, redaction, capability patching, and the previous Provider Lab horizontal clipping issue are fixed. A first-class Playwright suite is still recommended for future stable browser automation.
