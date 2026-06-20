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
  const backupZip = (await (await backupResponse).json()) as { absolutePath: string }
  await expect(page.getByText(/Backup exported/)).toBeVisible()
  expect(await zipTextCorpus(backupZip.absolutePath)).not.toContain(dummySecret)

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

test('Pixiv import form downloads mocked artwork with saved cookie and keeps secrets out of backup', async ({ page }) => {
  const pixivCookie = 'PHPSESSID=e2e-pixiv-cookie'
  const directMockRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('127.0.0.1:5199')) {
      directMockRequests.push(request.url())
    }
  })

  await resetMockRequests(page)
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Pixiv UI Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  await page.getByTestId('tab-settings').click()
  await page.getByLabel('Pixiv Cookie').fill(pixivCookie)
  await page.getByRole('button', { name: /Save Settings/ }).click()
  await expect(page.getByText('Settings saved to system credential store.')).toBeVisible()
  await expect(page.getByLabel('Pixiv Cookie')).toHaveValue('')
  await expect(page.getByText(pixivCookie)).toHaveCount(0)

  await page.getByTestId('tab-story').click()
  await page.getByLabel('Pixiv Artwork URL / ID').fill('https://www.pixiv.net/artworks/123456789')
  await page.locator('.toggle-row').filter({ hasText: 'R-18 enabled locally' }).getByRole('checkbox').check()
  const pixivImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/pixiv') && response.status() === 200,
  )
  await page.locator('.pixiv-form').getByRole('button', { name: /^Import Pixiv$/ }).click()
  await pixivImportResponse
  await expect(page.getByText('Pixiv artwork imported.')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)
  await expect(page.locator('.canvas-meta')).toContainText('320x480')

  const mockRequests = await getMockRequests(page)
  const pageApiRequest = mockRequests.find((request) => request.url.includes('/ajax/illust/123456789/pages'))
  const imageRequest = mockRequests.find((request) => request.url.includes('/pixiv-assets/123456789_p0.png'))
  expect(pageApiRequest?.headers.cookie).toBe(pixivCookie)
  expect(imageRequest?.headers.cookie).toBe(pixivCookie)
  expect(imageRequest?.headers.referer).toBe('https://www.pixiv.net/artworks/123456789')

  const storageDump = await browserStorageDump(page)
  expect(storageDump).not.toContain(pixivCookie)

  const backupResponse = page.waitForResponse(
    (response) => response.url().includes('/api/export/project-backup') && response.status() === 200,
  )
  await page.getByTestId('toolbar-export-backup').click()
  const backupZip = (await (await backupResponse).json()) as { absolutePath: string }
  await expect(page.getByText(/Backup exported/)).toBeVisible()
  expect(await zipTextCorpus(backupZip.absolutePath)).not.toContain(pixivCookie)
  expect(directMockRequests).toEqual([])
})

