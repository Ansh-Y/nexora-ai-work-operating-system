import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node apps/api/.browser-dist/test/browser-api.js', url: 'http://localhost:4000/api/docs', timeout: 120_000, reuseExistingServer: false },
    { command: 'npm --workspace apps/web run dev', url: 'http://localhost:3000', timeout: 120_000, reuseExistingServer: false },
  ],
});
