# Invariants

## Secrets

- API keys and Pixiv cookies must never be stored in localStorage.
- API keys and Pixiv cookies must never be stored in SQLite/plaintext files.
- API keys and Pixiv cookies must never appear in URLs, query strings, logs, job events, screenshots, or exported project files.
- If keytar/system credential storage is unavailable, secret save must fail closed.

## Provider Calls

- Browser must not call external LLM providers directly with user secrets.
- All LLM requests must go through the local backend.
- Provider debug traces must redact Authorization, API keys, cookies, and image payloads.
- Provider debug traces must also redact provider response bodies if the provider echoes request secrets or image payloads.
- External provider base URLs must be public HTTPS; localhost/private-network HTTP endpoints require explicit local-provider mode.
- Provider model discovery paths must be relative paths, not arbitrary absolute URLs.

## NSFW Routing

- R-18 is default-off and must be explicitly enabled by the user.
- External R-18 generation must fail closed unless the active model has a matching Provider Lab capability record with adult generation allowed.
- Explicit images must not be sent to external providers unless provider/model capability explicitly allows adult image input.
- Unknown or failed image safety classification must block image routing.
- Models without vision support must not receive image payloads.
- Illegal sexual content and apparent-minor sexual content must be blocked regardless of user settings.

## Pixiv Import

- Backend accepts Pixiv artwork URL/ID only.
- No arbitrary URL image proxy.
- Pixiv Cookie must not be passed in query strings.
