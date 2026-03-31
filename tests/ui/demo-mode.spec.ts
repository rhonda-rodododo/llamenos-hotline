import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const TEST_SECRET =
  process.env.DEV_RESET_SECRET || process.env.E2E_TEST_SECRET || 'test-reset-secret'

test.describe('Demo Mode', () => {
  test.beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/test-reset-setup`, {
      method: 'POST',
      headers: { 'X-Test-Secret': TEST_SECRET },
    })
    if (!res.ok) throw new Error(`Failed to reset setup state: ${res.status}`)
  })
  // --- Helpers ---

  async function goToSetup(page: import('@playwright/test').Page) {
    await navigateAfterLogin(page, '/setup')
    await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 10000 })
    // The setup wizard has its own PIN gate when the key-manager is locked
    const pinInput = page.locator('input[aria-label="PIN digit 1"]')
    const hasPinGate = await pinInput.isVisible({ timeout: 1000 }).catch(() => false)
    if (hasPinGate) {
      await pinInput.focus()
      await page.keyboard.type('123456', { delay: 80 })
      await page.keyboard.press('Enter')
      await expect(page.locator('#hotline-name')).toBeVisible({ timeout: 30000 })
    }
  }

  async function clickNext(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForTimeout(1000)
  }

  async function selectChannel(page: import('@playwright/test').Page, label: string) {
    const card = page
      .locator(`[role="button"][aria-pressed]`)
      .filter({ has: page.getByText(label, { exact: true }) })
    await card.click()
  }

  async function clickSkip(page: import('@playwright/test').Page) {
    const skipBtn = page.getByRole('button', { name: /skip/i })
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn.click()
    await page.waitForTimeout(500)
  }

  async function navigateToSummaryWithDemoMode(page: import('@playwright/test').Page) {
    await goToSetup(page)

    // Step 1: Identity
    await page.locator('#hotline-name').fill(`Demo Test ${Date.now()}`)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })

    // Step 2: Select Reports
    await selectChannel(page, 'Reports')
    await clickNext(page)

    // Steps 3-5: Skip
    await clickSkip(page)
    await clickSkip(page)
    await clickSkip(page)

    // Should be on Summary step
    await expect(page.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })
  }

  /** Complete the full setup wizard with demo mode enabled */
  async function completeSetupWithDemoMode(page: import('@playwright/test').Page) {
    await navigateToSummaryWithDemoMode(page)

    // Enable demo mode
    const toggle = page.getByRole('switch')
    await toggle.click()
    await expect(toggle).toBeChecked()

    // Complete setup
    await page.getByRole('button', { name: /go to dashboard/i }).click()

    // Should redirect to dashboard
    await page.waitForURL('**/', { timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15000,
    })
  }

  // =====================================================================
  // Test 1: Demo mode toggle appears on summary step
  // =====================================================================
  test('summary step shows demo mode toggle', async ({ adminPage }) => {
    await navigateToSummaryWithDemoMode(adminPage)

    // The demo toggle should be visible
    await expect(adminPage.getByText('Populate with sample data')).toBeVisible()
    await expect(adminPage.getByText('Creates sample volunteer accounts')).toBeVisible()

    // Toggle should be off by default
    const toggle = adminPage.getByRole('switch')
    await expect(toggle).not.toBeChecked()
  })

  // =====================================================================
  // Test 2: Complete setup with demo mode enabled
  // =====================================================================
  test('complete setup with demo mode creates demo accounts', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    // Verify demo users were created
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 10000 })

    // Check for demo user names (use .first() in case of duplicate entries from parallel resets)
    await expect(adminPage.getByText('Maria Santos').first()).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText('James Chen').first()).toBeVisible()
    await expect(adminPage.getByText('Community Reporter').first()).toBeVisible()

    // Fatima should be visible but deactivated
    await expect(adminPage.getByText('Fatima Al-Rashid').first()).toBeVisible()
  })

  // =====================================================================
  // Test 3: Demo account picker visible on login page
  // =====================================================================
  test('login page shows demo account picker when demo mode is enabled', async ({
    adminPage,
    browser,
  }) => {
    await completeSetupWithDemoMode(adminPage)

    // Use a fresh incognito context to test the login page as a new visitor
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    // Demo account picker should be visible
    await expect(page.getByText('Try the demo')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Pick a demo account to explore')).toBeVisible()

    // Should show demo accounts (excluding inactive Fatima)
    await expect(page.getByText('Demo Admin')).toBeVisible()
    await expect(page.getByText('Maria Santos')).toBeVisible()
    await expect(page.getByText('James Chen')).toBeVisible()
    await expect(page.getByText('Community Reporter')).toBeVisible()

    // Should show reset notice
    await expect(page.getByText('Demo data resets daily')).toBeVisible()

    await context.close()
  })

  // =====================================================================
  // Test 4: One-click demo login works
  // =====================================================================
  test('clicking demo account logs in and redirects to dashboard', async ({
    adminPage,
    browser,
  }) => {
    await completeSetupWithDemoMode(adminPage)

    // Use a fresh incognito context to test the login page as a new visitor
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    // Wait for demo accounts to appear
    await expect(page.getByText('Pick a demo account to explore')).toBeVisible({
      timeout: 10000,
    })

    // Click the Maria Santos demo account
    const mariaRow = page.locator('button').filter({ hasText: 'Maria Santos' })
    await mariaRow.click()

    // Should redirect to dashboard (or profile setup)
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 })

    // Should be authenticated — check sidebar nav shows the name
    await expect(page.getByRole('navigation').getByText('Maria Santos')).toBeVisible({
      timeout: 10000,
    })

    await context.close()
  })

  // =====================================================================
  // Test 5: Demo banner appears for authenticated users
  // =====================================================================
  test('demo banner shows when logged in', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    // Navigate to dashboard to see the banner
    await navigateAfterLogin(adminPage, '/')

    // Wait for config to load — the hotline name in the sidebar confirms config loaded
    await expect(adminPage.getByRole('navigation')).toBeVisible({ timeout: 10000 })

    // Demo banner should be visible
    await expect(adminPage.getByText("You're exploring")).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText('Deploy your own')).toBeVisible()

    // Banner should be dismissible
    const dismissBtn = adminPage.locator('button[aria-label="Dismiss"]').first()
    await dismissBtn.click()

    // Banner should disappear
    await expect(adminPage.getByText("You're exploring")).not.toBeVisible()
  })

  // =====================================================================
  // Test 6: Demo shifts were created
  // =====================================================================
  test('demo shifts are populated', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    await adminPage.getByRole('link', { name: 'Shifts' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Shift Schedule' })).toBeVisible({
      timeout: 10000,
    })

    // Check for demo shift names (use .first() as there may be multiple recurring instances)
    await expect(adminPage.getByText('Morning Team').first()).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText('Evening Team').first()).toBeVisible()
    await expect(adminPage.getByText('Weekend Coverage').first()).toBeVisible()
  })

  // =====================================================================
  // Test 7: Demo bans were created
  // =====================================================================
  test('demo bans are populated', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    // Wait for async demo data seeding to complete before navigating
    await adminPage.waitForTimeout(2000)

    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Ban List' })).toBeVisible({
      timeout: 10000,
    })

    // Check for demo ban reasons (use .first() as resets may accumulate entries)
    await expect(adminPage.getByText('Repeated prank calls').first()).toBeVisible({
      timeout: 10000,
    })
    await expect(adminPage.getByText('Threatening language').first()).toBeVisible()
  })
})
