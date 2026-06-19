# researcher Findings Index

## research-provider-capabilities
- Status: complete
- Report: [research-provider-capabilities/findings.md](research-provider-capabilities/findings.md)
- Summary: `/v1/models` is usually insufficient for risky capability decisions. Use provider metadata as a seed, backend active probes for text/vision/streaming/JSON, and user confirmation for adult image input.

## research-nsfw-routing
- Status: complete
- Report: [research-nsfw-routing/findings.md](research-nsfw-routing/findings.md)
- Summary: Use local classifier results as risk signals, not allow decisions. Unknown/classifier failure fails closed for external image/R-18 routes; explicit images require R-18 opt-in, vision support, and adult-image capability confirmation.
