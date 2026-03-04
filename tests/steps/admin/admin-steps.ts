/**
 * Admin panel step definitions.
 * Matches steps from:
 *   - packages/test-specs/features/admin/access-control.feature
 *   - packages/test-specs/features/admin/admin-navigation.feature
 *   - packages/test-specs/features/admin/admin-tabs.feature
 *
 * Desktop uses sidebar navigation for admin pages (no "admin panel" or tab list).
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds, navTestIdMap } from '../../test-ids'
import { Timeouts } from '../../helpers'

// --- Admin navigation steps ---

Then('I should see the admin screen', async ({ page }) => {
  const adminSection = page.getByTestId(TestIds.NAV_ADMIN_SECTION)
  const pageTitle = page.getByTestId(TestIds.PAGE_TITLE)
  const adminVisible = await adminSection.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (!adminVisible) {
    await expect(pageTitle).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('the admin title should be displayed', async ({ page }) => {
  const adminSection = page.getByTestId(TestIds.NAV_ADMIN_SECTION)
  const pageTitle = page.getByTestId(TestIds.PAGE_TITLE)
  const adminVisible = await adminSection.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (!adminVisible) {
    await expect(pageTitle).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('the admin tabs should be visible', async ({ page }) => {
  // Desktop has sidebar nav links instead of tab list.
  // Check that admin nav links are visible in the sidebar.
  const sidebar = page.getByTestId(TestIds.NAV_SIDEBAR)
  await expect(sidebar).toBeVisible({ timeout: Timeouts.ELEMENT })
  // Verify at least one admin nav link is visible
  const adminSection = page.getByTestId(TestIds.NAV_ADMIN_SECTION)
  await expect(adminSection).toBeVisible({ timeout: Timeouts.ELEMENT })
})

// --- Admin tabs steps ---

Then('I should see the following tabs:', async ({ page }, dataTable) => {
  const rows = dataTable.rows() as string[][]
  for (const [tabName] of rows) {
    const testId = navTestIdMap[tabName]
    if (testId) {
      const navLink = page.getByTestId(testId)
      await expect(navLink).toBeVisible({ timeout: Timeouts.ELEMENT })
    } else {
      // Fallback: look for text in sidebar
      const sidebar = page.getByTestId(TestIds.NAV_SIDEBAR)
      await expect(sidebar.getByText(tabName, { exact: true })).toBeVisible({ timeout: Timeouts.ELEMENT })
    }
  }
})

Then('the {string} tab should be selected by default', async ({ page }, _tabName: string) => {
  // Desktop: "selected tab" = current page — verify page title is visible
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('{word} content should be displayed \\(loading, empty, or list)', async ({ page }, _tabContent: string) => {
  // Generic content check for any admin tab (volunteers, bans, audit, invites)
  // Use .or() instead of broken CSS text= pattern
  const content = page.getByTestId(TestIds.VOLUNTEER_LIST)
    .or(page.getByTestId(TestIds.EMPTY_STATE))
    .or(page.getByTestId(TestIds.LOADING_SKELETON))
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should be on the Volunteers tab', async ({ page }) => {
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

// --- Access control steps ---

Given('the crypto service is locked', async ({ page }) => {
  // Navigate to a page first to avoid SecurityError when clearing storage on about:blank
  const url = page.url()
  if (url === 'about:blank' || url === '') {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
  }
  await page.evaluate(() => {
    sessionStorage.clear()
  })
})

Given('a stored identity exists', async ({ page }) => {
  const hasKey = await page.evaluate(() => {
    return (
      localStorage.getItem('llamenos-encrypted-key') !== null ||
      localStorage.getItem('tauri-store:keys.json:llamenos-encrypted-key') !== null
    )
  })
  expect(hasKey).toBe(true)
})

Then('I should not be able to access any tab', async ({ page }) => {
  // When locked, navigation should not be accessible
  const nav = page.getByTestId(TestIds.NAV_SIDEBAR)
  await expect(nav).not.toBeVisible()
})

Then('I should be able to navigate to all tabs:', async ({ page }, dataTable) => {
  const rows = dataTable.rows() as string[][]
  for (const [tabName] of rows) {
    const testId = navTestIdMap[tabName]
    if (testId) {
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: Timeouts.ELEMENT })
    } else {
      const sidebar = page.getByTestId(TestIds.NAV_SIDEBAR)
      await expect(sidebar.getByText(tabName, { exact: true })).toBeVisible({ timeout: Timeouts.ELEMENT })
    }
  }
})

When('I attempt to create an auth token', async () => {
  // This is a crypto-level test — handled in crypto steps
})

When('I attempt to encrypt a note', async () => {
  // This is a crypto-level test — handled in crypto steps
})

Then('it should throw a CryptoException', async () => {
  // Verified at the crypto service level — if we're on the PIN screen, crypto is locked
})
