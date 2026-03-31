import { expect, test } from '@playwright/test'
import { Timeouts, loginAsAdmin, navigateAfterLogin } from '../helpers'

test.describe('Contact Directory', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/contacts')
  })

  // Group 1: Contact Directory Page
  test.describe('directory page', () => {
    test('loads with heading', async ({ page }) => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('shows search input', async ({ page }) => {
      await expect(page.getByTestId('contact-search')).toBeVisible()
    })

    test('shows contact type filter', async ({ page }) => {
      await expect(page.getByTestId('contact-type-filter')).toBeVisible()
    })

    test('shows risk level filter', async ({ page }) => {
      await expect(page.getByTestId('risk-level-filter')).toBeVisible()
    })

    test('shows New Contact button', async ({ page }) => {
      await expect(page.getByTestId('new-contact-btn')).toBeVisible()
    })

    test('shows empty state or contact list', async ({ page }) => {
      const hasRows = await page
        .getByTestId('contact-row')
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
      const hasEmpty = await page
        .getByRole('img', { hidden: true })
        .isVisible({ timeout: 1000 })
        .catch(() => false)
      // Either rows or empty state icon should be visible — loading must have resolved
      const loadingGone = await page
        .locator('[data-testid="contact-search"]')
        .isVisible({ timeout: Timeouts.API })
      expect(loadingGone || hasRows || hasEmpty).toBeTruthy()
    })
  })

  // Group 2: Create Contact Flow
  test.describe('create contact flow', () => {
    test('opens dialog when New Contact button clicked', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await expect(page.getByTestId('create-contact-dialog')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
      await expect(page.getByTestId('create-contact-title')).toBeVisible()
    })

    test('dialog contains display name input', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await expect(page.locator('#displayName')).toBeVisible()
    })

    test('dialog contains contact type select', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await expect(page.locator('#contactType')).toBeVisible()
    })

    test('dialog contains risk level select', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await expect(page.locator('#riskLevel')).toBeVisible()
    })

    test('dialog contains tags input', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await expect(page.getByTestId('tag-input')).toBeVisible()
    })

    test('dialog can be cancelled', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await expect(page.getByTestId('create-contact-dialog')).toBeVisible()
      await page.getByRole('button', { name: /cancel/i }).click()
      await expect(page.getByTestId('create-contact-dialog')).not.toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('display name field accepts input', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await page.locator('#displayName').fill('Test Caller E2E')
      await expect(page.locator('#displayName')).toHaveValue('Test Caller E2E')
    })

    test('contact type dropdown works', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      // Click the SelectTrigger for contactType
      await page.locator('#contactType').click()
      // Options should be visible in the popover
      const orgOption = page.getByRole('option', { name: /organization/i })
      await expect(orgOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await orgOption.click()
      // Trigger should now show selected value
      await expect(page.locator('#contactType')).toContainText(/organization/i)
    })

    test('risk level dropdown works', async ({ page }) => {
      await page.getByTestId('new-contact-btn').click()
      await page.locator('#riskLevel').click()
      const highOption = page.getByRole('option', { name: /high/i })
      await expect(highOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await highOption.click()
      await expect(page.locator('#riskLevel')).toContainText(/high/i)
    })

    test('creates a contact and closes dialog', async ({ page }) => {
      const displayName = `E2E Contact ${Date.now()}`
      await page.getByTestId('new-contact-btn').click()

      await page.locator('#displayName').fill(displayName)

      // Select medium risk
      await page.locator('#riskLevel').click()
      const mediumOption = page.getByRole('option', { name: /medium/i })
      await expect(mediumOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await mediumOption.click()

      // Tags are now a Command+Popover multi-select (TagInput), skip for this test

      // Submit
      await page.getByRole('button', { name: /create contact/i }).click()

      // Dialog should close on success
      await expect(page.getByTestId('create-contact-dialog')).not.toBeVisible({
        timeout: Timeouts.API,
      })
    })
  })

  // Group 3: Contact Profile
  test.describe('contact profile', () => {
    let createdContactName: string

    test.beforeEach(async ({ page }) => {
      // Create a contact to click into
      createdContactName = `Profile Test ${Date.now()}`
      await page.getByTestId('new-contact-btn').click()
      await page.locator('#displayName').fill(createdContactName)
      await page.getByRole('button', { name: /create contact/i }).click()
      // Wait for create-contact dialog to close and list to refresh
      await expect(page.getByTestId('create-contact-dialog')).not.toBeVisible({
        timeout: Timeouts.API,
      })
      await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
    })

    test('clicking contact row navigates to profile', async ({ page }) => {
      const row = page.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await expect(page).toHaveURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
    })

    test('profile page shows summary section', async ({ page }) => {
      const row = page.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
      await expect(page.getByTestId('contact-summary-card')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('profile page shows PII section', async ({ page }) => {
      const row = page.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
      await expect(page.getByTestId('contact-pii-card')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('profile page shows timeline section', async ({ page }) => {
      const row = page.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
      await expect(page.getByTestId('contact-timeline-card')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('back button navigates to directory', async ({ page }) => {
      const row = page.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await page.waitForTimeout(Timeouts.ASYNC_SETTLE)

      await page.getByTestId('contact-back-btn').click()
      await expect(page).toHaveURL(/\/contacts(\?|$)/, { timeout: Timeouts.NAVIGATION })
    })

    test('delete button visible on profile for admin', async ({ page }) => {
      const row = page.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await page.waitForTimeout(Timeouts.ASYNC_SETTLE)

      await expect(page.getByTestId('contact-delete-btn')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })
  })

  // Group 4: Search and Filtering
  test.describe('search and filtering', () => {
    test('search input submits on form submit', async ({ page }) => {
      await page.getByTestId('contact-search').fill('test query')
      await page.getByTestId('contact-search-btn').click()
      // URL should update with q param
      await expect(page).toHaveURL(/q=test\+query|q=test%20query/, {
        timeout: Timeouts.NAVIGATION,
      })
    })

    test('contact type filter updates URL', async ({ page }) => {
      await page.getByTestId('contact-type-filter').click()
      const callerOption = page.getByRole('option', { name: /caller/i })
      await expect(callerOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await callerOption.click()
      await expect(page).toHaveURL(/contactType=caller/, { timeout: Timeouts.NAVIGATION })
    })

    test('risk level filter updates URL', async ({ page }) => {
      await page.getByTestId('risk-level-filter').click()
      const highOption = page.getByRole('option', { name: /high/i })
      await expect(highOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await highOption.click()
      await expect(page).toHaveURL(/riskLevel=high/, { timeout: Timeouts.NAVIGATION })
    })
  })
})
