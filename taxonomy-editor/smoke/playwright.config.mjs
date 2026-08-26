import { defineConfig, devices } from '@playwright/test';

// Scoped to smoke/ so Playwright never scans the app's vitest suites.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.smoke.mjs',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    baseURL: process.env.SMOKE_BASE_URL || 'http://localhost:7862',
  },
});
