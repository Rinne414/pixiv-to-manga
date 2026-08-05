import { defineConfig, devices } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

const e2eDataDir = path.join(os.tmpdir(), `pixiv-to-manga-e2e-${Date.now()}`)
const e2eServerPort = Number(process.env.PTM_E2E_SERVER_PORT || 4174)
const e2eClientPort = Number(process.env.PTM_E2E_CLIENT_PORT || 5173)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${e2eClientPort}`,
    // The suite asserts English UI copy; pin the browser locale so zh systems don't flip the i18n default.
    locale: 'en-US',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: '.playwright-results',
  webServer: [
    {
      command:
        'node .plans/provider-lab/e2e-tester/test-provider-lab-main-thread/mock-provider.cjs',
      url: 'http://127.0.0.1:5199/models',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run server',
      url: `http://127.0.0.1:${e2eServerPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PTM_DATA_DIR: e2eDataDir,
        PTM_SERVER_PORT: String(e2eServerPort),
        PTM_TEST_MEMORY_KEYTAR: '1',
        PTM_PIXIV_MOCK_BASE_URL: 'http://127.0.0.1:5199',
        PTM_LOCAL_DETECT_URLS: 'http://127.0.0.1:5199',
      },
    },
    {
      command: `npm run dev:client -- --host 127.0.0.1 --port ${e2eClientPort}`,
      url: `http://127.0.0.1:${e2eClientPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PTM_SERVER_PORT: String(e2eServerPort),
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
