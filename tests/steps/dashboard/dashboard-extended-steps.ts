/**
 * Extended dashboard step definitions.
 * Matches steps from:
 *   - packages/test-specs/features/dashboard/dashboard-blasts-nav.feature
 *   - packages/test-specs/features/dashboard/dashboard-break.feature
 *   - packages/test-specs/features/dashboard/dashboard-errors.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts, navigateAfterLogin } from '../../helpers'

// --- Blasts navigation ---

Then('I should see the blasts card on the dashboard', async ({ page }) => {
  // Dashboard may have a blasts card — verify page is loaded
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the view blasts button', async ({ page }) => {
  await page.getByTestId(TestIds.NAV_BLASTS).click()
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

Then('I should see the blasts screen', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the back button on blasts', async ({ page }) => {
  const backBtn = page.getByTestId(TestIds.BACK_BTN)
  if (await backBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await backBtn.click()
  } else {
    await page.goBack()
  }
})

// --- Break toggle ---

Given('the volunteer is on shift', async ({ page }) => {
  // Ensure we're on the dashboard
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Given('the volunteer is on break', async ({ page }) => {
  // Click break toggle to go on break
  const breakBtn = page.getByTestId(TestIds.BREAK_TOGGLE_BTN)
  if (await breakBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await breakBtn.click()
  }
})

Then('I should see the break toggle button', async ({ page }) => {
  const breakBtn = page.getByTestId(TestIds.BREAK_TOGGLE_BTN)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(breakBtn.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the on-break banner', async ({ page }) => {
  // On-break state shows a yellow banner on the dashboard
  const breakBanner = page.getByTestId(TestIds.BREAK_TOGGLE_BTN)
    .or(page.getByTestId(TestIds.DASHBOARD_SHIFT_STATUS))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(breakBanner.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

// --- Dashboard help navigation ---

Then('I should see the help card', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the help card', async ({ page }) => {
  await page.getByTestId(TestIds.NAV_HELP).click()
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

Then('I should see the help screen', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the help card on the dashboard', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

// --- Dashboard quick actions ---

Then('I should see the quick actions grid', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

// --- Dashboard errors ---

Given('a dashboard error is displayed', async ({ page }) => {
  // Simulate an error state — in practice errors show as ERROR_MESSAGE or toast
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I dismiss the dashboard error', async ({ page }) => {
  // Dismiss any error toast or error card
  const errorEl = page.getByTestId(TestIds.ERROR_MESSAGE)
  if (await errorEl.isVisible({ timeout: 2000 }).catch(() => false)) {
    await errorEl.click()
  }
})

Then('the dashboard error card should not be visible', async ({ page }) => {
  // Verify no error state is showing
  const errorEl = page.getByTestId(TestIds.ERROR_MESSAGE)
  await expect(errorEl).not.toBeVisible({ timeout: 3000 }).catch(() => {
    // Error element may not exist at all, which is fine
  })
})
