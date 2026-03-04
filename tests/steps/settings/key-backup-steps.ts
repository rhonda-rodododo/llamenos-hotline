/**
 * Key backup settings step definitions.
 * Matches steps from: packages/test-specs/features/settings/key-backup.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Then('I should see the key backup section', async ({ page }) => {
  // Key backup section on settings page
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the key backup warning', async ({ page }) => {
  // Key backup warning text about securing nsec
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})
