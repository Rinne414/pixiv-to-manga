# Pixiv-to-Manga Studio v1 Progress

## 2026-06-20

- Implemented Project Backup ZIP export for the v1 "project backup file" requirement.
- Added backend route `POST /api/export/project-backup`.
- Added backend route `POST /api/import/project-backup` for restoring backup ZIP files as new local projects.
- Backup ZIP includes:
  - `manifest.json`
  - `project-data.json` database slice
  - copied project asset files under `assets/`
- Added frontend `Export Backup` toolbar action.
- Added frontend `Restore Backup` toolbar action.
- Updated external AI generation to send local page images as OpenAI-compatible `image_url` content and to require matching vision/adult capability gates.
- Main AI generation can now use saved Provider Lab provider keys when global generation settings are empty or missing a matching API key.
- Added one-shot AI JSON repair retry before surfacing invalid model output.
- AI JSON repair failure now preserves original and repaired raw model output through the local job event stream, and the Studio shows it in a Raw AI Output panel for manual correction.
- Converted story analysis and page dialogue generation to asynchronous local jobs:
  - `POST /api/story/analyze` and `POST /api/pages/:pageId/generate` now return `jobId` immediately.
  - `GET /api/jobs/:jobId/events` streams queued/progress/complete/error/cancelled events with history replay for fast jobs.
  - `POST /api/jobs/:jobId/cancel` aborts pending AI requests through `AbortSignal`.
  - The Studio toolbar now exposes a Cancel action for active generation jobs.
- Added editable Story Bible and character output:
  - `PUT /api/projects/:projectId/story-bible` validates and saves user-edited Story Bible JSON.
  - Story inspector supports editing synopsis, tone, page beats, and Story Bible R-18 flag.
  - Characters inspector supports editing name, description, voice, color, and default bubble style.
- Local and Pixiv imports now detect PNG, JPEG, WebP, and SVG dimensions and store real page/asset sizes instead of defaulting every page to 1200x1600.
- Added stable toolbar/input/tab/dialogue test selectors and ARIA state for browser E2E and accessibility.
- Added tests:
  - `tests/aiVision.test.ts` verifies local images are sent to vision-capable models and blocked for unconfirmed image routes.
  - `tests/aiVision.test.ts` verifies abort signals are passed to initial and repair AI calls.
  - `tests/aiVision.test.ts` verifies raw model output is kept when JSON repair still fails.
  - `tests/jobs.test.ts` verifies job history replay, cancel signal handling, and terminal-state protection.
  - `tests/exporter.test.ts` verifies backup ZIP contents and restore round-trip.
  - `tests/pixivImport.test.ts` verifies mock Pixiv import, R-18 cookie forwarding, source URL capture, and imported image dimensions.
  - `tests/apiProviderClient.test.ts` verifies backup export/restore API client request shape, Story Bible save requests, and job event completion.
  - `tests/imageDimensions.test.ts` verifies PNG/JPEG/WebP/SVG dimension parsing and local import persistence.
  - `e2e/provider-lab.spec.ts` verifies Provider Lab, raw AI output display after JSON repair failure, toolbar job cancellation, and the full local manga workflow including manual Story Bible and character edits.
- Added Vite/Rolldown code splitting for React, Konva, icons, and ZIP-heavy dependencies; production build no longer emits the chunk-size warning.

Remaining v1 audit items to keep checking:

- No known v1 audit item is currently recorded here; continue requirement-by-requirement verification before marking the overall goal complete.
