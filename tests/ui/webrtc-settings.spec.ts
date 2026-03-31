import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin, reenterPinAfterReload } from '../helpers'

test.describe('WebRTC & Call Preference Settings', () => {
  // --- User Settings: Call Preference ---

  test('call preference section is visible in user settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Click to expand the Call Preference section
    await adminPage.getByText('Call Preference').first().click()
    await expect(adminPage.getByText('Phone Only')).toBeVisible()
    await expect(adminPage.getByText('Browser Only')).toBeVisible()
    await expect(adminPage.getByText('Phone + Browser')).toBeVisible()
  })

  test('phone only is selected by default', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await adminPage.getByText('Call Preference').first().click()

    // Phone Only should be the active option (has the indicator dot)
    const phoneOption = adminPage.locator('button').filter({ hasText: 'Phone Only' })
    await expect(phoneOption).toHaveClass(/border-primary/)
  })

  test('browser and both options are disabled when WebRTC not configured', async ({
    adminPage,
  }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await adminPage.getByText('Call Preference').first().click()

    // WebRTC not configured message should be visible
    await expect(adminPage.getByText(/browser calling is not available/i)).toBeVisible()

    // Browser and Both options should be disabled
    const browserOption = adminPage.locator('button').filter({ hasText: 'Browser Only' })
    const bothOption = adminPage.locator('button').filter({ hasText: 'Phone + Browser' })
    await expect(browserOption).toBeDisabled()
    await expect(bothOption).toBeDisabled()
  })

  test('deep link to call-preference section auto-expands it', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings?section=call-preference')
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible({
      timeout: 10000,
    })

    // The section should be expanded — we should see the preference options
    await expect(adminPage.getByText('Phone Only')).toBeVisible({ timeout: 10000 })
  })

  // --- Hub Settings: WebRTC Configuration ---

  test('WebRTC config section appears in telephony provider settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    // Expand the Telephony Provider section
    await adminPage.getByText('Telephony Provider').first().click()

    // WebRTC Configuration section should be visible
    await expect(adminPage.getByText('WebRTC Configuration')).toBeVisible()
  })

  test('WebRTC toggle enables API key fields for Twilio', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await adminPage.getByText('Telephony Provider').first().click()

    // Initially, WebRTC fields should not be visible (toggle is off)
    await expect(adminPage.getByText('API Key SID')).not.toBeVisible()

    // Enable WebRTC toggle
    const webrtcSection = adminPage
      .locator('div')
      .filter({ hasText: /WebRTC Configuration/ })
      .filter({ has: adminPage.getByRole('switch') })
      .last()
    const toggle = webrtcSection.getByRole('switch')
    await toggle.click()

    // Now API Key fields should be visible
    await expect(adminPage.getByText('API Key SID')).toBeVisible()
    await expect(adminPage.getByText('API Key Secret')).toBeVisible()
    await expect(adminPage.getByText('TwiML App SID')).toBeVisible()
  })

  test('WebRTC fields not shown for Asterisk provider', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await adminPage.getByText('Telephony Provider').first().click()

    // Switch to Asterisk
    const select = adminPage.locator('select').first()
    await select.selectOption('asterisk')

    // WebRTC Configuration should NOT be visible for Asterisk
    await expect(adminPage.getByText('WebRTC Configuration')).not.toBeVisible()
  })

  test('WebRTC toggle shown for SignalWire provider', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await adminPage.getByText('Telephony Provider').first().click()

    // Switch to SignalWire
    const select = adminPage.locator('select').first()
    await select.selectOption('signalwire')

    // WebRTC Configuration should still be visible
    await expect(adminPage.getByText('WebRTC Configuration')).toBeVisible()
  })

  test('WebRTC toggle shown for Vonage without extra fields', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await adminPage.getByText('Telephony Provider').first().click()

    // Switch to Vonage
    const select = adminPage.locator('select').first()
    await select.selectOption('vonage')

    // WebRTC Configuration should be visible
    await expect(adminPage.getByText('WebRTC Configuration')).toBeVisible()

    // Enable WebRTC
    const webrtcSection = adminPage
      .locator('div')
      .filter({ hasText: /WebRTC Configuration/ })
      .filter({ has: adminPage.getByRole('switch') })
      .last()
    const toggle = webrtcSection.getByRole('switch')
    await toggle.click()

    // Vonage doesn't need API Key SID — should NOT show Twilio-specific fields
    await expect(adminPage.getByText('API Key SID')).not.toBeVisible()
    await expect(adminPage.getByText('TwiML App SID')).not.toBeVisible()
  })

  test('WebRTC config persists with provider save', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await adminPage.getByText('Telephony Provider').first().click()

    // Fill in basic Twilio credentials
    await adminPage.getByTestId('account-sid').fill('ACwebrtctest123')
    await adminPage.getByTestId('auth-token').fill('webrtc-auth-token')

    // Enable WebRTC and fill API Key fields
    const webrtcSection = adminPage
      .locator('div')
      .filter({ hasText: /WebRTC Configuration/ })
      .filter({ has: adminPage.getByRole('switch') })
      .last()
    const toggle = webrtcSection.getByRole('switch')
    await toggle.click()

    await adminPage.getByTestId('api-key-sid').fill('SKtestkey123')
    await adminPage.getByTestId('twiml-app-sid').fill('APtestapp456')

    // Save
    await adminPage.getByRole('button', { name: /save provider/i }).click()
    await expect(adminPage.getByText(/telephony provider saved/i)).toBeVisible({ timeout: 5000 })

    // Reload the page — clears keyManager, PIN re-entry needed
    await adminPage.reload()
    await reenterPinAfterReload(adminPage)
    // PIN unlock may redirect to profile-setup — handle it
    if (adminPage.url().includes('profile-setup')) {
      await adminPage.getByRole('button', { name: /complete setup/i }).click()
      await adminPage.waitForURL((u) => !u.toString().includes('profile-setup'), { timeout: 15000 })
    }
    // Navigate back to Hub Settings
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    // Expand the section
    await adminPage.getByText('Telephony Provider').first().click()

    // Verify WebRTC fields are populated
    await expect(adminPage.getByTestId('api-key-sid')).toHaveValue('SKtestkey123')
    await expect(adminPage.getByTestId('twiml-app-sid')).toHaveValue('APtestapp456')
  })
})
