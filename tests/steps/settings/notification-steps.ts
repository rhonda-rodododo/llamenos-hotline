/**
 * Notification preferences step definitions.
 * Matches steps from: packages/test-specs/features/settings/notifications.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Then('I should see the notifications section', async ({ page }) => {
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the notification toggles', async ({ page }) => {
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})
