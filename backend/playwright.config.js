const { defineConfig, devices } = require('@playwright/test');

// The E2E suite exercises the backend's HTTP API (auth lifecycle, health,
// protected routes) via Playwright's `request` fixture. No browser UI is
// involved, so a single chromium project is enough. Playwright manages the
// backend lifecycle through `webServer` below.
module.exports = defineConfig({
  testDir: '../e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4000/health',
    // Reuse a server if one is already listening (local dev); otherwise start
    // one. Works in CI too — nothing is listening, so Playwright boots it.
    reuseExistingServer: true,
    timeout: 120 * 1000,
    // Boot the backend in test mode so it uses the ephemeral in-memory SQLite
    // database (no Postgres/Redis/Stellar required) and skips rate limiting.
    // Merged over process.env by Playwright, so PATH etc. are preserved.
    env: {
      NODE_ENV: 'test',
      PORT: '4000',
      JWT_SECRET: process.env.JWT_SECRET || 'e2e-test-jwt-secret-not-for-production',
      JWT_REFRESH_SECRET:
        process.env.JWT_REFRESH_SECRET || 'e2e-test-refresh-secret-not-for-production',
      TRANSPARENCY_PRIVATE_KEY:
        process.env.TRANSPARENCY_PRIVATE_KEY || 'e2e-test-transparency-private-key',
      TRANSPARENCY_PUBLIC_KEY:
        process.env.TRANSPARENCY_PUBLIC_KEY || 'e2e-test-transparency-public-key',
      FIREBASE_SERVICE_ACCOUNT_PATH: '',
    },
  },
});
