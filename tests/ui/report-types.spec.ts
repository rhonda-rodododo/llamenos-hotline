import { type Page, expect, test } from '@playwright/test'
import { loginAsAdmin, resetTestState } from '../helpers'

/** Navigate to admin hub settings and expand the Report Types section */
async function expandReportTypes(page: Page) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

  // Check if section is already expanded
  const addBtn = page.getByTestId('add-report-type-btn')
  const isVisible = await addBtn.isVisible({ timeout: 1000 }).catch(() => false)
  if (!isVisible) {
    await page.getByRole('heading', { name: /report types/i }).click()
  }
  await expect(addBtn).toBeVisible({ timeout: 10000 })
}

/** Navigate to Reports page */
async function navigateToReports(page: Page) {
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({ timeout: 10000 })
}

test.describe('Report Types System', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('report types section is visible in admin settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /report types/i })).toBeVisible()
  })

  test('admin can create a report type', async ({ page }) => {
    await expandReportTypes(page)

    // Click new report type button
    await page.getByTestId('add-report-type-btn').click()

    // Fill in the form
    await page.getByTestId('report-type-name-input').fill('Crisis Report')
    await page.getByTestId('report-type-description-input').fill('For immediate crisis situations')

    // Check the "set as default" toggle (it's already checked since no types exist)
    // Save the new type
    await page.getByTestId('report-type-save-btn').click()

    // Verify success and the type appears in the list
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Crisis Report').first()).toBeVisible()
  })

  test('created report type shows default badge', async ({ page }) => {
    await expandReportTypes(page)

    // The Crisis Report we created should show Default badge since it was the first
    const typeRow = page.getByTestId('report-type-row').filter({ hasText: 'Crisis Report' })
    await expect(typeRow).toBeVisible()
    await expect(typeRow.getByText('Default')).toBeVisible()
  })

  test('admin can create a second report type without default', async ({ page }) => {
    await expandReportTypes(page)

    await page.getByTestId('add-report-type-btn').click()
    await page.getByTestId('report-type-name-input').fill('Support Request')
    await page.getByTestId('report-type-description-input').fill('For general support requests')

    // Make sure "Set as default" is unchecked
    const defaultSwitch = page.getByRole('switch')
    if (await defaultSwitch.isChecked()) {
      await defaultSwitch.click()
    }

    await page.getByTestId('report-type-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Support Request').first()).toBeVisible()
  })

  test('admin can set a different type as default', async ({ page }) => {
    await expandReportTypes(page)

    // Find Support Request row and set as default
    const supportRow = page.getByTestId('report-type-row').filter({ hasText: 'Support Request' })
    await expect(supportRow).toBeVisible()
    await supportRow.getByTestId('set-default-btn').click()

    // Support Request should now have the Default badge
    await expect(supportRow.getByText('Default')).toBeVisible({ timeout: 5000 })

    // Crisis Report should no longer have Default badge
    const crisisRow = page.getByTestId('report-type-row').filter({ hasText: 'Crisis Report' })
    await expect(crisisRow.getByText('Default')).not.toBeVisible()
  })

  test('admin can archive a report type', async ({ page }) => {
    await expandReportTypes(page)

    // Archive "Support Request" (which is default — archiving should remove default)
    const supportRow = page.getByTestId('report-type-row').filter({ hasText: 'Support Request' })
    await expect(supportRow).toBeVisible()

    // Reset default back to Crisis Report first
    const crisisRow = page.getByTestId('report-type-row').filter({ hasText: 'Crisis Report' })
    await crisisRow.getByTestId('set-default-btn').click()
    await expect(crisisRow.getByText('Default')).toBeVisible({ timeout: 5000 })

    // Now archive Support Request
    page.once('dialog', (dialog) => dialog.accept())
    await supportRow.getByTestId('archive-report-type-btn').click()

    // Support Request should disappear from active list
    await expect(supportRow).not.toBeVisible({ timeout: 5000 })
  })

  test('archived report type can be shown and unarchived', async ({ page }) => {
    await expandReportTypes(page)

    // Show archived section
    await page.getByRole('button', { name: /show archived/i }).click()
    await expect(page.getByTestId('report-type-row').filter({ hasText: 'Support Request' })).toBeVisible()

    // Unarchive it
    await page.getByTestId('unarchive-report-type-btn').click()
    await expect(page.getByText('Support Request').first()).toBeVisible({ timeout: 5000 })
  })

  test('report form shows report type dropdown when types exist', async ({ page }) => {
    await navigateToReports(page)

    // Open new report form
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible({ timeout: 5000 })

    // Report type dropdown should be visible
    await expect(page.getByTestId('report-type-select')).toBeVisible()
    await expect(page.getByTestId('report-type-label')).toBeVisible()
  })

  test('default type is pre-selected in report form', async ({ page }) => {
    await navigateToReports(page)
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // The select should show "Crisis Report" since it's the default
    await expect(page.getByTestId('report-type-select')).toContainText('Crisis Report')
  })

  test('can change report type in form', async ({ page }) => {
    await navigateToReports(page)
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // Change to Support Request
    await page.getByTestId('report-type-select').click()
    await page.getByText('Support Request').click()
    await expect(page.getByTestId('report-type-select')).toContainText('Support Request')
  })

  test('archived type not shown in report form dropdown', async ({ page }) => {
    // First, archive Crisis Report
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expandReportTypes(page)

    const crisisRow = page.getByTestId('report-type-row').filter({ hasText: 'Crisis Report' })
    // Set Support Request as default so we can archive Crisis Report
    const supportRow = page.getByTestId('report-type-row').filter({ hasText: 'Support Request' })
    await supportRow.getByTestId('set-default-btn').click()
    await expect(supportRow.getByText('Default')).toBeVisible({ timeout: 5000 })

    page.once('dialog', (dialog) => dialog.accept())
    await crisisRow.getByTestId('archive-report-type-btn').click()
    await expect(crisisRow).not.toBeVisible({ timeout: 5000 })

    // Now open report form and verify Crisis Report is not in the dropdown
    await navigateToReports(page)
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // Open the dropdown and verify Crisis Report is not there
    await page.getByTestId('report-type-select').click()
    await expect(page.getByText('Crisis Report')).not.toBeVisible()
  })
})
