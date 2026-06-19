import { expect, test } from '@playwright/test'

const dummySecret = 'provider-e2e-secret-123456'

test('Provider Lab creates a keyed provider, discovers models, tests capabilities, and keeps secrets local', async ({
  page,
}) => {
  const directProviderRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('127.0.0.1:5199')) {
      directProviderRequests.push(request.url())
    }
  })

  await page.goto('/')
  await expect(page).toHaveTitle(/Pixiv-to-Manga Studio/)
  await expect(page.getByRole('heading', { name: 'Pixiv-to-Manga Studio' })).toBeVisible()
  await page.addInitScript(() => {
    window.open = () => null
  })

  await page.getByLabel('Project title').fill(`E2E Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  await page.getByRole('button', { name: /Settings/ }).click()
  await expect(page.getByText('Provider Lab')).toBeVisible()
  await expect(page.getByRole('button', { name: /Refresh/ })).toBeEnabled()

  const providerForm = page.locator('.provider-form')
  await providerForm.getByRole('button', { name: /^New$/ }).click()
  await providerForm.getByLabel('Name').fill(`E2E Mock ${Date.now()}`)
  await providerForm.getByLabel('Base URL').fill('http://127.0.0.1:5199')
  await providerForm.getByLabel('Default model').fill('gpt-4o-smoke')
  await providerForm.getByLabel('API key').fill(dummySecret)
  await providerForm.getByLabel('Local provider').check()
  await providerForm.getByRole('button', { name: /Save/ }).click()

  await expect(page.getByText(/key saved/).first()).toBeVisible()
  await expect(page.getByText(dummySecret)).toHaveCount(0)

  await page.getByRole('button', { name: /Discover/ }).click()
  const modelList = page.locator('.model-list')
  await expect(modelList.getByRole('button', { name: /gpt-4o-smoke/ })).toBeVisible()
  await expect(modelList.getByRole('button', { name: /text-only-smoke/ })).toBeVisible()

  const testControls = page.locator('.provider-section').filter({ hasText: 'Test Controls' })
  await testControls.getByLabel('vision').check()
  await testControls.getByLabel('json').check()
  await testControls.getByLabel('streaming').check()
  await page.getByRole('button', { name: /Run test/ }).click()
  await expect(page.getByText('Redacted trace')).toBeVisible()
  await expect(page.getByText('Pass')).toBeVisible()
  await expect(page.getByText(dummySecret)).toHaveCount(0)
  const traceText = await page.locator('.trace-box').innerText()
  expect(traceText).toContain('[redacted]')
  expect(traceText).toContain('[redacted image payload]')
  expect(traceText).not.toContain(dummySecret)

  const storageDump = await page.evaluate(() =>
    JSON.stringify({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
    }),
  )
  expect(storageDump).not.toContain(dummySecret)

  const backupResponse = page.waitForResponse(
    (response) => response.url().includes('/api/export/project-backup') && response.status() === 200,
  )
  await page.getByRole('button', { name: /Export Backup/ }).click()
  await backupResponse
  await expect(page.getByText(/Backup exported/)).toBeVisible()

  const clipping = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.right-rail, .provider-lab, .provider-section, .provider-form, .provider-grid, .provider-actions, .test-result-grid, .trace-box',
      ),
    ]
      .map((element) => ({
        className: String(element.className),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }))
      .filter((item) => item.scrollWidth > item.clientWidth + 2),
  )
  expect(clipping).toEqual([])

  expect(directProviderRequests).toEqual([])
})
