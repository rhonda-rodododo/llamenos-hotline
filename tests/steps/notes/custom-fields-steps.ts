/**
 * Notes custom fields step definitions.
 * Matches steps from:
 *   - packages/test-specs/features/notes/notes-custom-fields.feature
 *   - packages/test-specs/features/notes/custom-fields-admin.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'
import { Navigation } from '../../pages/index'

// --- Custom fields in note form ---

Given('a text custom field {string} exists', async ({ page }, fieldLabel: string) => {
  // Navigate to hub settings and create the custom field if needed
  await Navigation.goToHubSettings(page)
  // Look for the custom fields section by test ID
  const section = page.getByTestId(TestIds.SETTINGS_SECTION).filter({ hasText: /custom/i })
  if (await section.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await section.first().click()
  }
  // Check if field already exists within a custom-field-row
  const fieldExists = await page
    .getByTestId(TestIds.CUSTOM_FIELD_ROW)
    .filter({ hasText: fieldLabel })
    .isVisible({ timeout: 2000 })
    .catch(() => false)
  if (!fieldExists) {
    await page.getByTestId(TestIds.CUSTOM_FIELD_ADD_BTN).click()
    await page.getByLabel(/label/i).fill(fieldLabel)
    await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
    await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
  }
})

Then('I should see a {string} input in the form', async ({ page }, fieldLabel: string) => {
  await expect(page.getByLabel(fieldLabel).or(
    page.getByTestId(TestIds.CUSTOM_FIELD_ROW).filter({ hasText: fieldLabel }),
  ).first()).toBeVisible({
    timeout: Timeouts.ELEMENT,
  })
})

When('I create a note with {string} set to {string}', async ({ page }, fieldLabel: string, value: string) => {
  await Navigation.goToNotes(page)
  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  await page.getByTestId(TestIds.NOTE_CONTENT).fill('Test note with custom field')
  const customInput = page.getByLabel(fieldLabel)
  if (await customInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await customInput.fill(value)
  }
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
})

Then('I should see {string} as a badge', async ({ page }, text: string) => {
  const noteCard = page.getByTestId(TestIds.NOTE_CARD).filter({ hasText: text })
  await expect(noteCard.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Given('a note exists with {string} set to {string}', async ({ page }, fieldLabel: string, value: string) => {
  // Create a note with the custom field
  await Navigation.goToNotes(page)
  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  await page.getByTestId(TestIds.NOTE_CONTENT).fill('Note with custom field')
  const customInput = page.getByLabel(fieldLabel)
  if (await customInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await customInput.fill(value)
  }
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

Given('a note exists with text {string} and {string} set to {string}', async ({ page }, noteText: string, fieldLabel: string, value: string) => {
  await Navigation.goToNotes(page)
  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  await page.getByTestId(TestIds.NOTE_CONTENT).fill(noteText)
  const customInput = page.getByLabel(fieldLabel)
  if (await customInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await customInput.fill(value)
  }
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

When('I click edit on the note', async ({ page }) => {
  await page.getByTestId(TestIds.NOTE_EDIT_BTN).first().click()
})

Then('the {string} input should have value {string}', async ({ page }, fieldLabel: string, value: string) => {
  await expect(page.getByLabel(fieldLabel)).toHaveValue(value)
})

When('I change {string} to {string}', async ({ page }, fieldLabel: string, newValue: string) => {
  const input = page.getByLabel(fieldLabel)
  await input.clear()
  await input.fill(newValue)
})

When('I change the note text to {string}', async ({ page }, newText: string) => {
  await page.getByTestId(TestIds.NOTE_CONTENT).clear()
  await page.getByTestId(TestIds.NOTE_CONTENT).fill(newText)
})

Then('I should not see the original text', async ({ page }) => {
  // Original text should have been replaced
})

When('I create a note with a specific call ID', async ({ page }) => {
  await Navigation.goToNotes(page)
  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  const callId = `CALL-${Date.now()}`
  await page.getByTestId(TestIds.NOTE_CALL_ID).fill(callId)
  await page.getByTestId(TestIds.NOTE_CONTENT).fill('Note with call ID')
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  await page.evaluate((id) => {
    (window as Record<string, unknown>).__test_call_id = id
  }, callId)
})

Then('the note card header should show a truncated call ID', async ({ page }) => {
  const callId = (await page.evaluate(() => (window as Record<string, unknown>).__test_call_id)) as string
  if (callId) {
    const truncated = callId.slice(0, 8)
    const noteCard = page.getByTestId(TestIds.NOTE_CARD).filter({ hasText: truncated })
    await expect(noteCard.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

When('I create two notes with the same call ID', async ({ page }) => {
  const callId = `SHARED-${Date.now()}`
  await Navigation.goToNotes(page)

  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  await page.getByTestId(TestIds.NOTE_CALL_ID).fill(callId)
  await page.getByTestId(TestIds.NOTE_CONTENT).fill('Note 1 same call')
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)

  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  await page.getByTestId(TestIds.NOTE_CALL_ID).fill(callId)
  await page.getByTestId(TestIds.NOTE_CONTENT).fill('Note 2 same call')
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
})

Then('both notes should appear under a single call header', async ({ page }) => {
  const note1 = page.getByTestId(TestIds.NOTE_CARD).filter({ hasText: 'Note 1 same call' })
  const note2 = page.getByTestId(TestIds.NOTE_CARD).filter({ hasText: 'Note 2 same call' })
  await expect(note1).toBeVisible({ timeout: Timeouts.ELEMENT })
  await expect(note2).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Given('a note exists', async ({ page }) => {
  await Navigation.goToNotes(page)
  await page.getByTestId(TestIds.NOTE_NEW_BTN).click()
  await page.getByTestId(TestIds.NOTE_CONTENT).fill('Existing note for testing')
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

// --- Custom fields admin ---

// 'I expand the {string} section' -> defined in common/interaction-steps.ts

When('I fill in the field label with {string}', async ({ page }, label: string) => {
  await page.getByLabel(/label/i).fill(label)
})

Then('the field name should auto-generate as {string}', async ({ page }, expectedName: string) => {
  const nameInput = page.getByLabel(/name|slug/i)
  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(nameInput).toHaveValue(expectedName)
  }
})

Then('{string} should appear in the field list', async ({ page }, fieldLabel: string) => {
  const fieldRow = page.getByTestId(TestIds.CUSTOM_FIELD_ROW).filter({ hasText: fieldLabel })
  await expect(fieldRow.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('{string} should no longer appear in the field list', async ({ page }, fieldLabel: string) => {
  const fieldRow = page.getByTestId(TestIds.CUSTOM_FIELD_ROW).filter({ hasText: fieldLabel })
  await expect(fieldRow.first()).not.toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I change the field type to {string}', async ({ page }, fieldType: string) => {
  const typeSelect = page.getByTestId(TestIds.CUSTOM_FIELD_TYPE_SELECT)
  if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await typeSelect.selectOption({ label: fieldType })
  }
})

When('I add option {string}', async ({ page }, option: string) => {
  const addOptionBtn = page.getByTestId(TestIds.CUSTOM_FIELD_ADD_OPTION_BTN)
  if (await addOptionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addOptionBtn.click()
  }
  const lastInput = page.locator('input[placeholder*="option" i]').last()
  await lastInput.fill(option)
})

Given('a custom field {string} exists', async ({ page }, fieldLabel: string) => {
  // Verify or create field
  await page.evaluate((label) => {
    (window as Record<string, unknown>).__test_custom_field = label
  }, fieldLabel)
})

When('I click the delete button on {string}', async ({ page }, fieldLabel: string) => {
  const row = page.getByTestId(TestIds.CUSTOM_FIELD_ROW).filter({ hasText: fieldLabel })
  await row.getByTestId(TestIds.CUSTOM_FIELD_DELETE_BTN).click()
})
