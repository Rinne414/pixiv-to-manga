# Provider Lab Team Findings Index

## Quick Notes

- Team initialized for Provider Lab, Model Capability Registry, and NSFW Routing.
- 2026-07-26 audit found and fixed false unsupported states caused by discarded provider metadata, boolean-only persistence, invalid vision probe data, HTTP-only probe validation, opt-in test defaults, and model-wide provenance. Model-name capability inference was subsequently removed because it cannot scale across external providers.
- 2026-07-30 Pixiv batch work adopted the reference downloader's preview/selection, explicit task state, rate-limit handling, and recovery behavior while keeping this product bounded to 50 explicit artworks and 200 images. GPL source, names, and copy were not ported.

## Bounded Pixiv Import Findings

- Public artwork requests should remain anonymous by default. `usePixivSession` exists for private non-R-18 work, and R-18 forces session use.
- Pixiv automation cannot be described as account-risk free. The UI explains rate limits, authentication challenges, session invalidation, and possible account restrictions.
- A browser-only disabled Resume button is insufficient for rate limits. The backend rejects early resume during a persisted 429 cooldown, persists the global cooldown separately from a task, and restores the shared throttle before any new Pixiv request after restart.
- All previews and download tasks share serial request scheduling. This prevents multiple visible tasks from multiplying request concurrency.
- A streamed 30 MB limit, strict MIME/dimension checks, stable task-item file paths, and an atomic asset/page/import-record transaction keep failures explicit and prevent partial duplicate pages.

## Researcher Findings

- [complete] Provider capability research: `.plans/provider-lab/researcher/research-provider-capabilities/findings.md`
  - `/v1/models` formats differ widely and often lack capability flags. Recommendation: metadata seed + backend active probes + user confirmation for adult image support.
- [complete] NSFW routing research: `.plans/provider-lab/researcher/research-nsfw-routing/findings.md`
  - Recommendation: local classifier before external vision calls; unknown/classifier failure fails closed; explicit image routing requires R-18 opt-in, vision support, and adult-image capability confirmation.
