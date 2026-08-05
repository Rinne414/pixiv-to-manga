import { expect, test } from '@playwright/test'

type CreatedProject = {
  project: {
    id: string
    title: string
  }
}

test('bounded Pixiv batch import preflights, deduplicates, imports, and fits mobile', async ({ page }) => {
  const directPixivRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:5199/')) directPixivRequests.push(request.url())
  })

  const projectResponse = await page.request.post('/api/projects', {
    data: { title: `Pixiv Batch ${Date.now()}`, mode: 'story', source: 'pixiv' },
  })
  expect(projectResponse.ok()).toBe(true)
  await page.request.post('http://127.0.0.1:5199/requests/reset')

  await page.goto('/')
  const panel = page.getByTestId('pixiv-batch-panel')
  await expect(panel).toBeVisible()

  await page.getByTestId('pixiv-session-test').click()
  await expect(page.getByTestId('pixiv-session-result')).toBeVisible()

  await page.getByTestId('pixiv-batch-urls').fill([
    '123456789',
    'https://www.pixiv.net/artworks/123456789',
  ].join('\n'))
  await page.getByTestId('pixiv-batch-max-images').fill('1')
  const previewResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/pixiv/preview') && response.status() === 200,
  )
  await page.getByTestId('pixiv-batch-preview').click()
  await previewResponse

  await expect(page.getByTestId('pixiv-batch-preview-list')).toBeVisible()
  await expect(page.getByTestId('pixiv-batch-page-123456789-0')).toBeChecked()

  const taskResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/pixiv/tasks') && response.request().method() === 'POST' && response.status() === 200,
  )
  await page.getByTestId('pixiv-batch-start').click()
  await taskResponse

  const task = page.getByTestId('pixiv-batch-task')
  await expect(task).toBeVisible()
  await expect(page.getByTestId('pixiv-batch-urls')).toBeDisabled()
  await expect(page.getByTestId('pixiv-batch-max-images')).toBeDisabled()
  await expect(page.getByTestId('pixiv-batch-use-session')).toBeDisabled()
  await expect(page.getByTestId('pixiv-batch-preview')).toBeDisabled()
  await expect(task).toHaveAttribute('data-status', 'completed', { timeout: 15_000 })
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)
  expect(directPixivRequests).toEqual([])

  const requestsResponse = await page.request.get('http://127.0.0.1:5199/requests')
  expect(requestsResponse.ok()).toBe(true)
  const requestLog = await requestsResponse.json() as {
    requests: Array<{ url: string; headers: Record<string, string | undefined> }>
  }
  const previewRequests = requestLog.requests.filter((request) => request.url.startsWith('/ajax/illust/123456789/pages'))
  expect(previewRequests).toHaveLength(1)
  expect(previewRequests[0].headers.cookie).toBeUndefined()

  await page.getByTestId('pixiv-batch-urls').fill('987654321')
  await page.getByTestId('pixiv-batch-max-images').fill('200')
  const largePreviewResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/pixiv/preview') && response.status() === 200,
  )
  await page.getByTestId('pixiv-batch-preview').click()
  await largePreviewResponse
  await expect(page.locator('[data-testid^="pixiv-batch-page-"]')).toHaveCount(200)

  await page.setViewportSize({ width: 390, height: 844 })
  await panel.scrollIntoViewIfNeeded()
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  const panelBox = await panel.boundingBox()
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth)
  expect(panelBox).toBeTruthy()
  expect(panelBox!.x).toBeGreaterThanOrEqual(0)
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390)

  const toolbarButtons = page.locator('[data-testid^="toolbar-"]')
  const inspectorTabs = page.locator('[data-testid^="tab-"]')
  expect(await toolbarButtons.count()).toBeGreaterThan(0)
  await expect(inspectorTabs).toHaveCount(5)
  for (let index = 0; index < await toolbarButtons.count(); index += 1) {
    await expect(toolbarButtons.nth(index).locator('svg')).toBeVisible()
  }
  for (let index = 0; index < await inspectorTabs.count(); index += 1) {
    await expect(inspectorTabs.nth(index).locator('svg')).toBeVisible()
  }
})

test('batch import creates and selects a project from an empty workspace', async ({ page }) => {
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"projects":[]}' })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByTestId('project-row')).toHaveCount(0)
  await page.getByTestId('pixiv-batch-urls').fill('123456789')
  await page.getByTestId('pixiv-batch-max-images').fill('1')
  const previewResponse = page.waitForResponse((response) => (
    response.url().includes('/api/import/pixiv/preview') && response.status() === 200
  ))
  await page.getByTestId('pixiv-batch-preview').click()
  await previewResponse
  const taskResponse = page.waitForResponse((response) => (
    response.url().includes('/api/import/pixiv/tasks')
      && response.request().method() === 'POST'
      && response.status() === 200
  ))
  await page.getByTestId('pixiv-batch-start').click()
  await taskResponse

  await expect(page.getByTestId('project-row')).toHaveCount(1, { timeout: 25_000 })
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)
  await expect(page.getByTestId('toolbar-analyze-story')).toBeEnabled()
})

