import { type Page, expect, test } from '@playwright/test'
import { loginAsAdmin } from '../helpers'

/**
 * End-to-end: custom fields defined in admin settings → used in notes forms.
 * Tests the full lifecycle: create field → create note with field value →
 * verify badge display → edit note → verify pre-fill → update value.
 */

/** Create a text custom field via admin settings UI */
async function createCustomTextField(page: Page, label: string) {
  await page.getByRole('link', { name: 'Hub Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

  // Expand section (idempotent — won't collapse if already open via sessionStorage)
  const addFieldBtn = page.getByRole('button', { name: /add field/i })
  if (!(await addFieldBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
    await page.getByRole('heading', { name: /custom note fields/i }).click()
  }
  await expect(addFieldBtn).toBeVisible({ timeout: 10000 })

  // If a field with this label already exists, skip creation
  const existing = page.locator('.rounded-lg.border').filter({ hasText: label })
  if (
    await existing
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    return
  }

  await addFieldBtn.click()
  await page.getByPlaceholder('e.g. Severity Rating').fill(label)
  await page.getByRole('button', { name: /save/i }).last().click()
  await expect(page.getByText(/success/i)).toBeVisible({ timeout: 10000 })
}

/** Create a note with a custom field value and return the note text for identification */
async function createNoteWithCustomField(
  page: Page,
  fieldLabel: string,
  fieldValue: string,
  noteText: string
) {
  await page.getByRole('link', { name: 'Notes' }).click()
  await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

  await page.getByRole('button', { name: /new note/i }).click()
  await page.locator('#call-id').fill(`cf-test-${Date.now()}`)
  await page.locator('textarea').first().fill(noteText)
  await page.getByLabel(fieldLabel).fill(fieldValue)
  await page.getByRole('button', { name: /save/i }).click()

  // Wait for note to appear
  await expect(page.locator('p').filter({ hasText: noteText })).toBeVisible()
}

test.describe('Custom Fields in Notes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('custom fields appear in new note form', async ({ page }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(page, fieldLabel)

    // Navigate to notes
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

    // Open new note form
    await page.getByRole('button', { name: /new note/i }).click()

    // Custom field label should appear in the form
    await expect(page.getByLabel(fieldLabel)).toBeVisible()
  })

  test('create note with custom field value shows badge', async ({ page }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(page, fieldLabel)

    const noteText = `Note with ${fieldLabel}`
    await createNoteWithCustomField(page, fieldLabel, 'High', noteText)

    // Custom field value should appear as a badge
    await expect(page.getByText(`${fieldLabel}: High`)).toBeVisible()
  })

  test('edit form shows custom fields pre-filled', async ({ page }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(page, fieldLabel)

    const noteText = `Prefill test ${Date.now()}`
    await createNoteWithCustomField(page, fieldLabel, 'High', noteText)

    // Click edit on the note
    const noteCard = page.locator('.py-4').filter({ hasText: noteText }).first()
    await noteCard.locator('button[aria-label="Edit"]').click()

    // The custom field input should be pre-filled
    const fieldInput = page.getByLabel(fieldLabel)
    await expect(fieldInput).toBeVisible()
    await expect(fieldInput).toHaveValue('High', { timeout: 10000 })
  })

  test('can update custom field value via edit', async ({ page }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(page, fieldLabel)

    const noteText = `Update test ${Date.now()}`
    await createNoteWithCustomField(page, fieldLabel, 'High', noteText)

    // Click edit on the specific note
    const noteCard = page.locator('.py-4').filter({ hasText: noteText }).first()
    await noteCard.locator('button[aria-label="Edit"]').click()

    // Change the field value
    const fieldInput = page.getByLabel(fieldLabel)
    await fieldInput.clear()
    await fieldInput.fill('Critical')

    // Save
    await page.getByRole('button', { name: /save/i }).click()

    // Badge should show updated value on the edited note
    await expect(noteCard.getByText(`${fieldLabel}: Critical`)).toBeVisible()
    await expect(noteCard.getByText(`${fieldLabel}: High`)).not.toBeVisible()
  })

  test('edit preserves note text when changing field value', async ({ page }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(page, fieldLabel)

    const noteText = `Preserve test ${Date.now()}`
    await createNoteWithCustomField(page, fieldLabel, 'High', noteText)

    // Click edit on the specific note
    const noteCard = page.locator('.py-4').filter({ hasText: noteText }).first()
    await noteCard.locator('button[aria-label="Edit"]').click()

    // Verify textarea has existing text
    const textarea = page.locator('textarea').first()
    await expect(textarea).toHaveValue(noteText)

    // Change field value without changing text
    const fieldInput = page.getByLabel(fieldLabel)
    await fieldInput.clear()
    await fieldInput.fill('Low')
    await page.getByRole('button', { name: /save/i }).click()

    // Both text and field should be preserved on the specific note
    await expect(noteCard.getByText(noteText)).toBeVisible()
    await expect(noteCard.getByText(`${fieldLabel}: Low`)).toBeVisible()
  })
})

test.describe('Notes Call Headers', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('note card shows call ID in header (fallback)', async ({ page }) => {
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

    // Create a note with a known call ID
    const callId = `header-test-${Date.now()}`
    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').first().fill('Header test note')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Header test note' })).toBeVisible()

    // Card header should show truncated call ID (fallback when call not in history)
    // The format is "Call with <first 12 chars>..."
    await expect(page.getByText(`Call with ${callId.slice(0, 12)}...`)).toBeVisible()
  })

  test('notes grouped under same call share one header', async ({ page }) => {
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

    const callId = `group-header-${Date.now()}`

    // Create first note
    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').first().fill('First grouped note')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'First grouped note' })).toBeVisible()

    // Create second note for same call
    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').first().fill('Second grouped note')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Second grouped note' })).toBeVisible()

    // Both notes should be visible under one card
    const headerText = `Call with ${callId.slice(0, 12)}...`
    const headers = page.getByText(headerText)
    await expect(headers).toHaveCount(1) // Only one header for the group
  })

  test('edit saves updated text correctly', async ({ page }) => {
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

    // Create a note to edit
    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill(`edit-save-${Date.now()}`)
    await page.locator('textarea').first().fill('Original content')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Original content' })).toBeVisible()

    // Edit the note
    await page.locator('button[aria-label="Edit"]').first().click()
    const editTextarea = page.locator('textarea').first()
    await editTextarea.clear()
    await editTextarea.fill('Updated content')
    await page.getByRole('button', { name: /save/i }).click()

    // Original text gone, updated text visible
    await expect(page.locator('p').filter({ hasText: 'Updated content' })).toBeVisible()
    await expect(page.locator('p').filter({ hasText: 'Original content' })).not.toBeVisible()
  })
})
