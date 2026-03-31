import { type BrowserContext, type Page, test as base } from '@playwright/test'
import { Timeouts, completeProfileSetup, enterPin } from '../helpers'

const TEST_PIN = '123456'
const STORAGE_DIR = 'tests/storage'

/** Storage state file paths for each role */
export const STORAGE_PATHS = {
  admin: `${STORAGE_DIR}/admin.json`,
  'hub-admin': `${STORAGE_DIR}/hub-admin.json`,
  volunteer: `${STORAGE_DIR}/volunteer.json`,
  reviewer: `${STORAGE_DIR}/reviewer.json`,
  reporter: `${STORAGE_DIR}/reporter.json`,
} as const

export type RoleName = keyof typeof STORAGE_PATHS

/**
 * Create an authenticated page for a role by loading cached storage state
 * and entering the PIN to unlock. Worker-scoped — runs once per test file.
 */
async function createAuthenticatedPage(
  browser: import('@playwright/test').Browser,
  role: RoleName
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: STORAGE_PATHS[role],
  })
  const page = await context.newPage()

  // Auto-dismiss session expired modal if it appears during the test
  await page.addLocatorHandler(page.getByText('Session Expired'), async () => {
    const reconnectBtn = page.getByRole('button', { name: /reconnect/i })
    if (await reconnectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reconnectBtn.click({ timeout: 3000 }).catch(() => {})
    }
  })

  // Navigate to app — triggers PIN screen (in-memory keyManager cleared on fresh page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // Enter PIN to unlock
  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  await pinInput.waitFor({ state: 'visible', timeout: Timeouts.AUTH })
  await enterPin(page, TEST_PIN)

  // Wait for authenticated state — may redirect to profile-setup first
  const dashboardHeading = page.getByRole('heading', { name: 'Dashboard', exact: true })

  const destination = await Promise.race([
    dashboardHeading
      .waitFor({ state: 'visible', timeout: Timeouts.AUTH })
      .then(() => 'dashboard' as const),
    page
      .waitForURL((u) => new URL(u.toString()).pathname.includes('profile-setup'), {
        timeout: Timeouts.AUTH,
      })
      .then(() => 'profile-setup' as const),
  ])

  if (destination === 'profile-setup') {
    await completeProfileSetup(page)
  }

  return { context, page }
}

/**
 * Extended Playwright test with per-role authenticated page fixtures.
 * Each fixture is worker-scoped — PIN entry happens once per test file.
 */
export const test = base.extend<
  object,
  {
    adminPage: Page
    adminContext: BrowserContext
    hubAdminPage: Page
    hubAdminContext: BrowserContext
    volunteerPage: Page
    volunteerContext: BrowserContext
    reviewerPage: Page
    reviewerContext: BrowserContext
    reporterPage: Page
    reporterContext: BrowserContext
  }
>({
  adminPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'admin')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  adminContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'admin')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  hubAdminPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'hub-admin')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  hubAdminContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'hub-admin')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  volunteerPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'volunteer')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  volunteerContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'volunteer')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reviewerPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'reviewer')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reviewerContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'reviewer')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reporterPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'reporter')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reporterContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'reporter')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'
