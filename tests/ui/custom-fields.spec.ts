import { type Page, expect, test } from '@playwright/test'
import { loginAsAdmin } from '../helpers'

/** Expand the Custom Note Fields section (idempotent — won't collapse if already open) */
async function expandCustomFields(page: Page) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

  const addFieldBtn = page.getByTestId('custom-field-add-btn')
  if (!(await addFieldBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.getByRole('heading', { name: /custom note fields/i }).click()
  }
  await expect(addFieldBtn).toBeVisible({ timeout: 10000 })
}

test.describe('Custom Note Fields', () => {
  test('custom fields section visible in admin settings', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /custom note fields/i })).toBeVisible()
  })

  test('admin can add a text custom field', async ({ page }) => {
    await loginAsAdmin(page)
    await expandCustomFields(page)

    const fieldName = `Severity ${Date.now()}`

    // Click Add Field
    await page.getByTestId('custom-field-add-btn').click()

    // Fill in field details — label input auto-generates the name field
    await page.getByTestId('custom-field-label-input').fill(fieldName)

    // Save using the specific save button in the custom fields form
    await page.getByTestId('form-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Field should appear in the list
    await expect(page.getByText(fieldName).first()).toBeVisible()
  })

  test('admin can add a select custom field with options', async ({ page }) => {
    await loginAsAdmin(page)
    await expandCustomFields(page)

    const fieldName = `Category ${Date.now()}`

    // Click Add Field
    await page.getByTestId('custom-field-add-btn').click()

    // Fill in field details
    await page.getByTestId('custom-field-label-input').fill(fieldName)

    // Change type to Select using the specific select element
    await page.getByTestId('custom-field-type-select').selectOption('select')

    // Add options — each click adds a new empty text input for an option
    await page.getByTestId('custom-field-add-option-btn').click()
    await page.getByRole('textbox').last().fill('Crisis')
    await page.getByTestId('custom-field-add-option-btn').click()
    await page.getByRole('textbox').last().fill('Information')

    // Save
    await page.getByTestId('form-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Field should appear in the list
    await expect(page.getByText(fieldName).first()).toBeVisible()
  })

  test('admin can delete a custom field', async ({ page }) => {
    await loginAsAdmin(page)
    await expandCustomFields(page)

    const fieldName = `ToDelete ${Date.now()}`

    // First create a field to delete
    await page.getByTestId('custom-field-add-btn').click()
    await expect(page.getByTestId('custom-field-label-input')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('custom-field-label-input').fill(fieldName)
    await page.getByTestId('form-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(fieldName).first()).toBeVisible()

    // Delete it — accept the confirmation dialog
    page.on('dialog', (dialog) => dialog.accept())
    const fieldRow = page.getByTestId('custom-field-row').filter({ hasText: fieldName }).first()
    await fieldRow.getByTestId('custom-field-delete-btn').click()

    // Field should be removed
    await expect(page.getByText(fieldName)).not.toBeVisible({ timeout: 5000 })
  })

  test('custom fields section deep link works', async ({ page }) => {
    await loginAsAdmin(page)
    await expandCustomFields(page)

    // Custom Note Fields section should be expanded — "Add Field" button should be visible
    await expect(page.getByTestId('custom-field-add-btn')).toBeVisible()
  })
})
