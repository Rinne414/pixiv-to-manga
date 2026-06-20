import { defineConfig, devices } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

const e2eDataDir = path.join(os.tmpdir(), `pixiv-to-manga-e2e-${Date.now()}`)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
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
      url: 'http://127.0.0.1:4174/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PTM_DATA_DIR: e2eDataDir,
        PTM_TEST_MEMORY_KEYTAR: '1',
        PTM_PIXIV_MOCK_BASE_URL: 'http://127.0.0.1:5199',
      },
    },
    {
      command: 'npm run dev:client -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
