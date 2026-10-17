import { expect, test } from '@playwright/test'

const baseStatus = {
  currentVersion: '0.8.0',
  packageType: 'win-x64',
  canInstall: true,
  settings: { autoCheck: true, lastCheckedAt: null },
  latest: null,
  phase: 'idle',
  progress: null,
  error: null,
  lastResult: null,
}

const newerLatest = {
  version: '0.9.0',
  available: true,
  notesSummary: 'New: faster exports. Fixed: bubble tails.',
  releaseUrl: 'https://github.com/Rinne414/pixiv-to-manga/releases/tag/v0.9.0',
  publishedAt: '2026-10-20T00:00:00Z',
  hasPackage: true,
  assetName: 'pixiv-to-manga-0.9.0-win-x64.zip',
}

test('settings shows the version, the auto-check default, and persists the toggle', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-settings').click()
  const panel = page.getByTestId('update-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('update-current-version')).toContainText(/Version \d+\.\d+\.\d+/)
  const toggle = page.getByTestId('update-auto-check')
  await expect(toggle).toBeChecked()

  await toggle.uncheck()
  await expect.poll(async () => (await (await page.request.get('/api/update/status')).json()).settings.autoCheck).toBe(false)
  await page.reload()
  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('update-auto-check')).not.toBeChecked()
  await page.getByTestId('update-auto-check').check()
  await expect.poll(async () => (await (await page.request.get('/api/update/status')).json()).settings.autoCheck).toBe(true)
})

test('a found update shows the badge, notes, and an install button; failures say nothing changed', async ({ page }) => {
  await page.route('**/api/update/check', (route) =>
    route.fulfill({ json: { ...baseStatus, latest: newerLatest, settings: { autoCheck: true, lastCheckedAt: new Date().toISOString() } } }),
  )
  await page.route('**/api/update/install', (route) =>
    route.fulfill({
      status: 202,
      json: { ...baseStatus, latest: newerLatest, phase: 'error', error: 'SHA256 mismatch: the update was refused.' },
    }),
  )
  await page.goto('/')
  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('update-badge')).toHaveCount(0)

  await page.getByTestId('update-check').click()
  await expect(page.getByTestId('update-badge')).toContainText('0.9.0')
  const available = page.getByTestId('update-available')
  await expect(available).toContainText('Version 0.9.0 is available')
  await expect(available).toContainText('faster exports')
  await expect(page.getByTestId('update-install')).toBeEnabled()
  await page.screenshot({ path: '.playwright-results/update-available.png' })

  await page.getByTestId('update-install').click()
  await expect(page.getByTestId('update-error')).toContainText('SHA256 mismatch')
  await expect(page.getByTestId('update-error')).toContainText('Nothing was changed')
})

test('a source copy explains git pull instead of offering install', async ({ page }) => {
  await page.route('**/api/update/check', (route) =>
    route.fulfill({ json: { ...baseStatus, packageType: null, canInstall: false, latest: newerLatest } }),
  )
  await page.goto('/')
  await page.getByTestId('tab-settings').click()
  await page.getByTestId('update-check').click()
  await expect(page.getByTestId('update-available')).toContainText('git pull')
  await expect(page.getByTestId('update-install')).toHaveCount(0)
})
