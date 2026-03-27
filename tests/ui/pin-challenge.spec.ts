import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  ADMIN_NSEC,
  TEST_PIN,
  enterPin,
  loginAsAdmin,
  navigateAfterLogin,
  uniquePhone,
} from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('PIN Challenge (Re-auth Step-up)', () => {
  test.beforeEach(async ({ request }) => {
    // Ensure at least one volunteer with a phone exists for the toggle button
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    await adminApi.post('/api/volunteers', {
      pubkey: pk,
      name: 'PIN Test Volunteer',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
    })
  })

  test('phone unmask on volunteers page requires PIN', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/volunteers')

    // Wait for volunteers list to load
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    // Find a volunteer row with a phone toggle button
    const toggleBtn = page.getByTestId('toggle-phone-visibility').first()
    await expect(toggleBtn).toBeVisible({ timeout: 5000 })

    // Click to unmask phone — should trigger PIN challenge
    await toggleBtn.click()

    // Verify PIN dialog appears
    const pinDialog = page.getByTestId('pin-challenge-dialog')
    await expect(pinDialog).toBeVisible({ timeout: 5000 })

    // Enter correct PIN
    await enterPin(page, TEST_PIN)

    // Dialog should close
    await expect(pinDialog).not.toBeVisible({ timeout: 5000 })

    // Phone should now be visible (unmasked — full E.164 format with +)
    const phoneText = page.locator('p.font-mono').first()
    await expect(phoneText).toContainText('+')
  })

  test('wrong PIN shows error, 3 failures wipes key', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/volunteers')

    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    const toggleBtn = page.getByTestId('toggle-phone-visibility').first()
    await expect(toggleBtn).toBeVisible({ timeout: 5000 })

    // Click to unmask phone
    await toggleBtn.click()

    const pinDialog = page.getByTestId('pin-challenge-dialog')
    await expect(pinDialog).toBeVisible({ timeout: 5000 })

    // Enter wrong PIN
    await enterPin(page, '999999')

    // Should show error
    const errorMsg = page.getByTestId('pin-challenge-error')
    await expect(errorMsg).toBeVisible({ timeout: 5000 })

    // Enter wrong PIN again
    await enterPin(page, '888888')
    await expect(errorMsg).toBeVisible({ timeout: 5000 })

    // Third wrong PIN — should trigger wipe and close dialog
    await enterPin(page, '777777')

    // Dialog should close after max attempts (CI Chromium needs extra time for wipe + redirect)
    await expect(pinDialog).not.toBeVisible({ timeout: 15000 })

    // Key should be wiped — redirected to login
    await page.waitForURL('**/login', { timeout: 15000 })
  })

  test('cancel PIN challenge closes dialog without action', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/volunteers')

    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    const toggleBtn = page.getByTestId('toggle-phone-visibility').first()
    await expect(toggleBtn).toBeVisible({ timeout: 5000 })

    // Click to unmask phone
    await toggleBtn.click()

    const pinDialog = page.getByTestId('pin-challenge-dialog')
    await expect(pinDialog).toBeVisible({ timeout: 5000 })

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click()

    // Dialog should close
    await expect(pinDialog).not.toBeVisible({ timeout: 5000 })

    // Should still be on volunteers page
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()
  })
})
