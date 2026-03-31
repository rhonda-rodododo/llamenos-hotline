import { expect, test } from '../fixtures/auth'
import { loginAsAdmin, navigateAfterLogin } from '../helpers'

test.describe('Demo Mode', () => {
  // --- Helpers ---

  async function goToSetup(page: import('@playwright/test').Page) {
    await navigateAfterLogin(page, '/setup')
    await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 10000 })
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
    await expect(adminPage.getByText('Creates sample user accounts')).toBeVisible()

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
  test('login page shows demo account picker when demo mode is enabled', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    // Go to login page (demo mode should be enabled from setup above)
    await adminPage.goto('/login')
    await adminPage.waitForLoadState('domcontentloaded')

    // Demo account picker should be visible
    await expect(adminPage.getByText('Try the demo')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText('Pick a demo account to explore')).toBeVisible()

    // Should show demo accounts (excluding inactive Fatima)
    await expect(adminPage.getByText('Demo Admin')).toBeVisible()
    await expect(adminPage.getByText('Maria Santos')).toBeVisible()
    await expect(adminPage.getByText('James Chen')).toBeVisible()
    await expect(adminPage.getByText('Community Reporter')).toBeVisible()

    // Should show reset notice
    await expect(adminPage.getByText('Demo data resets daily')).toBeVisible()
  })

  // =====================================================================
  // Test 4: One-click demo login works
  // =====================================================================
  test('clicking demo account logs in and redirects to dashboard', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    // Go to login page
    await adminPage.goto('/login')
    await adminPage.waitForLoadState('domcontentloaded')

    // Wait for demo accounts to appear
    await expect(adminPage.getByText('Pick a demo account to explore')).toBeVisible({
      timeout: 10000,
    })

    // Click the Maria Santos demo account
    const mariaRow = adminPage.locator('button').filter({ hasText: 'Maria Santos' })
    await mariaRow.click()

    // Should redirect to dashboard (or profile setup)
    await adminPage.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 })

    // Should be authenticated — check sidebar nav shows the name
    await expect(adminPage.getByRole('navigation').getByText('Maria Santos')).toBeVisible({
      timeout: 10000,
    })
  })

  // =====================================================================
  // Test 5: Demo banner appears for authenticated users
  // =====================================================================
  test('demo banner shows when logged in', async ({ adminPage }) => {
    await completeSetupWithDemoMode(adminPage)

    // Re-login to see the banner
    await loginAsAdmin(adminPage)

    // Wait for config to load — the hotline name in the sidebar confirms config loaded
    await expect(adminPage.getByRole('navigation')).toBeVisible({ timeout: 10000 })

    // Demo banner should be visible
    await expect(adminPage.getByText("You're exploring")).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText('Deploy your own')).toBeVisible()

    // Banner should be dismissible
    const dismissBtn = adminPage.locator('button[aria-label="Dismiss"]')
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
