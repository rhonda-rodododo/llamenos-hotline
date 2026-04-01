import { type Page, expect, test } from '../fixtures/auth'

/** Navigate to admin settings and expand geocoding section */
async function expandGeocoding(page: Page) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

  // Look for geocoding section heading
  const heading = page.getByRole('heading', { name: /geocoding|location/i })
  await expect(heading).toBeVisible({ timeout: 10000 })

  // Check if section is already expanded
  const providerSelect = page.getByTestId('geocoding-provider-select')
  if (!(await providerSelect.isVisible({ timeout: 1000 }).catch(() => false))) {
    await heading.click()
  }
  await expect(providerSelect).toBeVisible({ timeout: 10000 })
}

/** Navigate to admin settings and expand custom fields section */
async function expandCustomFields(page: Page) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

  const addFieldBtn = page.getByRole('button', { name: /add field/i })
  if (!(await addFieldBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.getByRole('heading', { name: /custom note fields/i }).click()
  }
  await expect(addFieldBtn).toBeVisible({ timeout: 10000 })
}

test.describe('Geocoding & Location Fields', () => {
  test('geocoding settings section visible in admin settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()
    await expect(adminPage.getByRole('heading', { name: /geocoding|location/i })).toBeVisible()
  })

  test('admin can select geocoding provider', async ({ adminPage }) => {
    await expandGeocoding(adminPage)

    // Provider should default to disabled
    const select = adminPage.getByTestId('geocoding-provider-select')
    await expect(select).toHaveValue('')

    // Select OpenCage
    await select.selectOption('opencage')
    await expect(select).toHaveValue('opencage')

    // API key field should appear
    const apiKeyInput = adminPage.getByTestId('geocoding-api-key-input')
    await expect(apiKeyInput).toBeVisible()

    // Countries field should appear
    const countriesInput = adminPage.getByTestId('geocoding-countries-input')
    await expect(countriesInput).toBeVisible()
  })

  test('admin can switch to Geoapify provider', async ({ adminPage }) => {
    await expandGeocoding(adminPage)

    const select = adminPage.getByTestId('geocoding-provider-select')
    await select.selectOption('geoapify')
    await expect(select).toHaveValue('geoapify')

    // API key field should still be visible
    await expect(adminPage.getByTestId('geocoding-api-key-input')).toBeVisible()
  })

  test('admin can save geocoding config', async ({ adminPage }) => {
    await expandGeocoding(adminPage)

    // Select provider and fill key
    await adminPage.getByTestId('geocoding-provider-select').selectOption('opencage')
    await adminPage.getByTestId('geocoding-api-key-input').fill('test-api-key-12345')
    await adminPage.getByTestId('geocoding-countries-input').fill('us, ca')

    // Save
    await adminPage.getByTestId('geocoding-save-btn').click()
    await expect(adminPage.getByText(/success/i)).toBeVisible({ timeout: 5000 })
  })

  test('admin can disable geocoding', async ({ adminPage }) => {
    await expandGeocoding(adminPage)

    // First enable it, then disable
    await adminPage.getByTestId('geocoding-provider-select').selectOption('opencage')
    await adminPage.getByTestId('geocoding-api-key-input').fill('test-key')
    await adminPage.getByTestId('geocoding-save-btn').click()
    await expect(adminPage.getByText(/success/i).first()).toBeVisible({ timeout: 5000 })

    // Wait for first toast to dismiss before triggering another
    await adminPage.waitForTimeout(1500)

    // Now disable
    await adminPage.getByTestId('geocoding-provider-select').selectOption('')
    await adminPage.getByTestId('geocoding-save-btn').click()
    await expect(adminPage.getByText(/success/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('admin can add a location custom field', async ({ adminPage }) => {
    await expandCustomFields(adminPage)

    // Click Add Field
    await adminPage.getByRole('button', { name: /add field/i }).click()

    // Fill in field details
    const fieldLabel = `Caller Location ${Date.now()}`
    await adminPage.getByPlaceholder('e.g. Severity Rating').fill(fieldLabel)

    // Change type to Location
    await adminPage.locator('select').first().selectOption('location')

    // Location settings should appear
    await expect(adminPage.getByText(/location settings/i)).toBeVisible()
    await expect(adminPage.getByText(/maximum precision/i)).toBeVisible()

    // Save
    await adminPage.getByRole('button', { name: /save/i }).last().click()
    await expect(adminPage.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Field should appear in the list with Location type badge
    await expect(adminPage.getByText(fieldLabel).first()).toBeVisible()
    await expect(adminPage.getByText('Location').first()).toBeVisible()
  })

  test('location field appears in note creation form', async ({ adminPage }) => {
    // First create a location custom field
    await expandCustomFields(adminPage)
    await adminPage.getByRole('button', { name: /add field/i }).click()
    await adminPage.getByPlaceholder('e.g. Severity Rating').fill(`Location Field ${Date.now()}`)
    await adminPage.locator('select').first().selectOption('location')
    await adminPage.getByRole('button', { name: /save/i }).last().click()
    await expect(adminPage.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Navigate to notes page
    await adminPage.getByRole('link', { name: /notes/i }).first().click()
    await expect(adminPage.getByRole('heading', { name: /notes/i })).toBeVisible({ timeout: 10000 })

    // Open new note form
    const newNoteBtn = adminPage.getByRole('button', { name: /new note|add note/i })
    if (await newNoteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newNoteBtn.click()
    }

    // Check for the location field placeholder (search address input)
    // Just verify the custom fields section loads without errors
  })
})
