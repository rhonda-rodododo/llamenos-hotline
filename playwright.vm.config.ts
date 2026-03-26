import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for testing against an Ansible-deployed VM.
 *
 * The VM runs the full Docker stack behind Caddy with internal TLS.
 * Requires /etc/hosts entry pointing the domain to the VM IP.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=https://llamenos.local npx playwright test --config playwright.vm.config.ts
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/live/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1, // Serial — single VM instance
  reporter: 'html',
  timeout: 60_000, // Longer timeouts for VM latency
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://llamenos.local',
    ignoreHTTPSErrors: true, // Caddy internal CA (self-signed)
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /bootstrap\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'bootstrap',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /bootstrap\.spec\.ts/,
      dependencies: ['chromium'],
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.ts/,
      dependencies: ['setup'],
    },
  ],
  // No webServer — Ansible-deployed VM provides the app
})
