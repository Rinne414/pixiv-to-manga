import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

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

  await openStudio(page)

  await page.getByLabel('Project title').fill(`E2E Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const providersLoad = page.waitForResponse((response) => response.url().includes('/api/providers') && response.status() === 200)
  const capabilitiesLoad = page.waitForResponse(
    (response) => response.url().includes('/api/model-capabilities') && response.status() === 200,
  )
  await page.getByTestId('tab-settings').click()
  await Promise.all([providersLoad, capabilitiesLoad])
  await expect(page.getByText('Provider Lab')).toBeVisible()
  await expect(page.getByRole('button', { name: /Refresh/ })).toBeEnabled()

  const providerForm = page.locator('.provider-form')
  await expect(providerForm).toBeVisible()
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
  await page.getByTestId('toolbar-export-backup').click()
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

test('main manga workflow imports local art, generates editable dialogue, exports PNG ZIP, and restores backup', async ({
  page,
}) => {
  const directProviderRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('127.0.0.1:5199')) {
      directProviderRequests.push(request.url())
    }
  })

  await openStudio(page)
  await clearProviderProfiles(page)
  await page.getByLabel('Project title').fill(`Workflow Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'workflow-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(workflowSvg()),
  })
  await localImportResponse
  await expect(page.getByText('1 image(s) imported.')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.getByText('Story Bible generated with local mock engine.')).toBeVisible()
  await expect(page.locator('.story-readout')).toBeVisible()

  await page.getByTestId('toolbar-generate-page').click()
  await expect(page.getByText('Page 1 dialogue generated.')).toBeVisible()
  await page.getByTestId('tab-dialogue').click()
  await expect(page.getByTestId('dialogue-chip')).toHaveCount(3)
  await expect(page.getByTestId('page-thumb').first()).toContainText('3 lines / complete')

  const rightRail = page.locator('.right-rail')
  const dialoguePatchResponse = page.waitForResponse(
    (response) => response.url().includes('/api/dialogues/') && response.request().method() === 'PATCH' && response.status() === 200,
  )
  await rightRail.getByLabel('Text').fill('测试对白已经手动改过。')
  await rightRail.getByLabel('Text').blur()
  await dialoguePatchResponse
  await expect(page.getByText('Dialogue saved.')).toBeVisible()

  const lockResponse = page.waitForResponse(
    (response) => response.url().includes('/api/dialogues/') && response.request().method() === 'PATCH' && response.status() === 200,
  )
  await rightRail.getByTestId('dialogue-lock-toggle').click()
  await lockResponse
  await expect(rightRail.getByTestId('dialogue-lock-toggle')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('tab-layout').click()
  const layoutResponse = page.waitForResponse(
    (response) => response.url().includes('/api/pages/') && response.url().includes('/layout') && response.status() === 200,
  )
  await rightRail.getByRole('button', { name: /Avoid overlap/ }).click()
  await layoutResponse
  await expect(page.getByText('Layout adjusted.')).toBeVisible()

  const exportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/export/zip') && response.status() === 200,
  )
  await page.getByTestId('toolbar-export-zip').click()
  const exportedZip = await (await exportResponse).json()
  await expect(page.getByText(/Exported .*\.zip/)).toBeVisible()
  const zip = await JSZip.loadAsync(await readFile(exportedZip.absolutePath))
  expect(zip.file('manifest.json')).toBeTruthy()
  const renderedPage = zip.file('page_001.png')
  expect(renderedPage).toBeTruthy()
  const pngHeader = (await renderedPage!.async('nodebuffer')).subarray(0, 8).toString('hex')
  expect(pngHeader).toBe('89504e470d0a1a0a')

  const backupResponse = page.waitForResponse(
    (response) => response.url().includes('/api/export/project-backup') && response.status() === 200,
  )
  await page.getByTestId('toolbar-export-backup').click()
  const backupZip = await (await backupResponse).json()
  await expect(page.getByText(/Backup exported/)).toBeVisible()

  const restoreResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/project-backup') && response.status() === 200,
  )
  await page.getByTestId('project-backup-input').setInputFiles(backupZip.absolutePath)
  await restoreResponse
  await expect(page.getByText(/Backup restored:/)).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)
  await page.getByTestId('tab-dialogue').click()
  await expect(page.getByTestId('dialogue-chip').filter({ hasText: '测试对白已经手动改过。' })).toBeVisible()

  expect(directProviderRequests).toEqual([])
})

async function openStudio(page: Page) {
  await page.addInitScript(() => {
    window.open = () => null
  })
  await page.goto('/')
  await expect(page).toHaveTitle(/Pixiv-to-Manga Studio/)
  await expect(page.getByRole('heading', { name: 'Pixiv-to-Manga Studio' })).toBeVisible()
  await expect(page.getByText('Studio ready. Local database loaded.')).toBeVisible()
}

async function clearProviderProfiles(page: Page) {
  const response = await page.request.get('/api/providers')
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as { providers: Array<{ id: string }> }
  for (const provider of body.providers) {
    const deleted = await page.request.delete(`/api/providers/${provider.id}`)
    expect(deleted.ok()).toBe(true)
  }
}

function workflowSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#ffffff"/>
  <rect x="72" y="72" width="1056" height="580" fill="#f6f6f6" stroke="#111111" stroke-width="8"/>
  <rect x="72" y="710" width="500" height="370" fill="#ffffff" stroke="#111111" stroke-width="8"/>
  <rect x="628" y="710" width="500" height="370" fill="#ffffff" stroke="#111111" stroke-width="8"/>
  <rect x="72" y="1138" width="1056" height="390" fill="#ffffff" stroke="#111111" stroke-width="8"/>
  <circle cx="420" cy="420" r="112" fill="#eeeeee" stroke="#111111" stroke-width="6"/>
  <circle cx="820" cy="410" r="112" fill="#eeeeee" stroke="#111111" stroke-width="6"/>
  <path d="M322 380 C380 320 470 330 508 410" fill="none" stroke="#111111" stroke-width="12"/>
  <path d="M725 370 C785 318 890 332 918 418" fill="none" stroke="#111111" stroke-width="12"/>
  <ellipse cx="960" cy="250" rx="96" ry="148" fill="#ffffff" stroke="#111111" stroke-width="5"/>
  <text x="990" y="148" writing-mode="vertical-rl" font-family="serif" font-size="38" font-weight="700">一起去看海吧。</text>
</svg>`
}
