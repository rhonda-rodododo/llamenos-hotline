import { type Page, expect, test } from '@playwright/test'
import { TEST_PIN, enterPin, loginAsAdmin, navigateAfterLogin } from '../helpers'

/** Navigate to Hub Settings and expand the Telephony Provider section */
async function expandTelephonySection(page: Page) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()
  await page.getByText('Telephony Provider').first().click()
  await expect(page.getByTestId('telephony-provider-select')).toBeVisible({ timeout: 10000 })
}

test.describe('Telephony Provider Settings', () => {
  test('telephony provider section is visible and collapsed by default', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()
    await expect(page.getByText('Telephony Provider').first()).toBeVisible()
  })

  test('expanding section shows provider form', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)
    // Should show either the env fallback message or current provider (if saved by another test)
    await expect(
      page.getByText(/using environment variable defaults/i).or(page.getByText(/current provider/i))
    ).toBeVisible({ timeout: 10000 })
  })

  test('provider dropdown shows all providers', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    const select = page.getByTestId('telephony-provider-select')
    const options = select.locator('option')
    await expect(options).toHaveCount(6)
    await expect(options.nth(0)).toHaveText('Twilio')
    await expect(options.nth(1)).toHaveText('SignalWire')
    await expect(options.nth(2)).toHaveText('Vonage')
    await expect(options.nth(3)).toHaveText('Plivo')
    await expect(options.nth(4)).toHaveText('Asterisk (Self-Hosted)')
    await expect(options.nth(5)).toHaveText('Telnyx')
  })

  test('changing provider updates credential form fields', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    const select = page.getByTestId('telephony-provider-select')

    // Switch to Twilio first to ensure consistent starting state
    await select.selectOption('twilio')
    await expect(page.getByText('Account SID')).toBeVisible()
    await expect(page.getByText('Auth Token').first()).toBeVisible()
    await expect(page.getByText('SignalWire Space', { exact: true })).not.toBeVisible()

    // Switch to SignalWire
    await select.selectOption('signalwire')
    await expect(page.getByText('SignalWire Space', { exact: true })).toBeVisible()
    await expect(page.getByText('Account SID')).toBeVisible()

    // Switch to Vonage
    await select.selectOption('vonage')
    await expect(page.getByText('API Key')).toBeVisible()
    await expect(page.getByText('API Secret')).toBeVisible()
    await expect(page.getByText('Application ID')).toBeVisible()
    await expect(page.getByText('Account SID')).not.toBeVisible()
    await expect(page.getByText(/not yet implemented/i)).not.toBeVisible()

    // Switch to Plivo
    await select.selectOption('plivo')
    await expect(page.getByText('Auth ID')).toBeVisible()
    await expect(page.getByText(/not yet implemented/i)).not.toBeVisible()

    // Switch to Asterisk
    await select.selectOption('asterisk')
    await expect(page.getByText('ARI URL')).toBeVisible()
    await expect(page.getByText('ARI Username')).toBeVisible()
    await expect(page.getByText('ARI Password')).toBeVisible()
    await expect(page.getByText('Bridge Callback URL')).toBeVisible()
    await expect(page.getByText(/not yet implemented/i)).not.toBeVisible()
  })

  test('save button disabled when phone number is empty', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    // Ensure Twilio is selected (no pre-filled phone for this provider if we just switched)
    const select = page.getByTestId('telephony-provider-select')
    await select.selectOption('twilio')

    // Clear any pre-filled phone number
    const phoneInput = page.locator('input[type="tel"]')
    await phoneInput.fill('')

    const saveButton = page.getByRole('button', { name: /save provider/i })
    await expect(saveButton).toBeDisabled()
  })

  test('admin can save Twilio provider config', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    // Select Twilio explicitly
    const select = page.getByTestId('telephony-provider-select')
    await select.selectOption('twilio')

    // Fill in Twilio credentials
    await page.locator('input[type="tel"]').fill('+15551234567')
    await page.getByPlaceholder('AC...').fill('AC1234567890abcdef')
    const authTokenInput = page.locator('input[type="password"]').first()
    await authTokenInput.fill('test-auth-token-123')

    // Save
    const saveButton = page.getByRole('button', { name: /save provider/i })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    // Should show success toast
    await expect(page.getByText(/telephony provider saved/i)).toBeVisible({ timeout: 5000 })

    // Should now show "Current provider: Twilio"
    await expect(page.getByText(/current provider.*twilio/i)).toBeVisible()
  })

  test('saved provider config persists after page reload', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    // Save a config with unique values
    const uniqueSid = `AC${Date.now().toString(16)}`
    await page.locator('input[type="tel"]').fill('+15559876543')
    await page.getByPlaceholder('AC...').fill(uniqueSid)
    const authTokenInput = page.locator('input[type="password"]').first()
    await authTokenInput.fill('test-auth-token-456')

    await page.getByRole('button', { name: /save provider/i }).click()
    await expect(page.getByText(/telephony provider saved/i)).toBeVisible({ timeout: 5000 })

    // Reload the page — clears keyManager, PIN re-entry needed
    await page.reload()
    await enterPin(page, TEST_PIN)
    // PIN unlock redirects to dashboard — navigate back to Hub Settings
    await expandTelephonySection(page)

    // Should show current provider
    await expect(page.getByText(/current provider/i)).toBeVisible()

    // Account SID should be pre-filled (could be ours or overwritten by a parallel test)
    await expect(page.getByPlaceholder('AC...')).not.toHaveValue('')
  })

  test('admin can save SignalWire provider config', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    // Switch to SignalWire
    const select = page.getByTestId('telephony-provider-select')
    await select.selectOption('signalwire')

    // Fill in SignalWire credentials
    await page.locator('input[type="tel"]').fill('+15551112222')
    await page.getByPlaceholder('AC...').fill('SW-project-id-123')
    const authTokenInput = page.locator('input[type="password"]').first()
    await authTokenInput.fill('sw-auth-token-789')
    await page.getByPlaceholder('myspace').fill('myhotline')

    // Save
    await page.getByRole('button', { name: /save provider/i }).click()
    await expect(page.getByText(/telephony provider saved/i)).toBeVisible({ timeout: 5000 })

    // Should show current provider as SignalWire
    await expect(page.getByText(/current provider.*signalwire/i)).toBeVisible()
  })

  test('test connection button works (will fail with fake creds)', async ({ page }) => {
    await loginAsAdmin(page)
    await expandTelephonySection(page)

    // Select Twilio and fill minimal creds
    const select = page.getByTestId('telephony-provider-select')
    await select.selectOption('twilio')
    await page.locator('input[type="tel"]').fill('+15551234567')
    await page.getByPlaceholder('AC...').fill('ACfake123')
    const authTokenInput = page.locator('input[type="password"]').first()
    await authTokenInput.fill('fake-token')

    // Click Test Connection
    const testButton = page.getByRole('button', { name: /test connection/i })
    await testButton.click()

    // Should show failure (since creds are fake) — may transition through "Testing..." first
    await expect(page.getByText(/connection failed/i)).toBeVisible({ timeout: 15000 })
  })

  test('deep link to telephony-provider section auto-expands it', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/settings?section=telephony-provider')
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible({
      timeout: 10000,
    })

    // The section should be expanded — we should see the provider dropdown
    await expect(page.getByTestId('telephony-provider-select')).toBeVisible({ timeout: 10000 })
  })
})
