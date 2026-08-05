import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

const dummySecret = 'provider-e2e-secret-123456'

test('Provider Lab keeps local and external connection modes mutually exclusive', async ({
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
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

  const providersLoad = page.waitForResponse((response) => response.url().includes('/api/providers') && response.status() === 200)
  const capabilitiesLoad = page.waitForResponse(
    (response) => response.url().includes('/api/model-capabilities') && response.status() === 200,
  )
  await page.getByTestId('tab-settings').click()
  await Promise.all([providersLoad, capabilitiesLoad])
  await expect(page.getByText('External model services')).toBeVisible()
  await expect(page.getByRole('button', { name: /Refresh/ })).toBeEnabled()
  await expect(page.getByTestId('connection-secondary-settings')).not.toHaveAttribute('open', '')
  await expect(page.getByLabel('Pixiv Cookie')).toBeHidden()

  await expect(page.getByTestId('connection-mode-external')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('connection-mode-local').click()
  await expect(page.getByText('Local models')).toBeVisible()
  await expect(page.getByTestId('connection-mode-local')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('OpenAI-compatible Base URL', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Model', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0)

  const providerForm = page.locator('.provider-form')
  await expect(providerForm).toBeVisible()
  await providerForm.getByLabel('Name').fill(`E2E Mock ${Date.now()}`)
  await providerForm.getByLabel('Base URL').fill('http://127.0.0.1:5199')
  await providerForm.getByLabel('Default model').fill('gpt-4o-smoke')
  await expect(providerForm.getByLabel('API key')).toHaveCount(0)
  await providerForm.getByRole('button', { name: /Save/ }).click()

  await expect(page.getByText(/local endpoint/).first()).toBeVisible()
  await expect(providerForm).toBeHidden()

  await page.getByTestId('connection-mode-external').click()
  await expect(page.getByText('External model services')).toBeVisible()
  await expect(page.locator('.provider-list').getByText(/E2E Mock/)).toHaveCount(0)
  await expect(page.locator('.provider-form').getByLabel('API key')).toBeVisible()

  await page.getByTestId('connection-mode-local').click()
  await expect(page.getByText('Local models')).toBeVisible()
  await expect(page.locator('.provider-list').getByText(/E2E Mock/)).toBeVisible()
  await expect(page.getByText('Model Discovery')).toBeHidden()
  await page.getByTestId('provider-advanced-toggle').click()
  await expect(page.getByText('Model Discovery')).toBeVisible()

  await page.getByRole('button', { name: /Discover/ }).click()
  const modelList = page.locator('.model-list')
  await expect(modelList.getByRole('button', { name: /gpt-4o-smoke/ })).toBeVisible()
  await expect(modelList.getByRole('button', { name: /text-only-smoke/ })).toBeVisible()

  const imageGenerationOverride = page.getByTestId('capability-override-supportsImageGeneration')
  await expect(imageGenerationOverride).not.toBeChecked()
  const overrideSaved = page.waitForResponse(
    (response) => response.url().includes('/api/model-capabilities/') && response.request().method() === 'PATCH',
  )
  await imageGenerationOverride.check()
  await page.getByTestId('save-capability-overrides').click()
  const overrideBody = (await (await overrideSaved).json()) as {
    capability: { capabilitySources: Record<string, string>; supportsImageGeneration: boolean }
  }
  expect(overrideBody.capability.supportsImageGeneration).toBe(true)
  expect(overrideBody.capability.capabilitySources.supportsImageGeneration).toBe('user')
  expect(overrideBody.capability.capabilitySources.supportsVision).not.toBe('user')
  await expect(page.getByTestId('save-capability-overrides')).toBeDisabled()

  const testControls = page.locator('.provider-section').filter({ hasText: 'Test Controls' })
  await testControls.getByLabel('vision').check()
  await testControls.getByLabel('json').check()
  await testControls.getByLabel('streaming').check()
  await page.getByRole('button', { name: /Run test/ }).click()
  await expect(page.getByText('Redacted trace')).toBeVisible()
  await expect(page.getByTestId('provider-test-summary')).toHaveAttribute('data-state', 'passed')
  await expect(page.getByText(dummySecret)).toHaveCount(0)
  await page.getByTestId('provider-test-diagnostics').locator('summary').click()
  await expect(page.locator('.trace-box')).toBeVisible()
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
  await expect(page.locator('.log-list').getByText(/Backup exported/)).toBeVisible()
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

test('legacy API settings can fetch models and test the selected model', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('tab-settings').click()

  const legacySettings = page.getByTestId('legacy-api-settings')
  await expect(legacySettings).toBeVisible()
  await legacySettings.locator('summary').click()
  await legacySettings.getByLabel('OpenAI-compatible Base URL', { exact: true }).fill('http://127.0.0.1:5199')
  await legacySettings.getByLabel('API Key', { exact: true }).fill(dummySecret)
  await legacySettings.getByRole('button', { name: /Fetch models/ }).click()
  await expect(legacySettings.locator('#legacy-model-options option[value="gpt-4o-smoke"]')).toHaveCount(1)
  await expect(legacySettings.locator('input[list="legacy-model-options"]')).toHaveValue('gpt-4o-smoke')

  await legacySettings.getByRole('button', { name: /Test connection/ }).click()
  await expect(page.getByTestId('legacy-api-test-result')).toContainText('Connection test passed')

  await page.getByTestId('open-guide').click()
  await expect(page.getByTestId('guide-modal')).toBeVisible()
  await expect(page.getByText('Pixiv account risk')).toBeVisible()
  await page.getByTestId('guide-close').click()
  await expect(page.getByTestId('guide-modal')).toHaveCount(0)
})

test('active engine card mirrors backend route resolution', async ({ page }) => {
  await openStudio(page)
  await clearProviderProfiles(page)

  // No providers and no global route → explicit none-state with the setup wizard.
  await page.getByTestId('tab-settings').click()
  await page.getByTestId('connection-mode-local').click()
  await expect(page.getByTestId('active-engine-card')).toContainText('No AI engine available')

  // One-click detection probes PTM_LOCAL_DETECT_URLS (the mock provider here)
  // and auto-creates a keyless local profile that becomes the active engine.
  await page.getByTestId('detect-local-engine').click()
  await expect(page.getByTestId('active-engine-card')).toContainText('Local (auto-detected)')
  await expect(page.getByTestId('active-engine-card')).toContainText('Local')

  // A keyless local provider becomes the active engine via profile fallback.
  const providerName = `Engine Card Ollama ${Date.now()}`
  const providerResponse = await page.request.post('/api/providers', {
    data: { name: providerName, baseUrl: 'http://127.0.0.1:11434', defaultModel: 'llama3', isLocal: true },
  })
  expect(providerResponse.ok()).toBe(true)
  await page.reload()
  await page.getByTestId('tab-settings').click()
  await page.getByTestId('connection-mode-local').click()
  await expect(page.getByTestId('active-engine-card')).toContainText(providerName)
  await expect(page.getByTestId('active-engine-card')).toContainText('Local')

  try {
    // A stale direct route must not block a usable provider profile.
    const saveUnusable = await page.request.put('/api/settings/secrets', {
      data: { apiBaseUrl: 'https://unusable.example.test/v1', modelName: 'ghost-model' },
    })
    expect(saveUnusable.ok()).toBe(true)
    await page.reload()
    await page.getByTestId('tab-settings').click()
    await page.getByTestId('connection-mode-local').click()
    await expect(page.getByTestId('active-engine-card')).toContainText(providerName)
  } finally {
    // Restore the empty global route so later tests keep profile-based routing.
    const restore = await page.request.put('/api/settings/secrets', { data: { apiBaseUrl: '', modelName: '' } })
    expect(restore.ok()).toBe(true)
  }
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
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

  await page.getByTestId('tab-settings').click()
  await page.getByTestId('connection-secondary-toggle').click()
  await page.getByLabel('Pixiv Cookie').fill(pixivCookie)
  await page.getByRole('button', { name: /Save Settings/ }).click()
  await expect(page.locator('.log-list').getByText('Settings saved to system credential store.')).toBeVisible()
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
  await expect(page.locator('.log-list').getByText('Pixiv artwork imported.')).toBeVisible()
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
  await expect(page.locator('.log-list').getByText(/Backup exported/)).toBeVisible()
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
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

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
  await expect(page.locator('.log-list').getByText(/AI output could not be parsed after repair/)).toBeVisible()
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
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

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
  await expect(page.locator('.log-list').getByText('Cancellation requested.')).toBeVisible()
  await expect(page.locator('.log-list').getByText('Job cancelled.')).toBeVisible()
  await expect(page.getByTestId('toolbar-cancel-job')).toBeDisabled()
  expect(directProviderRequests).toEqual([])
})

test('Story Continue entry inspects references and generates a local continuation draft', async ({ page }) => {
  const directProviderRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('127.0.0.1:5199')) {
      directProviderRequests.push(request.url())
    }
  })

  await openStudio(page)
  await clearProviderProfiles(page)
  await page.getByTestId('entry-story-continue').click()
  await expect(page.getByText('Story Continue').first()).toBeVisible()

  const inspectResponse = page.waitForResponse(
    (response) => response.url().includes('/api/continuation/references/local') && response.status() === 200,
  )
  await page.getByTestId('continuation-local-input').setInputFiles({
    name: 'continue-reference.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(continuationSvg()),
  })
  await inspectResponse
  await expect(page.locator('.log-list').getByText('1 reference image(s) inspected.')).toBeVisible()
  await expect(page.getByTestId('continuation-reference-row')).toContainText('continue-reference.svg')
  await expect(page.locator('.metadata-editor').getByLabel('Tags')).toHaveValue(/same heroine/)

  await page.getByTestId('continuation-prompt').fill('Continue with the heroine opening the letter on the same rooftop.')
  const generateResponse = page.waitForResponse(
    (response) => response.url().includes('/api/continuation/generate') && response.status() === 200,
  )
  await page.locator('.continue-controls').getByRole('button', { name: /Generate/ }).click()
  await generateResponse
  await expect(page.locator('.log-list').getByText('Continuation generated with local mock engine.')).toBeVisible()
  await expect(page.getByTestId('continuation-output')).toBeVisible()
  await page.getByText('Expanded prompt').click()
  await expect(page.getByTestId('continuation-expanded-prompt')).toHaveValue(/school rooftop/)
  expect(directProviderRequests).toEqual([])
})

test('workspace remains usable without page-level horizontal overflow on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Narrow Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

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

test('long page lists remain scrollable without horizontal clipping', async ({ page }) => {
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Long Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

  const files = Array.from({ length: 16 }, (_, index) => ({
    name: `long-page-${String(index + 1).padStart(2, '0')}.svg`,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(workflowSvg()),
  }))
  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles(files)
  await localImportResponse
  await expect(page.locator('.log-list').getByText('16 image(s) imported.')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(16)

  const railMetrics = await page.locator('.left-rail').evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  expect(railMetrics.scrollHeight).toBeGreaterThan(railMetrics.clientHeight)
  expect(railMetrics.scrollWidth).toBeLessThanOrEqual(railMetrics.clientWidth + 2)

  await page.getByTestId('page-thumb').nth(15).scrollIntoViewIfNeeded()
  await page.getByTestId('page-thumb').nth(15).click()
  await expect(page.locator('.canvas-meta')).toContainText('Page 16')
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
  await expect(page.locator('.log-list').getByText('Project created.')).toBeVisible()

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
  await expect(page.locator('.log-list').getByText('2 image(s) imported.')).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(2)
  await expect(page.locator('.canvas-meta')).toContainText('800x1000')

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.locator('.log-list').getByText('Story Bible generated with local mock engine.')).toBeVisible()
  await expect(page.getByTestId('story-synopsis-input')).toBeVisible()

  const storySaveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/projects/') && response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('story-synopsis-input').fill('手动修改后的故事圣经。')
  await page.getByTestId('story-synopsis-input').blur()
  await storySaveResponse
  await expect(page.locator('.log-list').getByText('Story Bible saved.').first()).toBeVisible()

  await page.getByTestId('tab-characters').click()
  const characterSaveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/projects/') && response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('character-name-input').first().fill('手动夏海')
  await page.getByTestId('character-name-input').first().blur()
  await characterSaveResponse
  await expect(page.locator('.log-list').getByText('Story Bible saved.').first()).toBeVisible()

  await page.getByTestId('toolbar-generate-page').click()
  await expect(page.locator('.log-list').getByText('Page 1 dialogue generated.')).toBeVisible()
  await expect(page.getByTestId('page-thumb').first()).toContainText('3 lines / complete')
  await page.getByTestId('toolbar-generate-all').click()
  await expect(page.locator('.log-list').getByText('All pages generated.')).toBeVisible()
  await expect(page.locator('.log-list').getByText('1 completed page(s) skipped (already generated).')).toBeVisible()
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
  await expect(page.locator('.log-list').getByText('Dialogue saved.')).toBeVisible()

  const lockResponse = page.waitForResponse(
    (response) => response.url().includes('/api/dialogues/') && response.request().method() === 'PATCH' && response.status() === 200,
  )
  await rightRail.getByTestId('dialogue-lock-toggle').click()
  await lockResponse
  await expect(rightRail.getByTestId('dialogue-lock-toggle')).toHaveAttribute('aria-pressed', 'true')

  // Bulk generation must not overwrite pages that already hold (possibly hand-edited) dialogue.
  await page.getByTestId('toolbar-generate-all').click()
  await expect(page.locator('.log-list').getByText('All pages are already complete. Use Generate Page to regenerate a page.')).toBeVisible()
  await expect(rightRail.getByTestId('dialogue-chip').filter({ hasText: '测试对白已经手动改过。' })).toBeVisible()

  await page.getByTestId('tab-layout').click()
  const layoutResponse = page.waitForResponse(
    (response) => response.url().includes('/api/pages/') && response.url().includes('/layout') && response.status() === 200,
  )
  await rightRail.getByRole('button', { name: /Avoid overlap/ }).click()
  await layoutResponse
  await expect(page.locator('.log-list').getByText('Layout adjusted.')).toBeVisible()

  const exportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/export/zip') && response.status() === 200,
  )
  await page.getByTestId('toolbar-export-zip').click()
  const exportedZip = await (await exportResponse).json()
  await expect(page.locator('.log-list').getByText(/Exported .*\.zip/)).toBeVisible()
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
  await expect(page.locator('.log-list').getByText(/Backup exported/)).toBeVisible()

  const restoreResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/project-backup') && response.status() === 200,
  )
  await page.getByTestId('project-backup-input').setInputFiles(backupZip.absolutePath)
  await restoreResponse
  await expect(page.locator('.log-list').getByText(/Backup restored:/)).toBeVisible()
  await expect(page.getByTestId('page-thumb')).toHaveCount(2)
  await page.getByTestId('tab-dialogue').click()
  await expect(page.getByTestId('dialogue-chip').filter({ hasText: '测试对白已经手动改过。' })).toBeVisible()

  await page.reload()
  await expect(page.locator('.log-list').getByText('Studio ready. Local database loaded.')).toBeVisible()
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
  await expect(page.locator('.log-list').getByText('Studio ready. Local database loaded.')).toBeVisible()
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

function continuationSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960" viewBox="0 0 640 960">
  <title>same heroine, school rooftop, sunset, letter</title>
  <desc>same heroine, school rooftop, sunset, letter</desc>
  <rect width="640" height="960" fill="#ffffff"/>
  <rect x="48" y="48" width="544" height="420" fill="#edf2f7" stroke="#111111" stroke-width="6"/>
  <circle cx="320" cy="300" r="92" fill="#eeeeee" stroke="#111111" stroke-width="5"/>
  <path d="M238 276 C306 206 390 232 426 326" fill="none" stroke="#111111" stroke-width="8"/>
  <rect x="112" y="560" width="416" height="260" fill="#ffffff" stroke="#111111" stroke-width="6"/>
</svg>`
}
