# Provider Lab Decisions

## 2026-06-20 — License

- Decision: Apache-2.0.
- Reason: permissive, commercial-friendly, explicit patent protection.

## 2026-06-20 — Provider Lab First

- Decision: Build Provider Lab before deeper editor features.
- Reason: model/provider debugging and capability routing are prerequisites for reliable story/image generation.

## 2026-07-26 — Capability evidence and local R-18 policy

- Decision: represent capability confidence per flag instead of treating every stored `false` as unsupported.
- Decision: trusted local providers (`isLocal` plus loopback/private URL) automatically allow adult input/generation routing; project R-18 remains explicit and default-off.
- Decision: external adult routes accept explicit capability fields, unmoderated provider metadata, or a model-scoped user override. Model names never grant capability evidence, and positive moderation does not become a blanket denial.
- Reason: unknown metadata, transient provider failures, and local-only routing must not force redundant manual configuration or create false unsupported results, while external explicit-content routes must still fail closed.
