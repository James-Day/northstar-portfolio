import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL, ...devices['Desktop Chrome'] },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? undefined
    : { command: 'npm run dev', url: baseURL, reuseExistingServer: true },
});
