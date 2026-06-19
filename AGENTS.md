# AGENTS.md

## User Communication Rules

- Use Chinese when talking to the user.
- Start every user-facing response with a TL;DR that summarizes what was done, why, and whether any decisions were made without the user.
- Include a clear "重点/我的意见" highlight in user-facing responses.
- Directly point out issues, problems, bugs, solutions, and advice.
- Developer explanations should not appear in the final product UI.
- Do not delete functions or features without user permission.

## Team Operations: provider-lab

Team name: `provider-lab`

Goal: build Provider Lab, Model Capability Registry, and NSFW Routing for Pixiv-to-Manga Studio.

Planning root: `.plans/provider-lab/`

### Team Roster

| Role | Agent name | Responsibility |
|---|---|---|
| Team Lead | main conversation | Scope, decisions, phase gates, integration |
| Researcher | researcher | Provider/model/API/NSFW research, read-only source analysis |
| Backend Dev | backend-dev | Provider storage, keytar secrets, model discovery/test API, route checks |
| Frontend Dev | frontend-dev | Provider Lab UI, capability matrix, debug trace UI |
| Reviewer | reviewer | Security/quality review, source read-only |
| E2E Tester | e2e-tester | Browser/API validation and regression checks |

### Key Protocols

| Protocol | Rule |
|---|---|
| Source of truth | `.plans/provider-lab/` files track plans, findings, and progress |
| CI command | `npm run lint && npm test && npm run build` |
| Secret invariant | API keys and Pixiv cookies never go to localStorage, SQLite plaintext, URLs, logs, exported projects, or screenshots |
| Provider invariant | Browser must not call external LLM providers directly with user secrets |
| NSFW invariant | R-18 default-off; explicit images require compatible provider/model flags; unsupported routes fail closed |
| API docs | Backend/frontend API changes require `.plans/provider-lab/docs/api-contracts.md` updates |
| Architecture docs | New components/data flow require `.plans/provider-lab/docs/architecture.md` updates |
| Review trigger | Large feature/new module requires reviewer before phase advancement |

### Status Check

Quick scan order:

1. `.plans/provider-lab/*/progress.md`
2. `.plans/provider-lab/*/findings.md`
3. `.plans/provider-lab/task_plan.md`

### Known Pitfalls

- Do not copy GPL source code into this Apache-2.0 project.
- Do not port the reference site's localStorage secret pattern.
- Do not treat R-18 as only prompt text; routing must check provider/model capability before external calls.
