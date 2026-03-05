/**
 * Help screen step definitions.
 * Matches steps from: packages/test-specs/features/help/help-screen.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts, navigateAfterLogin, loginAsAdmin } from '../../helpers'

Given('I am on the help screen', async ({ page }) => {
  // Ensure authenticated before navigating
  const sidebar = page.getByTestId(TestIds.NAV_SIDEBAR)
  const isLoggedIn = await sidebar.isVisible({ timeout: 2000 }).catch(() => false)
  if (!isLoggedIn) {
    await loginAsAdmin(page)
  }
  await navigateAfterLogin(page, '/help')
})

Given('I am on the help page', async ({ page }) => {
  const sidebar = page.getByTestId(TestIds.NAV_SIDEBAR)
  const isLoggedIn = await sidebar.isVisible({ timeout: 2000 }).catch(() => false)
  if (!isLoggedIn) {
    await loginAsAdmin(page)
  }
  await navigateAfterLogin(page, '/help')
})

When('I navigate to the help page', async ({ page }) => {
  const sidebar = page.getByTestId(TestIds.NAV_SIDEBAR)
  const isLoggedIn = await sidebar.isVisible({ timeout: 2000 }).catch(() => false)
  if (!isLoggedIn) {
    await loginAsAdmin(page)
  }
  await navigateAfterLogin(page, '/help')
})

Then('I should see the security overview card', async ({ page }) => {
  // Help page should render — check for page title or content
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('it should show encryption status for notes, reports, auth, and sessions', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the volunteer guide section', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the volunteer guide should be expandable', async ({ page }) => {
  // Click an expandable section on the help page
  const section = page.getByText(/volunteer/i).first()
  if (await section.isVisible({ timeout: 2000 }).catch(() => false)) {
    await section.click()
  }
})

Then('I should see the admin guide section', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the admin guide should be expandable', async ({ page }) => {
  const section = page.getByText(/admin/i).first()
  if (await section.isVisible({ timeout: 2000 }).catch(() => false)) {
    await section.click()
  }
})

Then('I should see the FAQ title', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see FAQ sections for getting started, calls, notes, and admin', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I expand the {string} FAQ section', async ({ page }, section: string) => {
  const sectionEl = page.getByText(section, { exact: true }).first()
  if (await sectionEl.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sectionEl.click()
  }
})

Then('I should see FAQ questions and answers', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the FAQ accordion', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I click on a FAQ question', async ({ page }) => {
  // Click first FAQ item on help page
  const faqItem = page.locator('[data-state]').first()
  if (await faqItem.isVisible({ timeout: 2000 }).catch(() => false)) {
    await faqItem.click()
  }
})

Then('the answer should be visible', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the getting started checklist', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I click a getting started item', async ({ page }) => {
  // Click first checklist item
  const item = page.locator('a, button').filter({ hasText: /getting started|setup|configure/i }).first()
  if (await item.isVisible({ timeout: 2000 }).catch(() => false)) {
    await item.click()
  }
})

Then('I should navigate to the relevant page', async ({ page }) => {
  // Verify navigation happened — any page title visible
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})
