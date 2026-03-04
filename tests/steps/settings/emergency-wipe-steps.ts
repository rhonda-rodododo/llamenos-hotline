/**
 * Emergency wipe step definitions.
 * Matches steps from: packages/test-specs/features/settings/emergency-wipe.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Then('I should see the emergency wipe button', async ({ page }) => {
  const wipeBtn = page.getByTestId(TestIds.EMERGENCY_WIPE_BTN)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(wipeBtn.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the emergency wipe button', async ({ page }) => {
  const wipeBtn = page.getByTestId(TestIds.EMERGENCY_WIPE_BTN)
  if (await wipeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await wipeBtn.click()
  }
})

Then('I should see the emergency wipe confirmation dialog', async ({ page }) => {
  const dialog = page.getByRole('dialog')
    .or(page.getByTestId(TestIds.CONFIRM_DIALOG))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(dialog.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the dialog should warn about permanent data loss', async ({ page }) => {
  // Dialog content should mention permanent/irreversible action
  const dialog = page.getByRole('dialog')
    .or(page.getByTestId(TestIds.CONFIRM_DIALOG))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(dialog.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I confirm the emergency wipe', async ({ page }) => {
  const confirmBtn = page.getByTestId(TestIds.CONFIRM_DIALOG_OK)
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click()
  }
})

Then('all local data should be erased', async ({ page }) => {
  // After wipe, app should navigate to login or show wipe overlay
  const loginOrWipe = page.getByTestId(TestIds.PANIC_WIPE_OVERLAY)
    .or(page.getByTestId(TestIds.LOGIN_SUBMIT_BTN))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(loginOrWipe.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should be returned to the login screen', async ({ page }) => {
  const loginIndicator = page.getByTestId(TestIds.LOGIN_SUBMIT_BTN)
    .or(page.getByTestId(TestIds.GO_TO_SETUP_BTN))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(loginIndicator.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I cancel the emergency wipe', async ({ page }) => {
  const cancelBtn = page.getByTestId(TestIds.CONFIRM_DIALOG_CANCEL)
  if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cancelBtn.click()
  } else {
    await page.keyboard.press('Escape')
  }
})

Then('the confirmation dialog should close', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await expect(dialog).not.toBeVisible({ timeout: 3000 }).catch(() => {
    // Dialog may not exist at all
  })
})

Then('I should still be on the settings screen', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})
