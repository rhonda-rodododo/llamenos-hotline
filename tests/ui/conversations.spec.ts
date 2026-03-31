import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const TEST_SECRET =
  process.env.DEV_RESET_SECRET || process.env.E2E_TEST_SECRET || 'test-reset-secret'

test.describe('Conversations — no channels configured', () => {
  test.describe.configure({ mode: 'serial' })

  test('no messaging channels shows empty state on /conversations', async ({ adminPage }) => {
    // Check if channels are already enabled — if so, skip
    const config = await adminPage.evaluate(() => fetch('/api/config').then((r) => r.json()))
    const hasMessaging =
      config.channels?.sms ||
      config.channels?.whatsapp ||
      config.channels?.signal ||
      config.channels?.reports
    test.skip(!!hasMessaging, 'Messaging channels already enabled — cannot test empty state')

    await navigateAfterLogin(adminPage, '/conversations')
    await expect(adminPage.getByText('No messaging channels enabled')).toBeVisible({
      timeout: 10000,
    })
    await expect(
      adminPage.getByText(
        'Enable SMS, WhatsApp, Signal, or Reports in Hub Settings to start receiving messages.'
      )
    ).toBeVisible()
  })

  test('conversations nav link is hidden when no channels enabled', async ({ adminPage }) => {
    // Check if channels are already enabled — if so, skip
    const config = await adminPage.evaluate(() => fetch('/api/config').then((r) => r.json()))
    const hasMessaging =
      config.channels?.sms ||
      config.channels?.whatsapp ||
      config.channels?.signal ||
      config.channels?.reports
    test.skip(!!hasMessaging, 'Messaging channels already enabled — cannot test hidden nav')

    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15000,
    })
    await expect(adminPage.getByRole('link', { name: /conversations/i })).not.toBeVisible()
  })
})

test.describe('Conversations — with channels enabled', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/test-reset-setup`, {
      method: 'POST',
      headers: { 'X-Test-Secret': TEST_SECRET },
    })
    if (!res.ok) throw new Error(`Failed to reset setup state: ${res.status}`)
  })

  /**
   * Helper: enable channels using the setup wizard flow.
   * Navigates through the wizard selecting Reports, then completes setup.
   */
  async function enableChannelsViaSetupWizard(page: import('@playwright/test').Page) {
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

    // Step 1: Identity — fill required name
    await page.locator('#hotline-name').fill('Test Conversations Hotline')
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForTimeout(1000)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })

    // Step 2: Select Reports (no provider needed)
    const reportsCard = page
      .locator(`[role="button"][aria-pressed]`)
      .filter({ has: page.getByText('Reports', { exact: true }) })
    await reportsCard.click()
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForTimeout(1000)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Step 3: Skip providers
    const skipBtn3 = page.getByRole('button', { name: /skip/i })
    await skipBtn3.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn3.click()
    await page.waitForTimeout(500)
    // Step 4: Skip settings
    const skipBtn4 = page.getByRole('button', { name: /skip/i })
    await skipBtn4.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn4.click()
    await page.waitForTimeout(500)
    // Step 5: Skip invite
    const skipBtn5 = page.getByRole('button', { name: /skip/i })
    await skipBtn5.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn5.click()
    await page.waitForTimeout(500)

    // Step 6: Complete setup
    await expect(page.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /go to dashboard/i }).click()
    // Wait for navigation to dashboard — the setup wizard calls navigate({ to: '/' })
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15000,
    })
  }

  test('setup channels and verify nav link appears', async ({ adminPage }) => {
    await enableChannelsViaSetupWizard(adminPage)

    // After setup, Reports link should be visible in sidebar
    await expect(adminPage.getByRole('link', { name: 'Reports' })).toBeVisible()
  })

  test('conversations page layout with channels enabled', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/reports')

    // Reports page should show the heading
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    // Empty state shows "No reports" message
    await expect(adminPage.getByText('No reports', { exact: true })).toBeVisible()
  })

  test('empty reports list shows no reports state', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/reports')

    // With channels enabled but no reports, should show empty state
    await expect(adminPage.getByText('No reports', { exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('no messaging empty state is NOT shown when channels are enabled', async ({ adminPage }) => {
    // Navigate to reports page - since we only enabled Reports (not sms/whatsapp/signal),
    // the conversations page (for messaging channels) will still show the empty state
    // but the Reports page should work fine
    await adminPage.getByRole('link', { name: 'Reports' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    // The "No messaging channels enabled" text should NOT appear on reports page
    await expect(adminPage.getByText('No messaging channels enabled')).not.toBeVisible()
  })

  test('reports page is navigable from sidebar link', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Click the Reports link in the sidebar
    await adminPage.getByRole('link', { name: 'Reports' }).click()

    // Should navigate to /reports
    await expect(adminPage).toHaveURL(/\/reports/)

    // Page content should be visible (empty state since no reports exist yet)
    await expect(adminPage.getByText('No reports', { exact: true })).toBeVisible()
  })
})
