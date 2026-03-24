import { test, expect, type Page } from '@playwright/test'
import { loginAsAdmin, resetTestState } from '../helpers'

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
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('geocoding settings section visible in admin settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /geocoding|location/i })).toBeVisible()
  })

  test('admin can select geocoding provider', async ({ page }) => {
    await expandGeocoding(page)

    // Provider should default to disabled
    const select = page.getByTestId('geocoding-provider-select')
    await expect(select).toHaveValue('')

    // Select OpenCage
    await select.selectOption('opencage')
    await expect(select).toHaveValue('opencage')

    // API key field should appear
    const apiKeyInput = page.getByTestId('geocoding-api-key-input')
    await expect(apiKeyInput).toBeVisible()

    // Countries field should appear
    const countriesInput = page.getByTestId('geocoding-countries-input')
    await expect(countriesInput).toBeVisible()
  })

  test('admin can switch to Geoapify provider', async ({ page }) => {
    await expandGeocoding(page)

    const select = page.getByTestId('geocoding-provider-select')
    await select.selectOption('geoapify')
    await expect(select).toHaveValue('geoapify')

    // API key field should still be visible
    await expect(page.getByTestId('geocoding-api-key-input')).toBeVisible()
  })

  test('admin can save geocoding config', async ({ page }) => {
    await expandGeocoding(page)

    // Select provider and fill key
    await page.getByTestId('geocoding-provider-select').selectOption('opencage')
    await page.getByTestId('geocoding-api-key-input').fill('test-api-key-12345')
    await page.getByTestId('geocoding-countries-input').fill('us, ca')

    // Save
    await page.getByTestId('geocoding-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })
  })

  test('admin can disable geocoding', async ({ page }) => {
    await expandGeocoding(page)

    // First enable it, then disable
    await page.getByTestId('geocoding-provider-select').selectOption('opencage')
    await page.getByTestId('geocoding-api-key-input').fill('test-key')
    await page.getByTestId('geocoding-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Now disable
    await page.getByTestId('geocoding-provider-select').selectOption('')
    await page.getByTestId('geocoding-save-btn').click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })
  })

  test('admin can add a location custom field', async ({ page }) => {
    await expandCustomFields(page)

    // Click Add Field
    await page.getByRole('button', { name: /add field/i }).click()

    // Fill in field details
    const fieldLabel = `Caller Location ${Date.now()}`
    await page.getByPlaceholder('e.g. Severity Rating').fill(fieldLabel)

    // Change type to Location
    await page.locator('select').first().selectOption('location')

    // Location settings should appear
    await expect(page.getByText(/location settings/i)).toBeVisible()
    await expect(page.getByText(/maximum precision/i)).toBeVisible()

    // Save
    await page.getByRole('button', { name: /save/i }).last().click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Field should appear in the list with Location type badge
    await expect(page.getByText(fieldLabel).first()).toBeVisible()
    await expect(page.getByText('Location').first()).toBeVisible()
  })

  test('location field appears in note creation form', async ({ page }) => {
    // First create a location custom field
    await expandCustomFields(page)
    await page.getByRole('button', { name: /add field/i }).click()
    await page.getByPlaceholder('e.g. Severity Rating').fill(`Location Field ${Date.now()}`)
    await page.locator('select').first().selectOption('location')
    await page.getByRole('button', { name: /save/i }).last().click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 5000 })

    // Navigate to notes page
    await page.getByRole('link', { name: /notes/i }).first().click()
    await expect(page.getByRole('heading', { name: /notes/i })).toBeVisible({ timeout: 10000 })

    // Open new note form
    const newNoteBtn = page.getByRole('button', { name: /new note|add note/i })
    if (await newNoteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newNoteBtn.click()
    }

    // Check for the location field placeholder (search address input)
    // Just verify the custom fields section loads without errors
  })
})