test('raw AI output is shown when model JSON repair fails', async ({ page }) => {
  const directProviderRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('127.0.0.1:5199')) {
      directProviderRequests.push(request.url())
    }
  })

  await openStudio(page)
  await clearProviderProfiles(page)
  await page.getByLabel('Project title').fill(`Raw Output Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'raw-output-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(workflowSvg()),
  })
  await localImportResponse

  const providerResponse = await page.request.post('/api/providers', {
    data: {
      name: `Invalid JSON ${Date.now()}`,
      baseUrl: 'http://127.0.0.1:5199',
      defaultModel: 'invalid-json-smoke',
      isLocal: true,
      apiKey: dummySecret,
    },
  })
  expect(providerResponse.ok()).toBe(true)
  const providerBody = (await providerResponse.json()) as { provider: { id: string } }
  const discoverResponse = await page.request.post(`/api/providers/${providerBody.provider.id}/models/discover`)
  expect(discoverResponse.ok()).toBe(true)
  const discoverBody = (await discoverResponse.json()) as { models: Array<{ id: string; modelId: string }> }
  const capability = discoverBody.models.find((model) => model.modelId === 'invalid-json-smoke')
  expect(capability).toBeTruthy()
  const capabilityResponse = await page.request.patch(`/api/model-capabilities/${capability!.id}`, {
    data: {
      supportsVision: true,
      supportsStreaming: true,
      supportsJsonSchema: false,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    },
  })
  expect(capabilityResponse.ok()).toBe(true)

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.getByText(/AI output could not be parsed after repair/)).toBeVisible()
  await page.getByText('Raw AI Output').click()
  await expect(page.getByTestId('raw-ai-output')).toHaveValue(/invalid-json-smoke output/)
  expect(directProviderRequests).toEqual([])
})

test('active generation jobs can be cancelled from the toolbar', async ({ page }) => {
  const directProviderRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('127.0.0.1:5199')) {
      directProviderRequests.push(request.url())
    }
  })

  await openStudio(page)
  await clearProviderProfiles(page)
  await page.getByLabel('Project title').fill(`Cancel Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'cancel-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(workflowSvg()),
  })
  await localImportResponse

  const providerResponse = await page.request.post('/api/providers', {
    data: {
      name: `Slow JSON ${Date.now()}`,
      baseUrl: 'http://127.0.0.1:5199',
      defaultModel: 'slow-json-smoke',
      isLocal: true,
      apiKey: dummySecret,
    },
  })
  expect(providerResponse.ok()).toBe(true)
  const providerBody = (await providerResponse.json()) as { provider: { id: string } }
  const discoverResponse = await page.request.post(`/api/providers/${providerBody.provider.id}/models/discover`)
  expect(discoverResponse.ok()).toBe(true)
  const discoverBody = (await discoverResponse.json()) as { models: Array<{ id: string; modelId: string }> }
  const capability = discoverBody.models.find((model) => model.modelId === 'slow-json-smoke')
  expect(capability).toBeTruthy()
  const capabilityResponse = await page.request.patch(`/api/model-capabilities/${capability!.id}`, {
    data: {
      supportsVision: true,
      supportsStreaming: true,
      supportsJsonSchema: false,
      allowsAdultInput: false,
      allowsAdultGeneration: false,
    },
  })
  expect(capabilityResponse.ok()).toBe(true)

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.getByTestId('toolbar-cancel-job')).toBeEnabled()
  await page.getByTestId('toolbar-cancel-job').click()
  await expect(page.getByText('Cancellation requested.')).toBeVisible()
  await expect(page.getByText('Job cancelled.')).toBeVisible()
  await expect(page.getByTestId('toolbar-cancel-job')).toBeDisabled()
  expect(directProviderRequests).toEqual([])
})

