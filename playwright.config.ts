import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/live/**"],
  globalTeardown: "./tests/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : parseInt(process.env.PLAYWRIGHT_WORKERS || "3"),
  reporter: process.env.CI
    ? [
        ["github"],
        ["junit", { outputFile: "test-results.xml" }],
        ["list"],
      ]
    : [["html"], ["list"]],
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    ignoreHTTPSErrors: !!process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
      timeout: 300_000, // 5 min for real bootstrap + 4 invite onboardings
      use: { trace: "off" }, // Disable trace for setup — avoids ENOENT on trace artifacts
    },
    {
      // API integration tests — no browser, request fixture only
      name: "api",
      testDir: "./tests/api",
      use: {
        /* no device — request fixture only */
      },
      dependencies: ["setup"],
    },
    {
      // UI E2E tests — full browser
      name: "ui",
      testDir: "./tests/ui",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /bootstrap\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Bootstrap tests run after main UI tests to avoid admin-deletion race conditions
      name: "bootstrap",
      testDir: "./tests/ui",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /bootstrap\.spec\.ts/,
      dependencies: ["ui"],
    },
    {
      name: "mobile",
      testDir: "./tests/ui",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Bridge integration tests — no browser, no webserver, no global setup needed
      name: "bridge",
      testMatch: /asterisk-auto-config\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "bun run build && bun run start",
        url: "http://localhost:3000/api/health/ready",
        reuseExistingServer: !process.env.CI,
        env: {
          ...process.env,
          USE_TEST_ADAPTER: "true",
        },
      },
});
