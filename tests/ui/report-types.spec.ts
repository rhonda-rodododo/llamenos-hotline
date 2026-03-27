import { type Page, expect, test } from '@playwright/test'
import { loginAsAdmin } from '../helpers'

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
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
    timeout: 10000,
  })
}

/** Create a report type via the UI. Returns after success toast is visible. */
async function createReportType(
  page: Page,
  name: string,
  description: string,
  setAsDefault = true
) {
  await page.getByTestId('add-report-type-btn').click()
  await page.getByTestId('report-type-name-input').fill(name)
  await page.getByTestId('report-type-description-input').fill(description)

  const defaultSwitch = page.getByTestId('report-type-default-switch')
  await expect(defaultSwitch).toBeVisible({ timeout: 5000 })
  const isChecked = await defaultSwitch.isChecked()
  if (setAsDefault && !isChecked) {
    await defaultSwitch.click()
  } else if (!setAsDefault && isChecked) {
    await defaultSwitch.click()
  }

  await page.getByTestId('report-type-save-btn').click()
  await expect(page.getByText(/success/i).last()).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(name).first()).toBeVisible()
}

test.describe('Report Types System', () => {
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

    const typeName = `Crisis Report ${Date.now()}`
    await page.getByTestId('add-report-type-btn').click()
    await page.getByTestId('report-type-name-input').fill(typeName)
    await page.getByTestId('report-type-description-input').fill('For immediate crisis situations')
    await page.getByTestId('report-type-save-btn').click()

    await expect(page.getByText(/success/i).last()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(typeName).first()).toBeVisible()
  })

  test('created report type shows default badge', async ({ page }) => {
    await expandReportTypes(page)

    const typeName = `Badge Test ${Date.now()}`
    await createReportType(page, typeName, 'Badge visibility test', true)

    const typeRow = page.getByTestId('report-type-row').filter({ hasText: typeName })
    await expect(typeRow).toBeVisible()
    await expect(typeRow.getByText('Default', { exact: true })).toBeVisible()
  })

  test('admin can create a second report type without default', async ({ page }) => {
    await expandReportTypes(page)

    const suffix = Date.now()
    // Create first type (will be default)
    await createReportType(page, `First Type ${suffix}`, 'First type', true)

    // Create second type without default
    const secondName = `Second Type ${suffix}`
    await createReportType(page, secondName, 'For general support requests', false)

    await expect(page.getByText(secondName).first()).toBeVisible()
  })

  test('admin can set a different type as default', async ({ page }) => {
    await expandReportTypes(page)

    const suffix = Date.now()
    const firstName = `Crisis ${suffix}`
    const secondName = `Support ${suffix}`

    // Create two types - first is default
    await createReportType(page, firstName, 'Crisis type', true)
    await createReportType(page, secondName, 'Support type', false)

    // Set second as default
    const supportRow = page.getByTestId('report-type-row').filter({ hasText: secondName })
    await expect(supportRow).toBeVisible()
    await supportRow.getByTestId('set-default-btn').click()

    // Support should now have Default badge
    await expect(supportRow.getByText('Default', { exact: true })).toBeVisible({ timeout: 5000 })

    // Crisis should no longer have Default badge
    const crisisRow = page.getByTestId('report-type-row').filter({ hasText: firstName })
    await expect(crisisRow.getByText('Default', { exact: true })).not.toBeVisible()
  })

  test('admin can archive a report type', async ({ page }) => {
    await expandReportTypes(page)

    const suffix = Date.now()
    const defaultName = `Default ${suffix}`
    const archiveName = `ToArchive ${suffix}`

    // Create default type, then one to archive
    await createReportType(page, defaultName, 'Default', true)
    await createReportType(page, archiveName, 'Will be archived', false)

    // Archive the second type
    const archiveRow = page.getByTestId('report-type-row').filter({ hasText: archiveName })
    await expect(archiveRow).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await archiveRow.getByTestId('archive-report-type-btn').click()

    // Should disappear from active list
    await expect(archiveRow).not.toBeVisible({ timeout: 5000 })
  })

  test('archived report type can be shown and unarchived', async ({ page }) => {
    await expandReportTypes(page)

    const suffix = Date.now()
    const defaultName = `Default ${suffix}`
    const archiveName = `Archived ${suffix}`

    // Create two types, archive the second
    await createReportType(page, defaultName, 'Default', true)
    await createReportType(page, archiveName, 'Will be archived then unarchived', false)

    const archiveRow = page.getByTestId('report-type-row').filter({ hasText: archiveName })
    page.once('dialog', (dialog) => dialog.accept())
    await archiveRow.getByTestId('archive-report-type-btn').click()
    await expect(archiveRow).not.toBeVisible({ timeout: 5000 })

    // Show archived section
    await page.getByRole('button', { name: /show archived/i }).click()
    const archivedRow = page.getByTestId('report-type-row').filter({ hasText: archiveName })
    await expect(archivedRow).toBeVisible({ timeout: 10000 })

    // Unarchive it — scope to the specific row to avoid strict mode with parallel tests
    await archivedRow.getByTestId('unarchive-report-type-btn').click()
    await expect(page.getByText(archiveName).first()).toBeVisible({ timeout: 10000 })
  })

  test('report form shows report type dropdown when types exist', async ({ page }) => {
    // Create a report type first
    await expandReportTypes(page)
    const typeName = `FormType ${Date.now()}`
    await createReportType(page, typeName, 'For form test', true)

    await navigateToReports(page)

    // Open new report form
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 10000,
    })

    // Report type dropdown should be visible (CI may need time to fetch types)
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('report-type-label')).toBeVisible({ timeout: 5000 })
  })

  test('default type is pre-selected in report form', async ({ page }) => {
    await expandReportTypes(page)
    const typeName = `DefaultSelect ${Date.now()}`
    await createReportType(page, typeName, 'Default select test', true)

    await navigateToReports(page)
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // The select should show the default type
    await expect(page.getByTestId('report-type-select')).toContainText(typeName)
  })

  test('can change report type in form', async ({ page }) => {
    await expandReportTypes(page)
    const suffix = Date.now()
    const defaultName = `Default ${suffix}`
    const otherName = `Other ${suffix}`
    await createReportType(page, defaultName, 'Default', true)
    await createReportType(page, otherName, 'Other option', false)

    await navigateToReports(page)
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // Change to the other type
    await page.getByTestId('report-type-select').click()
    await page.getByText(otherName).click()
    await expect(page.getByTestId('report-type-select')).toContainText(otherName)
  })

  test('archived type not shown in report form dropdown', async ({ page }) => {
    await expandReportTypes(page)

    const suffix = Date.now()
    const keepName = `Keep ${suffix}`
    const archName = `ArchDrop ${suffix}`

    // Create two types
    await createReportType(page, keepName, 'Will stay active', true)
    await createReportType(page, archName, 'Will be archived', false)

    // Archive the second type
    const archRow = page.getByTestId('report-type-row').filter({ hasText: archName })
    page.once('dialog', (dialog) => dialog.accept())
    await archRow.getByTestId('archive-report-type-btn').click()
    await expect(archRow).not.toBeVisible({ timeout: 5000 })

    // Open report form and verify archived type is not in dropdown
    await navigateToReports(page)
    await page.getByRole('button', { name: /new/i }).click()
    await expect(page.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // Open the dropdown and verify archived type is not there
    await page.getByTestId('report-type-select').click()
    await expect(page.getByText(archName)).not.toBeVisible()
  })
})