test('workspace remains usable without page-level horizontal overflow on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Narrow Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'large-narrow-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(workflowSvg(2400, 3200)),
  })
  await localImportResponse
  await expect(page.getByTestId('toolbar-import-local')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)
  await expect(page.locator('.canvas-meta')).toContainText('2400x3200')
  const stageBox = await page.getByTestId('manga-stage').boundingBox()
  expect(stageBox?.height).toBeLessThanOrEqual(704)
  await page.getByTestId('tab-layout').click()
  await expect(page.getByText('Canvas zoom')).toBeVisible()

  const clipping = await page.evaluate(() =>
    ['body', '.studio-shell', '.topbar', '.toolbar', '.workspace-grid', '.left-rail', '.right-rail']
      .map((selector) => {
        const element = document.querySelector(selector)
        return element
          ? {
              selector,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            }
          : null
      })
      .filter((item): item is { selector: string; scrollWidth: number; clientWidth: number } => Boolean(item))
      .filter((item) => item.scrollWidth > item.clientWidth + 2),
  )
  expect(clipping).toEqual([])
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
  await page.getByTestId('local-image-input').setInputFiles([
    {
      name: 'workflow-page-1.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(workflowSvg()),
    },
    {
      name: 'workflow-page-2.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(workflowSvg()),
    },
  ])
  await localImportResponse
  await expect(page.getByText('2 image(s) imported.')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(2)
  await expect(page.locator('.canvas-meta')).toContainText('800x1000')

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.getByText('Story Bible generated with local mock engine.')).toBeVisible()
  await expect(page.getByTestId('story-synopsis-input')).toBeVisible()

  const storySaveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/projects/') && response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('story-synopsis-input').fill('手动修改后的故事圣经。')
  await page.getByTestId('story-synopsis-input').blur()
  await storySaveResponse
  await expect(page.getByText('Story Bible saved.').first()).toBeVisible()

  await page.getByTestId('tab-characters').click()
  const characterSaveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/projects/') && response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('character-name-input').first().fill('手动夏海')
  await page.getByTestId('character-name-input').first().blur()
  await characterSaveResponse
  await expect(page.getByText('Story Bible saved.').first()).toBeVisible()

  await page.getByTestId('toolbar-generate-page').click()
  await expect(page.getByText('Page 1 dialogue generated.')).toBeVisible()
  await expect(page.getByTestId('page-thumb').first()).toContainText('3 lines / complete')
  await page.getByTestId('toolbar-generate-all').click()
  await expect(page.getByText('All pages generated.')).toBeVisible()
  await expect(page.getByTestId('page-thumb').filter({ hasText: '3 lines / complete' })).toHaveCount(2)
  await page.getByTestId('tab-dialogue').click()
  await expect(page.getByTestId('dialogue-chip')).toHaveCount(3)

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
  expect(zip.file('page_002.png')).toBeTruthy()
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
  await expect(page.getByTestId('page-thumb')).toHaveCount(2)
  await page.getByTestId('tab-dialogue').click()
  await expect(page.getByTestId('dialogue-chip').filter({ hasText: '测试对白已经手动改过。' })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Studio ready. Local database loaded.')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(2)
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

async function resetMockRequests(page: Page) {
  const response = await page.request.post('http://127.0.0.1:5199/requests/reset')
  expect(response.ok()).toBe(true)
}

async function getMockRequests(page: Page): Promise<
  Array<{ method: string; url: string; headers: Record<string, string>; body: string }>
> {
  const response = await page.request.get('http://127.0.0.1:5199/requests')
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as {
    requests: Array<{ method: string; url: string; headers: Record<string, string>; body: string }>
  }
  return body.requests
}

async function browserStorageDump(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
    }),
  )
}

async function zipTextCorpus(zipPath: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  const parts: string[] = []
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) {
      parts.push(name)
      parts.push((await entry.async('nodebuffer')).toString('utf8'))
    }
  }
  return parts.join('\n')
}

function workflowSvg(width = 800, height = 1000): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="48" y="48" width="704" height="360" fill="#f6f6f6" stroke="#111111" stroke-width="6"/>
  <rect x="48" y="452" width="332" height="232" fill="#ffffff" stroke="#111111" stroke-width="6"/>
  <rect x="420" y="452" width="332" height="232" fill="#ffffff" stroke="#111111" stroke-width="6"/>
  <rect x="48" y="724" width="704" height="228" fill="#ffffff" stroke="#111111" stroke-width="6"/>
  <circle cx="280" cy="260" r="74" fill="#eeeeee" stroke="#111111" stroke-width="5"/>
  <circle cx="548" cy="254" r="74" fill="#eeeeee" stroke="#111111" stroke-width="5"/>
  <path d="M214 238 C254 200 314 210 338 268" fill="none" stroke="#111111" stroke-width="8"/>
  <path d="M484 232 C524 198 592 210 612 272" fill="none" stroke="#111111" stroke-width="8"/>
  <ellipse cx="640" cy="164" rx="64" ry="94" fill="#ffffff" stroke="#111111" stroke-width="4"/>
  <text x="660" y="96" writing-mode="vertical-rl" font-family="serif" font-size="28" font-weight="700">一起去看海吧。</text>
</svg>`
}
