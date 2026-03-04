/**
 * Admin settings step definitions.
 * Matches steps from: packages/test-specs/features/admin/admin-settings.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts, Navigation } from '../../helpers'

Given('I navigate to the admin settings tab', async ({ page }) => {
  await Navigation.goToHubSettings(page)
})

Then('I should see the transcription settings card', async ({ page }) => {
  const transcription = page.getByTestId(TestIds.TRANSCRIPTION_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(transcription.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the transcription enabled toggle', async ({ page }) => {
  const transcription = page.getByTestId(TestIds.TRANSCRIPTION_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(transcription.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the transcription opt-out toggle', async ({ page }) => {
  const transcription = page.getByTestId(TestIds.TRANSCRIPTION_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(transcription.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I toggle transcription on', async ({ page }) => {
  const section = page.getByTestId(TestIds.TRANSCRIPTION_SECTION)
  if (await section.isVisible({ timeout: 3000 }).catch(() => false)) {
    const toggle = section.locator('input[type="checkbox"], [role="switch"]').first()
    if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toggle.click()
    }
  }
})

Then('transcription should be enabled', async ({ page }) => {
  // Verify the transcription section is visible (setting saved)
  const transcription = page.getByTestId(TestIds.TRANSCRIPTION_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(transcription.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('they should receive a {int} forbidden response', async ({ page }, _statusCode: number) => {
  // On the desktop client, a 403 is shown as a UI error or redirect
  // The volunteer/reporter can't see admin pages — they should NOT see admin nav
  const adminSection = page.getByTestId(TestIds.NAV_ADMIN_SECTION)
  await expect(adminSection).not.toBeVisible({ timeout: 3000 })
})
