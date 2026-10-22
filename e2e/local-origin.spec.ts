import { expect, test } from '@playwright/test'

// Straight to the API server, bypassing the Vite proxy (which rewrites Host).
const serverUrl = `http://127.0.0.1:${Number(process.env.PTM_E2E_SERVER_PORT || 4174)}`
const REFUSED = { error: 'Requests are only accepted from the Studio page on this computer.' }

test('the API and the data folder refuse other web sites but serve the Studio page', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByTestId('tab-settings')).toBeVisible()

  const health = await request.get(`${serverUrl}/api/health`)
  expect(health.ok()).toBe(true)

  // DNS rebinding: a foreign host name that resolves to 127.0.0.1.
  const rebound = await request.get(`${serverUrl}/api/providers`, { headers: { Host: 'evil.example:4174' } })
  expect(rebound.status()).toBe(403)
  expect(await rebound.json()).toEqual(REFUSED)

  const foreignWrite = await request.put(`${serverUrl}/api/settings/secrets`, {
    headers: { Origin: 'https://evil.example' },
    data: { apiBaseUrl: 'https://evil.example/v1' },
  })
  expect(foreignWrite.status()).toBe(403)

  const crossSiteRead = await request.get(`${serverUrl}/assets/studio.sqlite`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
  expect(crossSiteRead.status()).toBe(403)
})
