import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const OUTPUT_DIR = path.join('.tmp-run', 'ui-preview')

// Not a regression test: captures reference screenshots of the chrome states
// (light/dark, en/zh, whiteboard, Story Continue, Provider Lab) for visual review.
test('captures UI preview screenshots for light/dark and en/zh chrome states', async ({ page }) => {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  await page.addInitScript(() => {
    window.open = () => null
  })
  await page.goto('/')
  await expect(page.getByText('Studio ready. Local database loaded.')).toBeVisible()

  await page.getByLabel('Project title').fill('Preview Project')
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByText('Project created.')).toBeVisible()

  const importResponse = page.waitForResponse(
    (response) => response.url().includes('/api/import/local') && response.status() === 200,
  )
  await page.getByTestId('local-image-input').setInputFiles({
    name: 'preview-page.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(previewSvg()),
  })
  await importResponse
  await expect(page.getByTestId('page-thumb')).toHaveCount(1)

  await page.getByTestId('toolbar-analyze-story').click()
  await expect(page.getByText('Story Bible generated with local mock engine.')).toBeVisible()
  await page.getByTestId('toolbar-generate-page').click()
  await expect(page.getByText('Page 1 dialogue generated.')).toBeVisible()

  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUTPUT_DIR, '01-light-en-studio.png') })

  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(OUTPUT_DIR, '02-dark-en-studio.png') })

  await page.getByTestId('lang-zh').click()
  await expect(page.getByRole('button', { name: '漫畫工作室' })).toBeVisible()
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(OUTPUT_DIR, '03-dark-zh-studio.png') })

  await page.getByTestId('entry-story-continue').click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(OUTPUT_DIR, '04-dark-zh-continue.png') })

  await page.getByRole('button', { name: '漫畫工作室' }).click()
  await page.getByTestId('tab-settings').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUTPUT_DIR, '05-dark-zh-settings.png') })
})

function previewSvg(width = 800, height = 1000): string {
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
</svg>`
}
