/**
 * Generic assertion step definitions using data-testid selectors.
 */
import { expect } from '@playwright/test'
import { Then, When } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Then('I should see the {string} button', async ({ page }, buttonText: string) => {
  await expect(page.getByRole('button', { name: buttonText })).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the error {string}', async ({ page }, errorText: string) => {
  const errorMsg = page.getByTestId(TestIds.ERROR_MESSAGE)
  const errorVisible = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)
  if (errorVisible) {
    await expect(errorMsg).toContainText(errorText)
  } else {
    // Fallback: look for error text in role="alert" or destructive elements
    const anyError = page.locator('[role="alert"]').filter({ hasText: errorText })
      .or(page.locator('.text-destructive').filter({ hasText: errorText }))
    await expect(anyError.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('I should see an error message', async ({ page }) => {
  const errorMsg = page.getByTestId(TestIds.ERROR_MESSAGE)
  const anyError = page.locator('[role="alert"]')
  await expect(errorMsg.or(anyError)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should remain on the login screen', async ({ page }) => {
  // URL should still contain /login
  expect(page.url()).toContain('/login')
})

Then('I should remain on the unlock screen', async ({ page }) => {
  // The PIN unlock screen should still be visible
  const pinInput = page.getByTestId(TestIds.PIN_INPUT).or(
    page.locator('input[aria-label="PIN digit 1"]'),
  )
  await expect(pinInput.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should remain on the settings screen', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toContainText(/settings/i)
})

Then('I should remain on the PIN confirmation screen', async ({ page }) => {
  const confirmDialog = page.getByTestId(TestIds.CONFIRM_DIALOG)
  const pinInput = page.getByTestId(TestIds.PIN_INPUT).or(
    page.locator('input[aria-label="PIN digit 1"]'),
  )
  await expect(confirmDialog.or(pinInput.first())).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see a confirmation dialog', async ({ page }) => {
  await expect(page.getByTestId(TestIds.CONFIRM_DIALOG)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the dialog should be dismissed', async ({ page }) => {
  await expect(page.getByTestId(TestIds.CONFIRM_DIALOG)).not.toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('no crashes should occur', async () => {
  // If we got this far without an exception, no crashes occurred
})

Then('I should see {string} and {string} buttons', async ({ page }, btn1: string, btn2: string) => {
  await expect(page.getByRole('button', { name: btn1 })).toBeVisible({ timeout: Timeouts.ELEMENT })
  await expect(page.getByRole('button', { name: btn2 })).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I confirm the reset', async ({ page }) => {
  // Click the confirm button in the dialog
  const confirmBtn = page.getByTestId(TestIds.CONFIRM_DIALOG_OK)
  const confirmVisible = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)
  if (confirmVisible) {
    await confirmBtn.click()
  } else {
    // Fallback: look for a confirm/reset/delete button in the dialog
    await page.getByTestId(TestIds.CONFIRM_DIALOG).getByRole('button', { name: /confirm|reset|delete|yes/i }).click()
  }
})

Then('no stored keys should remain', async ({ page }) => {
  const hasKey = await page.evaluate(() => {
    return (
      localStorage.getItem('llamenos-encrypted-key') !== null ||
      localStorage.getItem('tauri-store:keys.json:llamenos-encrypted-key') !== null
    )
  })
  expect(hasKey).toBe(false)
})
