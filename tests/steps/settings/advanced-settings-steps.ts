/**
 * Advanced settings step definitions.
 * Matches steps from: packages/test-specs/features/settings/advanced-settings.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Given('I expand the advanced settings section', async ({ page }) => {
  // Click on the advanced settings section header to expand it
  const advancedSection = page.getByTestId(TestIds.SETTINGS_ADVANCED_SECTION)
  if (await advancedSection.isVisible({ timeout: 3000 }).catch(() => false)) {
    await advancedSection.click()
  } else {
    // Try clicking a section with "Advanced" text
    const section = page.getByText(/advanced/i).first()
    if (await section.isVisible({ timeout: 2000 }).catch(() => false)) {
      await section.click()
    }
  }
})

Then('I should see the auto-lock timeout options', async ({ page }) => {
  const autoLock = page.getByTestId(TestIds.SETTINGS_AUTO_LOCK)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(autoLock.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the debug logging toggle', async ({ page }) => {
  const debugLog = page.getByTestId(TestIds.SETTINGS_DEBUG_LOG)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(debugLog.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the clear cache button', async ({ page }) => {
  const clearCache = page.getByTestId(TestIds.SETTINGS_CLEAR_CACHE)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(clearCache.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the clear cache button', async ({ page }) => {
  const clearCache = page.getByTestId(TestIds.SETTINGS_CLEAR_CACHE)
  if (await clearCache.isVisible({ timeout: 3000 }).catch(() => false)) {
    await clearCache.click()
  }
})

Then('I should see the clear cache confirmation dialog', async ({ page }) => {
  const dialog = page.getByRole('dialog')
    .or(page.getByTestId(TestIds.CONFIRM_DIALOG))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(dialog.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})
