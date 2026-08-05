# research-nsfw-routing Findings

Status: complete

## Sources

- NSFWJS GitHub: https://github.com/infinitered/nsfwjs
- NSFWJS model classes: https://github.com/gantman/nsfw_model
- NudeNet PyPI: https://pypi.org/project/nudenet/2.0.0/
- NudeNet TFJS/Node detector fork: https://github.com/vladmandic/nudenet
- OpenAI moderation guide: https://developers.openai.com/api/docs/guides/moderation
- OpenAI usage policies: https://openai.com/policies/usage-policies/
- OpenAI Model Spec child sexual content rule: https://model-spec.openai.com/2025-02-12.html
- Anthropic content moderation guide: https://platform.claude.com/docs/en/about-claude/use-case-guides/content-moderation
- Anthropic child safety principles: https://www.anthropic.com/news/child-safety-principles
- Gemini API safety settings: https://ai.google.dev/gemini-api/docs/safety-settings
- Google configurable/non-configurable content filters: https://cloud.google.com/blog/products/ai-machine-learning/enhance-gemini-model-security-with-content-filters-and-system-instructions

## Local NSFW image classification options

### NSFWJS

NSFWJS is JavaScript/TensorFlow.js based and can run in browser or Node. It returns class probabilities. Common classes are `Drawing`, `Hentai`, `Neutral`, `Porn`, and `Sexy`.

Strengths:

- Fits an Electron/TypeScript stack better than Python.
- Can run locally without sending images to external providers.
- Good first-pass classifier for manga/anime because it has a `Hentai` class.

Risks:

- It is a general classifier, not a policy engine.
- `Sexy` is suggestive rather than necessarily explicit.
- It does not identify age, consent, or illegal content. It must not be used to "allow" content by itself.

### NudeNet

NudeNet offers classification (`safe` / `unsafe`) and object/body-part detection. Detector classes include exposed breasts, genitalia, buttocks, and related covered/provocative categories.

Strengths:

- More actionable for explicit image routing because body-part detector outputs can map to an `explicitImage` flag.
- Useful for censor/blur previews if the product later needs that.

Risks:

- Python dependency adds packaging friction for an Electron app unless run as a sidecar.
- Body-part detection is not the same as policy compliance.
- False positives on art, anatomy, medical, swimwear, or edge cases remain possible.

### Recommended v1 classifier strategy

Use local classification as a risk signal, not as final policy truth:

- Start with NSFWJS in Node/Electron backend for low-friction local triage.
- Add NudeNet later if body-part-level explicit detection is required.
- Store only derived scores/labels in job metadata; do not store image thumbnails or classifier debug images in logs.
- Use thresholds conservatively:
  - `explicitLikely`: `Porn` or `Hentai` high confidence, or NudeNet exposed genitalia/exposed breast/exposed buttocks above threshold.
  - `suggestiveLikely`: NSFWJS `Sexy` high confidence or NudeNet covered/provocative body-part detections.
  - `unknown`: low confidence or classifier failure.

Classifier failure must not unlock external routing. Failure means unknown, and unknown fails closed for R-18/image forwarding.

## External model fail-closed routing

Rules for v1:

- If a request has no image, normal text routing can proceed subject to provider policy and user settings.
- If a request includes an image and model `inputModalities.image !== "supported"`, block before provider call.
- If local classifier says explicit/suggestive/unknown and `r18Enabled` is false, block before provider call.
- If image is explicit and provider/model `safety.explicitImageInput !== "supported"` or `adultImageInput !== "supported"`, block before provider call.
- If provider/model adult support is unknown, block. Do not prompt-engineer around provider policy.
- Illegal sexual content and apparent-minor sexual content must be blocked regardless of user setting or provider capability.
- For external providers, adult image support must be `user_confirmed` or stronger project-maintained allowlist. Provider metadata alone is not enough.
- For local providers, explicit images may route only when `r18Enabled` is true, model has vision support, and the user explicitly marks the local model as allowed for explicit input.

Important source-backed caveat: Anthropic documents that Claude may still flag explicit content for moderation even if prompted not to. Gemini has configurable safety settings but also non-configurable blocks for prohibited content. OpenAI documents moderation for text/images and policies around minors/age-inappropriate sexual content. Therefore the app cannot assume external provider acceptance even when a request is legal and user-enabled.

## Recommended v1 NSFW route decision tree

```text
1. Receive generation/analyze request.
2. Determine payload risk:
   - hasImage?
   - r18Requested?
   - user r18Enabled?
   - local classifier result: safe | suggestive | explicit | unknown | failed
   - apparentMinorOrIllegal? from metadata/user tags/manual flags/classifier if available

3. Hard blocks:
   - If apparentMinorOrIllegal: BLOCK_ILLEGAL_OR_MINOR_SAFETY
   - If hasImage and model image input is not supported: BLOCK_MODEL_NO_VISION
   - If r18Requested or classifier is suggestive/explicit/unknown and r18Enabled is false: BLOCK_R18_DISABLED

4. External provider checks:
   - If hasImage and provider is external and classifier is explicit:
     - require adultImageInput=supported
     - require explicitImageInput=supported
     - require capabilitySource=user_confirmed or trusted_allowlist
     - otherwise BLOCK_PROVIDER_ADULT_IMAGE_UNSUPPORTED
   - If hasImage and provider is external and classifier is unknown/failed:
     - BLOCK_CLASSIFICATION_UNKNOWN

5. Local provider checks:
   - If hasImage and classifier is explicit:
     - require local provider/model vision support
     - require user-confirmed explicit local input support
     - otherwise BLOCK_LOCAL_MODEL_NOT_CONFIRMED

6. Allow route:
   - Attach redacted route decision metadata.
   - Never include classifier raw image, API key, Authorization, cookies, or base64 image in logs.
```

## Recommended route decision fields

```ts
interface NsfwRouteDecision {
  decision: "allow" | "block";
  reason:
    | "SAFE_ROUTE"
    | "BLOCK_ILLEGAL_OR_MINOR_SAFETY"
    | "BLOCK_MODEL_NO_VISION"
    | "BLOCK_R18_DISABLED"
    | "BLOCK_CLASSIFICATION_UNKNOWN"
    | "BLOCK_PROVIDER_ADULT_IMAGE_UNSUPPORTED"
    | "BLOCK_LOCAL_MODEL_NOT_CONFIRMED";
  hasImage: boolean;
  r18Requested: boolean;
  r18Enabled: boolean;
  providerScope: "local" | "external" | "unknown";
  classifier: {
    status: "safe" | "suggestive" | "explicit" | "unknown" | "failed";
    engine: "nsfwjs" | "nudenet" | "none";
    scores?: Record<string, number>;
  };
  requiredCapabilities: string[];
  missingCapabilities: string[];
  redactedTraceId: string;
}
```

## Risks

- NSFW classifiers cannot determine age or consent; never use them as an allowlist for illegal/minor safety.
- Manga/anime images can increase false positives and false negatives. Thresholds need local test fixtures.
- Provider policies and model filters change. User confirmation should expire or be revalidated after provider/model changes.
- Debug traces are high risk because image payloads may be base64 strings. Redact image content entirely.

## Recommendation

For v1, prefer fail-closed over convenience:

- Local classifier runs before any external vision call.
- `unknown` and classifier failure block external R-18/image routing.
- External explicit image routing requires explicit user opt-in plus model/provider capability marked supported.
- Local models are the preferred route for explicit images. The implemented policy treats `isLocal` plus the project-level R-18 opt-in as sufficient adult-route confirmation; vision support remains independently required.
