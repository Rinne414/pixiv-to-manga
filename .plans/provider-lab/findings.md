# Provider Lab Team Findings Index

## Quick Notes

- Team initialized for Provider Lab, Model Capability Registry, and NSFW Routing.

## Researcher Findings

- [complete] Provider capability research: `.plans/provider-lab/researcher/research-provider-capabilities/findings.md`
  - `/v1/models` formats differ widely and often lack capability flags. Recommendation: metadata seed + backend active probes + user confirmation for adult image support.
- [complete] NSFW routing research: `.plans/provider-lab/researcher/research-nsfw-routing/findings.md`
  - Recommendation: local classifier before external vision calls; unknown/classifier failure fails closed; explicit image routing requires R-18 opt-in, vision support, and adult-image capability confirmation.
