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
