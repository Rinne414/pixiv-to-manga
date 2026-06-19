# Pixiv-to-Manga Studio v1 Progress

## 2026-06-20

- Implemented Project Backup ZIP export for the v1 "project backup file" requirement.
- Added backend route `POST /api/export/project-backup`.
- Backup ZIP includes:
  - `manifest.json`
  - `project-data.json` database slice
  - copied project asset files under `assets/`
- Added frontend `Export Backup` toolbar action.
- Added tests:
  - `tests/exporter.test.ts` verifies backup ZIP contents.
  - `tests/apiProviderClient.test.ts` verifies API client request shape.
  - `e2e/provider-lab.spec.ts` verifies the browser can invoke backup export.

Remaining v1 audit items to keep checking:

- Stable full manga workflow E2E from local image import -> Analyze Story -> Generate Page -> edit dialogue -> export PNG ZIP.
- Project restore/import from Backup ZIP is not implemented yet; current backup file is migration-ready output only.
- Vite chunk-size warning remains non-blocking but should be addressed before packaging.
