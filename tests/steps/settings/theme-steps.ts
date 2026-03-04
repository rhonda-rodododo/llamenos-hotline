/**
 * Theme step definitions.
 * Matches steps from: packages/test-specs/features/settings/theme.feature
 */
import { expect } from '@playwright/test'
import { When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

// --- Theme button clicks ---

When('I click the dark theme button', async ({ page }) => {
  await page.getByTestId(TestIds.THEME_DARK).click()
  await page.waitForTimeout(Timeouts.UI_SETTLE)
})

When('I click the light theme button', async ({ page }) => {
  await page.getByTestId(TestIds.THEME_LIGHT).click()
  await page.waitForTimeout(Timeouts.UI_SETTLE)
})

When('I click the system theme button', async ({ page }) => {
  await page.getByTestId(TestIds.THEME_SYSTEM).click()
  await page.waitForTimeout(Timeouts.UI_SETTLE)
})

// --- Theme assertions on login page ---

Then('I should see the dark theme button on the login page', async ({ page }) => {
  await expect(page.getByTestId(TestIds.THEME_DARK)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the light theme button on the login page', async ({ page }) => {
  await expect(page.getByTestId(TestIds.THEME_LIGHT)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the system theme button on the login page', async ({ page }) => {
  await expect(page.getByTestId(TestIds.THEME_SYSTEM)).toBeVisible({ timeout: Timeouts.ELEMENT })
})
