import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('theme and language switches update the chrome and persist across reloads', async ({ page }) => {
  await openStudio(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.getByTestId('lang-zh').click()
  await expect(page.getByRole('button', { name: '漫畫工作室' })).toBeVisible()
  await expect(page.getByRole('button', { name: '全部生成' })).toBeVisible()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: '漫畫工作室' })).toBeVisible()

  await page.getByTestId('lang-en').click()
  await expect(page.getByRole('button', { name: 'Manga Studio' })).toBeVisible()
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('whiteboard canvas zooms with controls, wheel, and fit', async ({ page }) => {
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Whiteboard Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'whiteboard-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(whiteboardSvg()),
  })
  await localImportResponse

  await expect(page.locator('.canvas-meta')).toContainText('Page 1')
  await expect(page.locator('.canvas-meta')).toContainText('800x1000')

  const readout = page.getByTestId('whiteboard-zoom')
  await expect(readout).toBeVisible()
  // Auto-fit runs async after ResizeObserver measures; a fitted 800x1000 page is always <100%.
  await expect(readout).not.toHaveText('100%')
  const fitValue = await readout.innerText()

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const zoomedValue = await readout.innerText()
  expect(parseInt(zoomedValue, 10)).toBeGreaterThan(parseInt(fitValue, 10))

  await page.getByTestId('whiteboard-fit').click()
  await expect(readout).toHaveText(fitValue)

  await page.getByTestId('manga-stage').hover()
  await page.mouse.wheel(0, -240)
  await expect
    .poll(async () => parseInt(await readout.innerText(), 10))
    .toBeGreaterThan(parseInt(fitValue, 10))
})

test('dialogue bubbles can be added by double-click and deleted from the panel', async ({ page }) => {
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Bubble CRUD ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'crud-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(whiteboardSvg()),
  })
  await localImportResponse
  await expect(page.locator('.canvas-meta')).toContainText('Page 1')

  const stageBox = await page.getByTestId('manga-stage').boundingBox()
  expect(stageBox).toBeTruthy()
  const createResponse = page.waitForResponse(
    (response) => response.url().includes('/dialogues') && response.request().method() === 'POST' && response.status() === 200,
  )
  await page.mouse.dblclick(stageBox!.x + stageBox!.width / 2, stageBox!.y + stageBox!.height / 2)
  await createResponse
  await expect(page.getByText('Dialogue added.')).toBeVisible()
  await expect(page.getByTestId('dialogue-chip')).toHaveCount(1)
  await expect(page.getByTestId('dialogue-chip')).toContainText('……')

  await page.getByTestId('dialogue-add').click()
  await expect(page.getByTestId('dialogue-chip')).toHaveCount(2)

  const deleteResponse = page.waitForResponse(
    (response) => response.url().includes('/api/dialogues/') && response.request().method() === 'DELETE' && response.status() === 200,
  )
  await page.getByTestId('dialogue-delete').click()
  await deleteResponse
  await expect(page.getByText('Dialogue deleted.')).toBeVisible()
  await expect(page.getByTestId('dialogue-chip')).toHaveCount(1)
})

