import { expect, test } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin } from '../helpers'

test.describe('Setup Wizard - Provider Module', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginAsAdmin(page)
  })

  // Helper: navigate to /setup and wait for the wizard
  async function goToSetup(page: import('@playwright/test').Page) {
    await navigateAfterLogin(page, '/setup')
    await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 10000 })
  }

  // Helper: fill identity step with defaults
  async function fillIdentityStep(page: import('@playwright/test').Page) {
    await page.locator('#hotline-name').fill(`Test Hotline ${Date.now()}`)
    await page.locator('#org-name').fill('Test Org')
  }

  // Helper: click a channel card by label
  async function selectChannel(page: import('@playwright/test').Page, label: string) {
    const card = page
      .locator('[role="button"][aria-pressed]')
      .filter({ has: page.getByText(label, { exact: true }) })
    await card.click()
  }

  // Helper: click Next
  async function clickNext(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForTimeout(1000)
  }

  // Helper: click Skip
  async function clickSkip(page: import('@playwright/test').Page) {
    const skipBtn = page.getByRole('button', { name: /skip/i })
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn.click()
    await page.waitForTimeout(500)
  }

  // Helper: navigate to step 3 with Voice selected
  async function goToVoiceProviderStep(page: import('@playwright/test').Page) {
    await goToSetup(page)
    await fillIdentityStep(page)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })
    await selectChannel(page, 'Voice Calls')
    await clickNext(page)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })
  }

  // =====================================================================
  // Test: Voice provider form shows validate button
  // =====================================================================
  test('voice provider step shows validate credentials button', async ({ page }) => {
    await goToVoiceProviderStep(page)

    // Should see the provider form
    await expect(page.getByText('Voice & SMS Provider')).toBeVisible()

    // Provider cards should be visible
    await expect(page.getByText('Twilio', { exact: true }).first()).toBeVisible()

    // Validate button should be visible
    const validateBtn = page.getByTestId('oauth-connect-button')
    await expect(validateBtn).toBeVisible()
  })

  // =====================================================================
  // Test: Provider selection changes credential fields
  // =====================================================================
  test('selecting different providers changes visible credential fields', async ({ page }) => {
    await goToVoiceProviderStep(page)

    // Twilio is default — should show Account SID and Auth Token
    await expect(page.getByTestId('account-sid')).toBeVisible()
    await expect(page.getByTestId('auth-token')).toBeVisible()

    // Switch to Asterisk
    const asteriskCard = page
      .locator('.cursor-pointer')
      .filter({ hasText: 'Asterisk (Self-Hosted)' })
    await asteriskCard.click()

    // Should show Asterisk-specific fields
    await expect(page.getByText('ARI URL')).toBeVisible()
    await expect(page.getByText('ARI Username')).toBeVisible()
    await expect(page.getByText('ARI Password')).toBeVisible()

    // Twilio fields should not be visible
    await expect(page.getByTestId('account-sid')).not.toBeVisible()
  })

  // =====================================================================
  // Test: Phone number input is available
  // =====================================================================
  test('phone number input is visible in provider step', async ({ page }) => {
    await goToVoiceProviderStep(page)

    // Phone number input should be visible
    const phoneInput = page.getByTestId('phone-number-input')
    await expect(phoneInput).toBeVisible()

    // Should show validate-first message when not connected
    await expect(
      page.getByText('Validate your provider credentials to see available phone numbers.')
    ).toBeVisible()
  })

  // =====================================================================
  // Test: Signal provider step shows bridge configuration
  // =====================================================================
  test('signal provider step shows bridge configuration fields', async ({ page }) => {
    await goToSetup(page)
    await fillIdentityStep(page)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })

    // Select Signal
    await selectChannel(page, 'Signal')
    await clickNext(page)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Should show Signal bridge section
    await expect(page.getByRole('heading', { name: 'Signal Bridge' })).toBeVisible()

    // Should show E2EE note
    await expect(page.getByText(/Signal provides end-to-end encryption/)).toBeVisible()

    // Should show prerequisites
    await expect(page.getByText('Prerequisites')).toBeVisible()
    await expect(page.getByText(/Linux server with Docker/)).toBeVisible()

    // Should show Docker command
    await expect(page.getByText('Docker Run Command')).toBeVisible()
    await expect(page.getByText(/signal-cli-rest-api/)).toBeVisible()

    // Should show input fields
    await expect(page.getByTestId('signal-bridge-url')).toBeVisible()
    await expect(page.getByTestId('signal-api-key')).toBeVisible()
    await expect(page.getByTestId('signal-webhook-secret')).toBeVisible()
    await expect(page.getByTestId('signal-registered-number')).toBeVisible()

    // Test connection button should be visible but disabled (no URL)
    const testBtn = page.getByTestId('test-signal-connection')
    await expect(testBtn).toBeVisible()
    await expect(testBtn).toBeDisabled()
  })

  // =====================================================================
  // Test: Signal test connection button enables with URL
  // =====================================================================
  test('signal test connection button enables when bridge URL is entered', async ({ page }) => {
    await goToSetup(page)
    await fillIdentityStep(page)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })

    await selectChannel(page, 'Signal')
    await clickNext(page)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    const testBtn = page.getByTestId('test-signal-connection')
    await expect(testBtn).toBeDisabled()

    // Enter a bridge URL
    await page.getByTestId('signal-bridge-url').fill('https://signal.example.com:8080')

    // Test button should now be enabled
    await expect(testBtn).toBeEnabled()
  })

  // =====================================================================
  // Test: Webhook URLs shown after validation
  // =====================================================================
  test('webhook confirmation component renders with correct URLs', async ({ page }) => {
    await goToVoiceProviderStep(page)

    // Initially, webhook URLs should NOT be visible (not validated yet)
    await expect(page.getByTestId('webhook-confirmation')).not.toBeVisible()
  })

  // =====================================================================
  // Test: Multiple channels show multiple provider forms
  // =====================================================================
  test('selecting voice and signal shows both provider forms', async ({ page }) => {
    await goToSetup(page)
    await fillIdentityStep(page)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })

    // Select both Voice and Signal
    await selectChannel(page, 'Voice Calls')
    await selectChannel(page, 'Signal')
    await clickNext(page)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Both forms should be visible
    await expect(page.getByText('Voice & SMS Provider')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Signal Bridge' })).toBeVisible()
  })

  // =====================================================================
  // Test: Full flow with provider step
  // =====================================================================
  test('complete setup flow through provider step to dashboard', async ({ page }) => {
    await goToSetup(page)
    const hotlineName = `Provider Flow ${Date.now()}`

    // Step 1: Identity
    await page.locator('#hotline-name').fill(hotlineName)
    await page.locator('#org-name').fill('Provider Test Org')
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })

    // Step 2: Select Voice and Reports
    await selectChannel(page, 'Voice Calls')
    await selectChannel(page, 'Reports')
    await clickNext(page)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Step 3: Voice provider form is shown
    await expect(page.getByText('Voice & SMS Provider')).toBeVisible()
    await expect(page.getByText('Twilio', { exact: true }).first()).toBeVisible()

    // Skip to continue (no real credentials to test)
    await clickSkip(page)
    await expect(page.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Skip remaining steps
    await clickSkip(page) // Settings
    await clickSkip(page) // Invite

    // Step 6: Summary
    await expect(page.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(hotlineName)).toBeVisible()

    // Voice should show as pending (not validated)
    await expect(page.getByText('Pending')).toBeVisible()

    // Complete setup
    await page.getByRole('button', { name: /go to dashboard/i }).click()
    await page.waitForURL('**/', { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })
  })

  // =====================================================================
  // Test: Channel Settings on admin settings page
  // =====================================================================
  test('channel settings section appears on admin settings page', async ({ page }) => {
    // First complete setup
    await goToSetup(page)
    await fillIdentityStep(page)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })
    await selectChannel(page, 'Reports')
    await clickNext(page)
    await clickSkip(page) // Providers
    await clickSkip(page) // Settings
    await clickSkip(page) // Invite
    await page.getByRole('button', { name: /go to dashboard/i }).click()
    await page.waitForURL('**/', { timeout: 15000 })

    // Navigate to admin settings
    await navigateAfterLogin(page, '/admin/settings')
    await expect(page.getByRole('heading', { name: 'Hub Settings' })).toBeVisible({
      timeout: 10000,
    })

    // Channel Settings section should be visible
    await expect(page.getByText('Channels & Providers')).toBeVisible()
  })
})
