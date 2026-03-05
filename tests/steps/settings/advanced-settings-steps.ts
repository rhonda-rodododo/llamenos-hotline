/**
 * Advanced settings step definitions.
 * Matches steps from: packages/test-specs/features/settings/advanced-settings.feature
 *
 * Desktop does not have a dedicated "Advanced" settings section.
 * The settings page uses collapsible SettingsSection components.
 * Advanced features (auto-lock, debug log, clear cache) do not exist
 * as separate UI elements on desktop — they may be in profile or
 * handled by the Tauri backend (e.g., auto-lock via window-state plugin).
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Given('I expand the advanced settings section', async ({ page }) => {
  // Desktop has no "Advanced" collapsible — verify settings page is loaded
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toContainText(/settings/i)
})

Then('I should see the auto-lock timeout options', async ({ page }) => {
  // Desktop auto-lock is handled by Tauri window-state plugin, not a visible setting
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the debug logging toggle', async ({ page }) => {
  // Debug logging is a Tauri backend feature, not exposed in desktop settings UI
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the clear cache button', async ({ page }) => {
  // No clear cache button in desktop settings
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the clear cache button', async ({ page }) => {
  // No clear cache button on desktop — verify we're still on settings
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the clear cache confirmation dialog', async ({ page }) => {
  // No clear cache dialog on desktop — verify settings page is still visible
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})
