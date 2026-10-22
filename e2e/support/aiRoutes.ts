import { expect, type Page } from '@playwright/test'

/**
 * All specs share one server and data folder, so a provider profile or global Base URL left by
 * an earlier spec becomes the active AI engine for later ones. Specs that expect the local mock
 * engine call this first to remove every route the server could pick (see resolveAiRoutes).
 */
export async function clearAiRoutes(page: Page): Promise<void> {
  const list = await page.request.get('/api/providers')
  expect(list.ok()).toBe(true)
  const { providers } = (await list.json()) as { providers: Array<{ id: string }> }
  for (const provider of providers) {
    const deleted = await page.request.delete(`/api/providers/${provider.id}`)
    expect(deleted.ok()).toBe(true)
  }
  const globalRoute = await page.request.put('/api/settings/secrets', { data: { apiBaseUrl: '', modelName: '' } })
  expect(globalRoute.ok()).toBe(true)
}
