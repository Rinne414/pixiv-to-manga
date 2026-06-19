# Pixiv-to-Manga Studio Research Decisions

## Open Source Reference Projects

### Strong References

- Manga Editor Desu
  - Reference value: editor UX, panel layouts, speech bubbles, layers, undo/redo, export, local image generation backend integration.
  - License risk: GPL-3.0. Do not copy code unless this project also adopts GPL-compatible distribution.
  - Use now: product and UX reference only.

- manga-image-translator
  - Reference value: manga translation pipeline, detection, inpainting, rendering, batch workflow.
  - License risk: GPL-3.0. Do not copy code unless this project also adopts GPL-compatible distribution.
  - Use now: pipeline reference only; OCR/cleaning is not v1 core.

- MangaTranslator
  - Reference value: speech bubble detection, SAM integration, text rendering, ZIP batch, LLM translation.
  - License: Apache-2.0.
  - Use now: safe to study more deeply for future translation-plugin mode.

- ComfyUI PanelForge
  - Reference value: panel/page composition, speech bubble workflow, sequential art generation graph.
  - License: MIT.
  - Use now: safe to study for future storyboard/panel-generation workflow.

## License Decision Notes

- Decision: Pixiv-to-Manga Studio uses Apache-2.0.
- Do not adopt GPL only because GPL projects are convenient to copy.
- Keep the core project permissive unless there is a clear decision to build a GPL community project.
- Apache-2.0 is the project default because it keeps commercial flexibility and includes explicit patent protection.
- GPL projects can still be used as product references, but their code should not be copied into the permissive core.
- If we later decide to directly reuse GPL code from Manga Editor Desu or manga-image-translator, re-evaluate whether the whole project should become GPL-3.0.

## Local Vision / NSFW Model Direction

### Candidate Local VLMs

- Qwen2.5-VL-7B-Instruct
  - First candidate for local testing.
  - Reason: strong vision-language ability, coordinates/layout understanding, OpenAI-compatible serving examples exist.

- InternVL3.5 8B/14B
  - Second candidate.
  - Reason: strong multimodal ability, but deployment may be heavier.

- Gemma 3 vision models
  - Backup candidate.
  - Reason: capable text+image input, but likely more conservative for adult content.

### NSFW Routing Principle

- R-18 remains explicit opt-in and default-off.
- Mark each asset as `safe`, `suggestive`, `explicit`, or `unknown`.
- External providers must have capability flags:
  - `supportsVision`
  - `allowsAdultInput`
  - `allowsAdultGeneration`
  - `supportsJsonSchema`
  - `supportsStreaming`
- If a model does not support image input, do not send images.
- If a model does not allow adult input, do not send NSFW images.
- Prefer local-only processing for explicit images unless the user explicitly selects a compatible external provider.
- Never route illegal sexual content or apparent-minor sexual content through any model path.

## Reference Site Findings

Target: `https://pixiv-manga-maker-923628949222.us-west1.run.app/`

Observed implementation pattern:

- Vite/React single-page prototype.
- Pixiv artwork ID parsing in frontend.
- Backend endpoints include Pixiv metadata and image proxy behavior.
- Frontend stores settings such as API URL, model name, API key, Pixiv cookie, R-18 flags, prompt settings, font settings in `localStorage`.
- Frontend sends OpenAI-compatible `/chat/completions` requests directly to the user-configured API URL.
- Vision calls include current page image as base64 data URL and sometimes the next page image for continuity.
- Two-stage generation:
  - project/story context and characters
  - per-page dialogue and layout
- Uses text density modes and custom style prompts.
- Includes JSON repair/retry logic.
- Supports normalized dialogue layout data: text, x, y, scale, rotation.
- Includes collision/overlap adjustment.
- Supports font upload and export.

What to reference:

- Current page plus next page as vision context.
- Text density modes: short, standard, verbose.
- Custom style prompt optimization.
- Character profile reuse across pages.
- JSON repair and multiple retry attempts.
- Font upload and reusable font library.
- Dialogue collision avoidance and normalized layout.
- Batch page range generation, cancellation, logs, ZIP export.

What not to copy:

- Do not store API keys or Pixiv cookies in `localStorage`.
- Do not put Pixiv cookies in query strings.
- Do not expose arbitrary image proxy behavior.
- Do not let the browser directly call external LLM APIs with saved secrets.
- Do not treat R-18 as only a prompt switch; route by model/provider capability.
