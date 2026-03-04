/**
 * Admin flow step definitions.
 * Matches steps from: packages/test-specs/features/desktop/admin/admin-flow.feature
 * Covers admin navigation, volunteer CRUD, shift CRUD, ban management,
 * call history, settings, and language switching.
 */
import { expect } from '@playwright/test'
import { When, Then } from '../fixtures'
import { TestIds, uniquePhone, Timeouts } from '../../helpers'

// --- State for cross-step data ---
let lastVolunteerName = ''
let lastShiftName = ''
let lastPhone = ''

// --- Volunteer CRUD ---

When('I add a new volunteer with a unique name and phone', async ({ page }) => {
  const phone = uniquePhone()
  lastVolunteerName = `Vol ${Date.now()}`
  lastPhone = phone
  await page.getByTestId(TestIds.VOLUNTEER_ADD_BTN).click()
  await page.getByLabel('Name').fill(lastVolunteerName)
  await page.getByLabel('Phone Number').fill(phone)
  await page.getByLabel('Phone Number').blur()
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
})

Then('I should see the generated nsec', async ({ page }) => {
  await expect(page.getByTestId(TestIds.VOLUNTEER_NSEC_CODE)).toBeVisible({ timeout: 15000 })
})

When('I close the nsec card', async ({ page }) => {
  await page.getByTestId(TestIds.DISMISS_NSEC).click()
})

Then('the volunteer should appear in the list', async ({ page }) => {
  const row = page.getByTestId(TestIds.VOLUNTEER_ROW).filter({ hasText: lastVolunteerName })
  await expect(row.first()).toBeVisible()
})

When('I delete the volunteer', async ({ page }) => {
  const volRow = page.getByTestId(TestIds.VOLUNTEER_ROW).filter({ hasText: lastVolunteerName })
  await volRow.getByTestId(TestIds.VOLUNTEER_DELETE_BTN).click()
  await page.getByTestId(TestIds.CONFIRM_DIALOG_OK).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})

Then('the volunteer should be removed from the list', async ({ page }) => {
  const row = page.getByTestId(TestIds.VOLUNTEER_ROW).filter({ hasText: lastVolunteerName })
  await expect(row).not.toBeVisible()
})

// --- Shift CRUD ---

When('I create a new shift with a unique name', async ({ page }) => {
  lastShiftName = `Shift ${Date.now()}`
  await page.getByTestId(TestIds.SHIFT_CREATE_BTN).click()
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).fill(lastShiftName)
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: lastShiftName })
  await expect(card.first()).toBeVisible()
})

Then('the shift should appear in the list', async ({ page }) => {
  const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: lastShiftName })
  await expect(card.first()).toBeVisible()
})

When('I edit the shift with a new name', async ({ page }) => {
  const updatedName = `Updated ${Date.now()}`
  const shiftCard = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: lastShiftName })
  await shiftCard.getByTestId(TestIds.SHIFT_EDIT_BTN).click()
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).clear()
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).fill(updatedName)
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
  lastShiftName = updatedName
})

Then('the updated shift name should appear', async ({ page }) => {
  const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: lastShiftName })
  await expect(card.first()).toBeVisible()
})

When('I delete the shift', async ({ page }) => {
  const shiftCard = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: lastShiftName })
  await shiftCard.getByTestId(TestIds.SHIFT_DELETE_BTN).click()
})

Then('the shift should no longer appear', async ({ page }) => {
  const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: lastShiftName })
  await expect(card).not.toBeVisible()
})

// --- Ban management ---

When('I ban a unique phone number with reason {string}', async ({ page }, reason: string) => {
  lastPhone = uniquePhone()
  await page.getByTestId(TestIds.BAN_ADD_BTN).click()
  await page.getByLabel('Phone Number').fill(lastPhone)
  await page.getByLabel('Phone Number').blur()
  await page.getByLabel('Reason').fill(reason)
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
})

Then('the banned phone number should appear', async ({ page }) => {
  const row = page.getByTestId(TestIds.BAN_ROW).filter({ hasText: lastPhone })
  await expect(row.first()).toBeVisible()
})

When('I remove the ban for that phone number', async ({ page }) => {
  const banRow = page.getByTestId(TestIds.BAN_ROW).filter({ hasText: lastPhone })
  await expect(banRow.first()).toBeVisible()
  await banRow.getByTestId(TestIds.BAN_REMOVE_BTN).click()
  await page.getByTestId(TestIds.CONFIRM_DIALOG_OK).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})

Then('the phone number should no longer appear', async ({ page }) => {
  const row = page.getByTestId(TestIds.BAN_ROW).filter({ hasText: lastPhone })
  await expect(row).not.toBeVisible()
})

// --- Phone validation ---

When('I try to add a volunteer with an invalid phone number', async ({ page }) => {
  await page.getByTestId(TestIds.VOLUNTEER_ADD_BTN).click()
  await page.getByLabel('Name').fill('Bad Phone')
  await page.getByLabel('Phone Number').fill('+12')
  await page.getByLabel('Phone Number').blur()
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()
})

Then('I should see an invalid phone error', async ({ page }) => {
  await expect(page.getByText(/invalid phone/i)).toBeVisible()
})

// --- Call history ---

When('I search for a phone number in call history', async ({ page }) => {
  await page.getByTestId(TestIds.CALL_SEARCH).fill('+1234567890')
  await page.getByTestId(TestIds.CALL_SEARCH_BTN).click()
})

Then('I should see the clear filters button', async ({ page }) => {
  await expect(page.getByTestId(TestIds.CALL_CLEAR_FILTERS)).toBeVisible()
})

When('I click the clear filters button', async ({ page }) => {
  await page.getByTestId(TestIds.CALL_CLEAR_FILTERS).click()
})

Then('the clear filters button should not be visible', async ({ page }) => {
  await expect(page.getByTestId(TestIds.CALL_CLEAR_FILTERS)).not.toBeVisible()
})

// --- Settings toggles ---

Then('I should see at least one toggle switch', async ({ page }) => {
  const switches = page.getByRole('switch')
  const count = await switches.count()
  expect(count).toBeGreaterThan(0)
})

// --- Language switching ---

When('I switch the language to Espanol', async ({ page }) => {
  await page.getByRole('combobox', { name: /switch to/i }).click()
  await page.getByRole('option', { name: /español/i }).click()
})

When('I switch the language back to English', async ({ page }) => {
  await page.getByRole('combobox', { name: /cambiar a/i }).click()
  await page.getByRole('option', { name: /english/i }).click()
})

// --- Settings summaries ---

Then('the telephony provider card should be visible', async ({ page }) => {
  await page.waitForTimeout(1000)
  await expect(page.getByTestId(TestIds.TELEPHONY_PROVIDER)).toBeVisible()
})

Then('the transcription card should be visible', async ({ page }) => {
  await expect(page.getByTestId(TestIds.TRANSCRIPTION_SECTION)).toBeVisible()
})

Then('at least one status summary should be visible', async ({ page }) => {
  // Content assertion — verify settings status summaries are rendered
  const statusCount = await page
    .getByText(
      /(Enabled|Disabled|Not configured|Not required|languages|fields|None|CAPTCHA|Default|Customized)/i,
    )
    .count()
  expect(statusCount).toBeGreaterThan(0)
})
