# backend-dev Task Plan

## Tasks

- [x] task-provider-backend: Implement provider profile storage, keytar-backed secrets, model discovery/test endpoints, capability registry, and NSFW route checks.

## Acceptance Criteria

- No secrets in SQLite/logs/responses.
- Zod validation for all new inputs.
- Tests cover provider CRUD, secret redaction, model discovery parsing, capability validation, and NSFW route blocking.
- `.plans/provider-lab/docs/api-contracts.md` and `architecture.md` updated with actual implementation.
