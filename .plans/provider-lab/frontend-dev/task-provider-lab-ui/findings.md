# task-provider-lab-ui Findings

## 2026-06-20

- Implemented Provider Lab UI in the existing Settings inspector without replacing the existing settings form.
- Added typed frontend API clients for provider profiles, model discovery, provider tests, and capability records.
- API keys are write-only in the UI. The field is cleared after save and the list only displays `hasApiKey`.
- Browser-side code only calls local `/api/...` endpoints and does not call external model providers directly.
- Added model discovery empty/error states because backend Provider Lab endpoints are not present in the current server code yet.
- Capability save currently requires a backend-created capability record from discovery or test; the UI does not invent permanent capability IDs.
- Added concise NSFW route hints based on `supportsVision`, provider locality, `allowsAdultInput`, and `allowsAdultGeneration`.

## Backend Dependencies

- `GET /api/providers`
- `POST /api/providers`
- `PATCH /api/providers/:id`
- `DELETE /api/providers/:id`
- `POST /api/providers/:id/models/discover`
- `POST /api/providers/:id/test`
- `GET /api/model-capabilities`
- `PATCH /api/model-capabilities/:id`

## Verification Notes

- `npm run lint` passes.
- `npm run build` passed once after the frontend implementation.
- A later `npm run build` failed on existing/out-of-scope backend TypeScript errors in `server/providers.ts`:
  - `contextWindow` accepts `null` where target type expects `number | undefined`.
  - model discovery parsing narrows to a union that may not have `data` or `models`.
  - discovery callback parameters have implicit `any` types.
