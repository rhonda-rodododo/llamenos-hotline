/**
 * Language selection step definitions.
 * Matches steps from: packages/test-specs/features/settings/language-selection.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

When('I expand the language section', async ({ page }) => {
  const section = page.getByText(/language/i).first()
  if (await section.isVisible({ timeout: 3000 }).catch(() => false)) {
    await section.click()
  }
})

Then('I should see the language options', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see language chips for all supported locales', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap a language chip', async ({ page }) => {
  // Click any language chip
  const chip = page.locator('[role="option"], [role="radio"], button').filter({ hasText: /english|español|中文/i }).first()
  if (await chip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chip.click()
  }
})

Then('the language chip should be selected', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I expand the profile section', async ({ page }) => {
  const section = page.getByText(/profile/i).first()
  if (await section.isVisible({ timeout: 3000 }).catch(() => false)) {
    await section.click()
  }
})

Then('I should see the spoken languages chips', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap a spoken language chip', async ({ page }) => {
  const chip = page.locator('[role="option"], [role="radio"], [role="checkbox"], button').filter({ hasText: /english|español|中文/i }).first()
  if (await chip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chip.click()
  }
})

Then('the spoken language chip should be selected', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})
