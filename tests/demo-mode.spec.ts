import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, resetTestState } from './helpers'

// Tests depend on each other's server-side state (test 2 seeds data for 3-7)
test.describe.configure({ mode: 'serial' })

test.describe('Demo Mode', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  // --- Helpers ---

  async function goToSetup(page: import('@playwright/test').Page) {
    await navigateAfterLogin(page, '/setup')
    await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 10000 })
  }

  async function clickNext(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForTimeout(500)
  }

  async function selectChannel(page: import('@playwright/test').Page, label: string) {
    const card = page.locator(`[role="button"][aria-pressed]`).filter({ has: page.getByText(label, { exact: true }) })
    await card.click()
  }

  async function clickSkip(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /skip/i }).click()
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

  // =====================================================================
  // Test 1: Demo mode toggle appears on summary step
  // =====================================================================
  test('summary step shows demo mode toggle', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateToSummaryWithDemoMode(page)

    // The demo toggle should be visible
    await expect(page.getByText('Populate with sample data')).toBeVisible()
    await expect(page.getByText('Creates sample volunteer accounts')).toBeVisible()

    // Toggle should be off by default
    const toggle = page.getByRole('switch')
    await expect(toggle).not.toBeChecked()
  })

  // =====================================================================
  // Test 2: Complete setup with demo mode enabled
  // =====================================================================
  test('complete setup with demo mode creates demo accounts', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateToSummaryWithDemoMode(page)

    // Enable demo mode
    const toggle = page.getByRole('switch')
    await toggle.click()
    await expect(toggle).toBeChecked()

    // Complete setup
    await page.getByRole('button', { name: /go to dashboard/i }).click()

    // Should redirect to dashboard
    await page.waitForURL('**/', { timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })

    // Verify demo volunteers were created
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible({ timeout: 10000 })

    // Check for demo volunteer names
    await expect(page.getByText('Maria Santos')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('James Chen')).toBeVisible()
    await expect(page.getByText('Community Reporter')).toBeVisible()

    // Fatima should be visible but deactivated
    await expect(page.getByText('Fatima Al-Rashid')).toBeVisible()
  })

  // =====================================================================
  // Test 3: Demo account picker visible on login page
  // =====================================================================
  test('login page shows demo account picker when demo mode is enabled', async ({ page }) => {
    // Go to login page (demo mode should be enabled from previous test)
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
  })

  // =====================================================================
  // Test 4: One-click demo login works
  // =====================================================================
  test('clicking demo account logs in and redirects to dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    // Wait for demo accounts to appear
    await expect(page.getByText('Pick a demo account to explore')).toBeVisible({ timeout: 10000 })

    // Click the Maria Santos demo account
    const mariaRow = page.locator('button').filter({ hasText: 'Maria Santos' })
    await mariaRow.click()

    // Should redirect to dashboard (or profile setup)
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 })

    // Should be authenticated — check sidebar nav shows the name
    await expect(page.getByRole('navigation').getByText('Maria Santos')).toBeVisible({ timeout: 10000 })
  })

  // =====================================================================
  // Test 5: Demo banner appears for authenticated users
  // =====================================================================
  test('demo banner shows when logged in', async ({ page }) => {
    await loginAsAdmin(page)

    // Wait for config to load — the hotline name in the sidebar confirms config loaded
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 10000 })

    // Demo banner should be visible
    await expect(page.getByText("You're exploring")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Deploy your own')).toBeVisible()

    // Banner should be dismissible
    const dismissBtn = page.locator('button[aria-label="Dismiss"]')
    await dismissBtn.click()

    // Banner should disappear
    await expect(page.getByText("You're exploring")).not.toBeVisible()
  })

  // =====================================================================
  // Test 6: Demo shifts were created
  // =====================================================================
  test('demo shifts are populated', async ({ page }) => {
    await loginAsAdmin(page)

    await page.getByRole('link', { name: 'Shifts' }).click()
    await expect(page.getByRole('heading', { name: 'Shift Schedule' })).toBeVisible({ timeout: 10000 })

    // Check for demo shift names
    await expect(page.getByText('Morning Team')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Evening Team')).toBeVisible()
    await expect(page.getByText('Weekend Coverage')).toBeVisible()
  })

  // =====================================================================
  // Test 7: Demo bans were created
  // =====================================================================
  test('demo bans are populated', async ({ page }) => {
    await loginAsAdmin(page)

    await page.getByRole('link', { name: 'Ban List' }).click()
    await expect(page.getByRole('heading', { name: 'Ban List' })).toBeVisible({ timeout: 10000 })

    // Check for demo ban reasons
    await expect(page.getByText('Repeated prank calls')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Threatening language')).toBeVisible()
  })
})
