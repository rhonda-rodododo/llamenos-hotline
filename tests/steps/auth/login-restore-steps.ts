/**
 * Login restore step definitions.
 * Matches steps from: packages/test-specs/features/desktop/auth/login-restore.feature
 * Covers fresh install view (nsec input, backup upload, errors),
 * stored key view (PIN digits, recovery options),
 * and common login elements (language selector, theme toggles, security note).
 */
import { expect } from '@playwright/test'
import { Given, Then } from '../fixtures'
import { TestIds } from '../../test-ids'

// --- Stored key setup ---

Given('I have a stored encrypted key', async ({ page }) => {
  await page.goto('/login')
  // Inject a fake encrypted key blob to trigger the PIN entry UI
  await page.evaluate(() => {
    const data = JSON.stringify({
      salt: 'aa'.repeat(16),
      iterations: 600000,
      nonce: 'bb'.repeat(24),
      ciphertext: 'cc'.repeat(32),
      pubkey: 'dd'.repeat(8),
    })
    localStorage.setItem('llamenos-encrypted-key', data)
    localStorage.setItem('tauri-store:keys.json:llamenos-encrypted-key', data)
  })
})

// "I visit the login page" is defined in navigation-steps.ts
// For stored key tests, we need the page to reload after injecting the key
// The feature file uses "When I visit the login page" which is already defined

// --- Fresh install assertions ---

Then('I should see the backup file upload area', async ({ page }) => {
  await expect(page.locator('input[type="file"][accept=".json"]')).toBeAttached()
  // Keep as content assertion — this is verifying user-facing text for the upload area
  await expect(page.getByText(/select backup file/i)).toBeVisible()
})

// --- Stored key assertions ---

Then('I should see the PIN digit inputs', async ({ page }) => {
  const pageTitle = page.getByTestId(TestIds.PAGE_TITLE)
  await expect(pageTitle).toBeVisible()
  await expect(pageTitle).toContainText(/sign in/i)
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator(`input[aria-label="PIN digit ${i}"]`)).toBeVisible()
  }
})

// --- Common elements ---

Then('I should see the language selector', async ({ page }) => {
  await expect(page.getByRole('combobox', { name: /switch to/i })).toBeVisible()
})

Then('I should see the theme toggle buttons', async ({ page }) => {
  await expect(page.getByTestId(TestIds.THEME_SYSTEM)).toBeVisible()
  await expect(page.getByTestId(TestIds.THEME_LIGHT)).toBeVisible()
  await expect(page.getByTestId(TestIds.THEME_DARK)).toBeVisible()
})
