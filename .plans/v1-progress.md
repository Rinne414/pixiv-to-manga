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
- Added stable toolbar/input/tab/dialogue test selectors and ARIA state for browser E2E and accessibility.
- Added tests:
  - `tests/aiVision.test.ts` verifies local images are sent to vision-capable models and blocked for unconfirmed image routes.
  - `tests/exporter.test.ts` verifies backup ZIP contents and restore round-trip.
  - `tests/apiProviderClient.test.ts` verifies backup export/restore API client request shape.
  - `e2e/provider-lab.spec.ts` verifies Provider Lab plus the full local manga workflow.

Remaining v1 audit items to keep checking:

- Vite chunk-size warning remains non-blocking but should be addressed before packaging.
