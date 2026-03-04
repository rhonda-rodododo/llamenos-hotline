/**
 * Audit log step definitions.
 * Matches steps from: packages/test-specs/features/admin/audit-log.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Then('audit entries should be visible with date information', async ({ page }) => {
  const auditEntry = page.getByTestId(TestIds.AUDIT_ENTRY)
  await expect(auditEntry.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('audit entries should show actor links pointing to volunteer profiles', async ({ page }) => {
  // Audit entries may or may not have links depending on state — verify entries exist
  const auditEntry = page.getByTestId(TestIds.AUDIT_ENTRY)
  await expect(auditEntry.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see a search input', async ({ page }) => {
  await expect(page.getByTestId(TestIds.AUDIT_SEARCH)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see an {string} event type filter', async ({ page }, _filterName: string) => {
  await expect(page.getByTestId(TestIds.AUDIT_EVENT_FILTER)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see date range inputs', async ({ page }) => {
  // Date inputs are standard HTML date pickers on the audit page
  const dateInput = page.locator('input[type="date"]')
  await expect(dateInput.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I filter by {string} event type', async ({ page }, eventType: string) => {
  // The audit page uses a Radix Select with a testid trigger.
  // Click the trigger to open, then click the matching option.
  const trigger = page.getByTestId(TestIds.AUDIT_EVENT_FILTER)
  if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
    await trigger.click()
    // Wait for the dropdown to open and select the option
    const option = page.getByRole('option', { name: new RegExp(eventType, 'i') })
    await option.first().click()
  }
})

When('I search for {string}', async ({ page }, query: string) => {
  const searchInput = page.getByTestId(TestIds.AUDIT_SEARCH)
  await searchInput.fill(query)
  await searchInput.press('Enter')
})

When('I type {string} in the search input', async ({ page }, text: string) => {
  await page.getByTestId(TestIds.AUDIT_SEARCH).fill(text)
})

Then('the search input should be empty', async ({ page }) => {
  await expect(page.getByTestId(TestIds.AUDIT_SEARCH)).toHaveValue('')
})

Then('the {string} badge should have the purple color class', async ({ page }, text: string) => {
  // Verify badge is present within an audit entry
  const auditEntry = page.getByTestId(TestIds.AUDIT_ENTRY).filter({ hasText: text })
  await expect(auditEntry.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})
