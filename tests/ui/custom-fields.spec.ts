import { type Page, expect, test } from '../fixtures/auth'

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
  test('custom fields section visible in admin settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()
    await expect(adminPage.getByRole('heading', { name: /custom note fields/i })).toBeVisible()
  })

  test('admin can add a text custom field', async ({ adminPage }) => {
    await expandCustomFields(adminPage)

    const fieldName = `Severity ${Date.now()}`

    // Click Add Field
    await adminPage.getByTestId('custom-field-add-btn').click()

    // Fill in field details — label input auto-generates the name field
    await adminPage.getByTestId('custom-field-label-input').fill(fieldName)

    // Save using the specific save button in the custom fields form
    await adminPage.getByTestId('form-save-btn').click()
    await expect(adminPage.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Field should appear in the list
    await expect(adminPage.getByText(fieldName).first()).toBeVisible()
  })

  test('admin can add a select custom field with options', async ({ adminPage }) => {
    await expandCustomFields(adminPage)

    const fieldName = `Category ${Date.now()}`

    // Click Add Field
    await adminPage.getByTestId('custom-field-add-btn').click()

    // Fill in field details
    await adminPage.getByTestId('custom-field-label-input').fill(fieldName)

    // Change type to Select using the specific select element
    await adminPage.getByTestId('custom-field-type-select').selectOption('select')

    // Add options — each click adds a new empty text input for an option
    await adminPage.getByTestId('custom-field-add-option-btn').click()
    await adminPage.getByRole('textbox').last().fill('Crisis')
    await adminPage.getByTestId('custom-field-add-option-btn').click()
    await adminPage.getByRole('textbox').last().fill('Information')

    // Save
    await adminPage.getByTestId('form-save-btn').click()
    await expect(adminPage.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Field should appear in the list
    await expect(adminPage.getByText(fieldName).first()).toBeVisible()
  })

  test('admin can delete a custom field', async ({ adminPage }) => {
    await expandCustomFields(adminPage)

    const fieldName = `ToDelete ${Date.now()}`

    // First create a field to delete
    await adminPage.getByTestId('custom-field-add-btn').click()
    await expect(adminPage.getByTestId('custom-field-label-input')).toBeVisible({ timeout: 10000 })
    await adminPage.getByTestId('custom-field-label-input').fill(fieldName)
    await adminPage.getByTestId('form-save-btn').click()
    await expect(adminPage.getByText(/success/i)).toBeVisible({ timeout: 5000 })
    await expect(adminPage.getByText(fieldName).first()).toBeVisible()

    // Delete it — accept the confirmation dialog
    adminPage.on('dialog', (dialog) => dialog.accept())
    const fieldRow = adminPage
      .getByTestId('custom-field-row')
      .filter({ hasText: fieldName })
      .first()
    await fieldRow.getByTestId('custom-field-delete-btn').click()

    // Field should be removed
    await expect(adminPage.getByText(fieldName)).not.toBeVisible({ timeout: 5000 })
  })

  test('custom fields section deep link works', async ({ adminPage }) => {
    await expandCustomFields(adminPage)

    // Custom Note Fields section should be expanded — "Add Field" button should be visible
    await expect(adminPage.getByTestId('custom-field-add-btn')).toBeVisible()
  })
})