test('stale Pixiv refresh cannot replace a newly selected project', async ({ page }) => {
  const projectAResponse = await page.request.post('/api/projects', {
    data: { title: `Race A ${Date.now()}`, mode: 'story', source: 'pixiv' },
  })
  const projectBResponse = await page.request.post('/api/projects', {
    data: { title: `Race B ${Date.now()}`, mode: 'story', source: 'local' },
  })
  expect(projectAResponse.ok()).toBe(true)
  expect(projectBResponse.ok()).toBe(true)
  const projectA = await projectAResponse.json() as CreatedProject
  const projectB = await projectBResponse.json() as CreatedProject

  await page.goto('/')
  const projectARow = page.locator(`[data-testid="project-row"][data-project-id="${projectA.project.id}"]`)
  const projectBRow = page.locator(`[data-testid="project-row"][data-project-id="${projectB.project.id}"]`)
  await expect(projectARow).toHaveCount(1)
  await expect(projectBRow).toHaveCount(1)

  const initialProjectAResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/projects/${projectA.project.id}`)
      && response.request().method() === 'GET'
  ))
  await projectARow.click()
  await initialProjectAResponse
  await expect(projectARow).toHaveClass(/active/u)

  let releaseRefresh = () => undefined
  const refreshRelease = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  let markRefreshStarted = () => undefined
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve
  })
  let heldRefresh = true
  await page.route(`**/api/projects/${projectA.project.id}`, async (route) => {
    if (heldRefresh && route.request().method() === 'GET') {
      heldRefresh = false
      markRefreshStarted()
      await refreshRelease
    }
    await route.continue()
  })

  await page.getByTestId('pixiv-batch-urls').fill('123456789')
  await page.getByTestId('pixiv-batch-max-images').fill('1')
  const previewResponse = page.waitForResponse((response) => (
    response.url().includes('/api/import/pixiv/preview') && response.status() === 200
  ))
  await page.getByTestId('pixiv-batch-preview').click()
  await previewResponse
  const taskResponse = page.waitForResponse((response) => (
    response.url().includes('/api/import/pixiv/tasks')
      && response.request().method() === 'POST'
      && response.status() === 200
  ))
  await page.getByTestId('pixiv-batch-start').click()
  await taskResponse
  await expect(page.getByTestId('pixiv-batch-task')).toHaveAttribute('data-status', 'completed', { timeout: 15_000 })
  await refreshStarted

  const projectBLoad = page.waitForResponse((response) => (
    response.url().endsWith(`/api/projects/${projectB.project.id}`)
      && response.request().method() === 'GET'
  ))
  await projectBRow.click()
  await projectBLoad
  await expect(projectBRow).toHaveClass(/active/u)

  const staleRefreshResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/projects/${projectA.project.id}`)
      && response.request().method() === 'GET'
  ))
  releaseRefresh()
  await staleRefreshResponse
  await page.waitForTimeout(100)

  await expect(projectBRow).toHaveClass(/active/u)
  await expect(projectARow).not.toHaveClass(/active/u)
})

test('failed project selection clears the previously selected project detail', async ({ page }) => {
  const projectAResponse = await page.request.post('/api/projects', {
    data: { title: `Load A ${Date.now()}`, mode: 'story', source: 'local' },
  })
  const projectBResponse = await page.request.post('/api/projects', {
    data: { title: `Load B ${Date.now()}`, mode: 'story', source: 'local' },
  })
  expect(projectAResponse.ok()).toBe(true)
  expect(projectBResponse.ok()).toBe(true)
  const projectA = await projectAResponse.json() as CreatedProject
  const projectB = await projectBResponse.json() as CreatedProject

  await page.goto('/')
  const projectARow = page.locator(`[data-testid="project-row"][data-project-id="${projectA.project.id}"]`)
  const projectBRow = page.locator(`[data-testid="project-row"][data-project-id="${projectB.project.id}"]`)
  const projectALoad = page.waitForResponse((response) => (
    response.url().endsWith(`/api/projects/${projectA.project.id}`)
      && response.request().method() === 'GET'
  ))
  await projectARow.click()
  await projectALoad
  await expect(projectARow).toHaveClass(/active/u)

  await page.route(`**/api/projects/${projectB.project.id}`, async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"forced project load failure"}' })
  })
  const failedLoad = page.waitForResponse((response) => (
    response.url().endsWith(`/api/projects/${projectB.project.id}`)
      && response.status() === 503
  ))
  await projectBRow.click()
  await failedLoad

  await expect(projectBRow).toHaveClass(/active/u)
  await expect(projectARow).not.toHaveClass(/active/u)
  await expect(page.getByTestId('page-thumb')).toHaveCount(0)
  await expect(page.getByTestId('toolbar-analyze-story')).toBeDisabled()

  await page.unroute(`**/api/projects/${projectB.project.id}`)
  const retryLoad = page.waitForResponse((response) => (
    response.url().endsWith(`/api/projects/${projectB.project.id}`)
      && response.request().method() === 'GET'
      && response.status() === 200
  ), { timeout: 5_000 })
  await projectBRow.click()
  await retryLoad

  await expect(projectBRow).toHaveClass(/active/u)
  await expect(page.getByTestId('toolbar-analyze-story')).toBeEnabled()
})