test('style prompt persists and characters support add, font choice, and delete', async ({ page }) => {
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Character Tools ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'character-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(whiteboardSvg()),
  })
  await localImportResponse
  await expect(page.locator('.canvas-meta')).toContainText('Page 1')

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.getByText('Story Bible generated with local mock engine.')).toBeVisible()

  const styleSaveResponse = page.waitForResponse(
    (response) => response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('story-style-prompt-input').fill('全部对白使用文言文。')
  await page.getByTestId('story-style-prompt-input').blur()
  await styleSaveResponse
  await expect(page.getByText('Story Bible saved.').first()).toBeVisible()
  await page.reload()
  await expect(page.getByText('Studio ready. Local database loaded.')).toBeVisible()
  await expect(page.getByTestId('story-style-prompt-input')).toHaveValue('全部对白使用文言文。')

  await page.getByTestId('tab-characters').click()
  await expect(page.getByTestId('character-name-input')).toHaveCount(2)

  const addSaveResponse = page.waitForResponse(
    (response) => response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('character-add').click()
  await addSaveResponse
  await expect(page.getByTestId('character-name-input')).toHaveCount(3)
  await expect(page.getByTestId('character-name-input').nth(2)).toHaveValue('New Character')

  const fontSaveResponse = page.waitForResponse(
    (response) => response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('character-font-select').first().selectOption({ label: 'Kaiti (brush)' })
  await fontSaveResponse
  await expect(page.getByTestId('character-font-select').first()).toHaveValue(/KaiTi/)

  const deleteSaveResponse = page.waitForResponse(
    (response) => response.url().includes('/story-bible') && response.status() === 200,
  )
  await page.getByTestId('character-delete').nth(2).click()
  await deleteSaveResponse
  await expect(page.getByTestId('character-name-input')).toHaveCount(2)
  // The font picked before the delete must survive the round-trip.
  await expect(page.getByTestId('character-font-select').first()).toHaveValue(/KaiTi/)
})

test('page-range generation only generates pages inside the range', async ({ page }) => {
  await openStudio(page)
  await page.getByLabel('Project title').fill(`Range Project ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles([
    { name: 'range-page-1.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(whiteboardSvg()) },
    { name: 'range-page-2.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(whiteboardSvg()) },
  ])
  await localImportResponse
  await expect(page.getByTestId('page-thumb')).toHaveCount(2)

  await page.getByTestId('tab-layout').click()
  await page.getByTestId('generate-range-from').fill('2')
  await page.getByTestId('generate-range-to').fill('2')
  await page.getByTestId('generate-range-run').click()

  await expect(page.getByText('Pages 2-2 generated.')).toBeVisible()
  // Page 1 sits outside the range and must remain untouched.
  await expect(page.getByTestId('page-thumb').nth(0)).toContainText('0 lines / ready')
  await expect(page.getByTestId('page-thumb').nth(1)).toContainText('complete')

  // Re-running the same range only reports already-complete pages.
  await page.getByTestId('generate-range-run').click()
  await expect(page.getByText('All pages in the range are already complete. Use Generate Page to regenerate.')).toBeVisible()
  await expect(page.getByTestId('page-thumb').nth(0)).toContainText('0 lines / ready')
})

test('onboarding checklist tracks progress and dismissal persists across reloads', async ({ page }) => {
  await openStudio(page)
  const card = page.getByTestId('onboarding-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Getting Started')

  await page.getByLabel('Project title').fill(`Onboarding ${Date.now()}`)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const importStep = page.getByTestId('onboarding-step').first()
  await expect(importStep).toContainText('Import Pixiv or local images')
  await expect(importStep).toHaveAttribute('data-done', 'false')

  const localImportResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'onboarding-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(whiteboardSvg()),
  })
  await localImportResponse
  await expect(importStep).toHaveAttribute('data-done', 'true')

  await page.getByTestId('onboarding-dismiss').click()
  await expect(page.getByTestId('onboarding-card')).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('Studio ready. Local database loaded.')).toBeVisible()
  await expect(page.getByTestId('onboarding-card')).toHaveCount(0)
})

async function openStudio(page: Page) {
  await page.addInitScript(() => {
    window.open = () => null
  })
  await page.goto('/')
  await expect(page).toHaveTitle(/Pixiv-to-Manga Studio/)
  await expect(page.getByText('Studio ready. Local database loaded.')).toBeVisible()
}

function whiteboardSvg(width = 800, height = 1000): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="48" y="48" width="704" height="360" fill="#f6f6f6" stroke="#111111" stroke-width="6"/>
  <circle cx="280" cy="260" r="74" fill="#eeeeee" stroke="#111111" stroke-width="5"/>
</svg>`
}
