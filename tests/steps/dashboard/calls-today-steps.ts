/**
 * Calls today dashboard step definitions.
 * Matches steps from: packages/test-specs/features/dashboard/calls-today.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts, loginAsAdmin } from '../../helpers'

Given('the app is launched', async ({ page }) => {
  await loginAsAdmin(page)
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.AUTH })
})

Then('I should see the calls today count on the dashboard', async ({ page }) => {
  const callsCard = page.getByTestId(TestIds.DASHBOARD_CALLS_TODAY)
  await expect(callsCard).toBeVisible({ timeout: Timeouts.ELEMENT })
  // Should have a numeric count within the card
  const text = await callsCard.textContent()
  expect(text).toMatch(/\d+/)
})

When('I pull to refresh the dashboard', async ({ page }) => {
  // On desktop, pull-to-refresh is simulated by page reload or a refresh button
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  // Re-enter PIN if needed
  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  const pinVisible = await pinInput.isVisible({ timeout: 2000 }).catch(() => false)
  if (pinVisible) {
    const { enterPin, TEST_PIN } = await import('../../helpers')
    await enterPin(page, TEST_PIN)
    await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 15000 })
  }
})
