# Provider Lab Team Plan

## Goal

Build the next development slice for Pixiv-to-Manga Studio: Provider Lab, Model Capability Registry, and NSFW Routing.

## Success Criteria

- Users can save and switch multiple OpenAI-compatible provider profiles without exposing secrets to localStorage, URLs, or logs.
- Users can discover/test models and see capability results for text, vision, JSON, streaming, and adult-content routing.
- Backend has explicit capability metadata and route checks before sending image or R-18 content to any model.
- UI exposes a practical Provider Lab inside the existing studio without breaking the manga creation workflow.
- Tests cover secret handling, capability validation, unsafe routing blocks, model discovery parsing, and key UI flows.

## Team

- team-lead: main conversation, scope control, integration decisions.
- researcher: research provider/model capability APIs and local VLM deployment options.
- backend-dev: implement provider profile storage, model discovery/test endpoints, capability/routing backend.
- frontend-dev: implement Provider Lab UI and integrate it with existing Settings/Inspector.
- reviewer: security and architecture review of changed code.
- e2e-tester: browser and API flow validation.

## Phase Plan

### Phase 1: Research and Contracts

- Status: complete
- Research provider/model discovery API shapes and capability flags.
- Document backend/frontend API contracts.
- Confirm invariants around secrets, NSFW routing, and image forwarding.

### Phase 2: Backend Slice

- Status: complete
- Add provider profile metadata storage in SQLite.
- Keep API keys in keytar only.
- Add model discovery endpoint.
- Add provider test endpoint for text/vision/JSON/streaming.
- Add capability registry and NSFW route blocker.

### Phase 3: Frontend Slice

- Status: complete
- Add Provider Lab UI.
- Show provider list, capability matrix, test controls, debug trace.
- Keep secrets write-only in UI.

### Phase 4: Review and E2E

- Status: complete_with_note
- Run CI, review security, verify browser flows.
- Reviewer re-review verdict: `[OK]`.
- Provider Lab API smoke with dummy API key passed against local mock provider.
- E2E-reported keytar runtime bug and Provider Lab horizontal clipping were fixed.
- First-class Playwright Chromium E2E now covers Provider Lab keyed provider creation, model discovery/test, redaction, and clipping checks.

## Active Decisions

- License: Apache-2.0.
- No API keys or Pixiv cookies in localStorage.
- No secrets in URLs or logs.
- Explicit NSFW opt-in and model/provider capability route checks.
- Local models are preferred for explicit images unless an external provider is explicitly marked compatible by the user.
