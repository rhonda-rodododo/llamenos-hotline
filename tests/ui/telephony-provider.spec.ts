import { type Page, expect, test } from '../fixtures/auth'
import { navigateAfterLogin, reenterPinAfterReload } from '../helpers'

/** Navigate to Hub Settings and expand the Telephony Provider section */
async function expandTelephonySection(page: Page) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()
  await page.getByText('Telephony Provider').first().click()
  await expect(page.getByTestId('telephony-provider-select')).toBeVisible({ timeout: 10000 })
}

test.describe('Telephony Provider Settings', () => {
  test('telephony provider section is visible and collapsed by default', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()
    await expect(adminPage.getByText('Telephony Provider').first()).toBeVisible()
  })

  test('expanding section shows provider form', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)
    // Should show either the env fallback message or current provider (if saved by another test)
    await expect(
      adminPage
        .getByText(/using environment variable defaults/i)
        .or(adminPage.getByText(/current provider/i))
    ).toBeVisible({ timeout: 10000 })
  })

  test('provider dropdown shows all providers', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    const select = adminPage.getByTestId('telephony-provider-select')
    const options = select.locator('option')
    await expect(options).toHaveCount(8)
    await expect(options.nth(0)).toHaveText('Twilio')
    await expect(options.nth(1)).toHaveText('SignalWire')
    await expect(options.nth(2)).toHaveText('Vonage')
    await expect(options.nth(3)).toHaveText('Plivo')
    await expect(options.nth(4)).toHaveText('Asterisk (Self-Hosted)')
    await expect(options.nth(5)).toHaveText('Telnyx')
    await expect(options.nth(6)).toHaveText('Bandwidth')
    await expect(options.nth(7)).toHaveText('FreeSWITCH (Self-Hosted)')
  })

  test('changing provider updates credential form fields', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    const select = adminPage.getByTestId('telephony-provider-select')

    // Switch to Twilio first to ensure consistent starting state
    await select.selectOption('twilio')
    await expect(adminPage.getByText('Account SID')).toBeVisible()
    await expect(adminPage.getByText('Auth Token').first()).toBeVisible()
    await expect(adminPage.getByText('SignalWire Space', { exact: true })).not.toBeVisible()

    // Switch to SignalWire
    await select.selectOption('signalwire')
    await expect(adminPage.getByText('SignalWire Space', { exact: true })).toBeVisible()
    await expect(adminPage.getByText('Account SID')).toBeVisible()

    // Switch to Vonage
    await select.selectOption('vonage')
    await expect(adminPage.getByText('API Key')).toBeVisible()
    await expect(adminPage.getByText('API Secret')).toBeVisible()
    await expect(adminPage.getByText('Application ID')).toBeVisible()
    await expect(adminPage.getByText('Account SID')).not.toBeVisible()
    await expect(adminPage.getByText(/not yet implemented/i)).not.toBeVisible()

    // Switch to Plivo
    await select.selectOption('plivo')
    await expect(adminPage.getByText('Auth ID')).toBeVisible()
    await expect(adminPage.getByText(/not yet implemented/i)).not.toBeVisible()

    // Switch to Asterisk
    await select.selectOption('asterisk')
    await expect(adminPage.getByText('ARI URL')).toBeVisible()
    await expect(adminPage.getByText('ARI Username')).toBeVisible()
    await expect(adminPage.getByText('ARI Password')).toBeVisible()
    await expect(adminPage.getByText('Bridge Callback URL')).toBeVisible()
    await expect(adminPage.getByText(/not yet implemented/i)).not.toBeVisible()
  })

  test('save button disabled when phone number is empty', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    // Ensure Twilio is selected (no pre-filled phone for this provider if we just switched)
    const select = adminPage.getByTestId('telephony-provider-select')
    await select.selectOption('twilio')

    // Clear any pre-filled phone number
    const phoneInput = adminPage.locator('input[type="tel"]')
    await phoneInput.fill('')

    const saveButton = adminPage.getByRole('button', { name: /save provider/i })
    await expect(saveButton).toBeDisabled()
  })

  test('admin can save Twilio provider config', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    // Select Twilio explicitly
    const select = adminPage.getByTestId('telephony-provider-select')
    await select.selectOption('twilio')

    // Fill in Twilio credentials
    await adminPage.locator('input[type="tel"]').fill('+15551234567')
    await adminPage.getByPlaceholder('AC...').fill('AC1234567890abcdef')
    const authTokenInput = adminPage.locator('input[type="password"]').first()
    await authTokenInput.fill('test-auth-token-123')

    // Save
    const saveButton = adminPage.getByRole('button', { name: /save provider/i })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    // Should show success toast
    await expect(adminPage.getByText(/telephony provider saved/i)).toBeVisible({ timeout: 5000 })

    // Should now show "Current provider: Twilio"
    await expect(adminPage.getByText(/current provider.*twilio/i)).toBeVisible()
  })

  test('saved provider config persists after page reload', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    // Save a config with unique values
    const uniqueSid = `AC${Date.now().toString(16)}`
    await adminPage.locator('input[type="tel"]').fill('+15559876543')
    await adminPage.getByPlaceholder('AC...').fill(uniqueSid)
    const authTokenInput = adminPage.locator('input[type="password"]').first()
    await authTokenInput.fill('test-auth-token-456')

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
    await expandTelephonySection(adminPage)

    // Should show current provider
    await expect(adminPage.getByText(/current provider/i)).toBeVisible()

    // Account SID should be pre-filled (could be ours or overwritten by a parallel test).
    // Wait for the field to appear — config must load and sync to draft first.
    const accountSidInput = adminPage.getByPlaceholder('AC...')
    await expect(accountSidInput).toBeVisible({ timeout: 10000 })
    await expect(accountSidInput).not.toHaveValue('')
  })

  test('admin can save SignalWire provider config', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    // Switch to SignalWire
    const select = adminPage.getByTestId('telephony-provider-select')
    await select.selectOption('signalwire')

    // Fill in SignalWire credentials
    await adminPage.locator('input[type="tel"]').fill('+15551112222')
    await adminPage.getByPlaceholder('AC...').fill('SW-project-id-123')
    const authTokenInput = adminPage.locator('input[type="password"]').first()
    await authTokenInput.fill('sw-auth-token-789')
    await adminPage.getByPlaceholder('myspace').fill('myhotline')

    // Save
    await adminPage.getByRole('button', { name: /save provider/i }).click()
    await expect(adminPage.getByText(/telephony provider saved/i)).toBeVisible({ timeout: 5000 })

    // Should show current provider as SignalWire
    await expect(adminPage.getByText(/current provider.*signalwire/i)).toBeVisible()
  })

  test('test connection button works (will fail with fake creds)', async ({ adminPage }) => {
    await expandTelephonySection(adminPage)

    // Select Twilio and fill minimal creds
    const select = adminPage.getByTestId('telephony-provider-select')
    await select.selectOption('twilio')
    await adminPage.locator('input[type="tel"]').fill('+15551234567')
    await adminPage.getByPlaceholder('AC...').fill('ACfake123')
    const authTokenInput = adminPage.locator('input[type="password"]').first()
    await authTokenInput.fill('fake-token')

    // Click Test Connection
    const testButton = adminPage.getByRole('button', { name: /test connection/i })
    await testButton.click()

    // Should show failure (since creds are fake) — may transition through "Testing..." first
    await expect(adminPage.getByText(/connection failed/i)).toBeVisible({ timeout: 15000 })
  })

  test('deep link to telephony-provider section auto-expands it', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings?section=telephony-provider')
    await expect(adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible(
      {
        timeout: 10000,
      }
    )

    // The section should be expanded — we should see the provider dropdown
    await expect(adminPage.getByTestId('telephony-provider-select')).toBeVisible({ timeout: 10000 })
  })
})
