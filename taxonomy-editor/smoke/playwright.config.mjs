import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '7862';
const BASE = `http://127.0.0.1:${PORT}`;

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
    baseURL: BASE,
  },
  // Playwright owns the server lifecycle: it starts serve.mjs, waits for the SPA to answer,
  // and tears it down after the run. serve.mjs runs the server in-process so teardown is clean
  // (no zombie holding the port). Readiness uses GET (200 on `/`), so no wait-on/HEAD 404 trap.
  webServer: {
    command: 'node serve.mjs',
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
