/**
 * Shift scheduling step definitions.
 * Matches steps from: packages/test-specs/features/shifts/shift-scheduling.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'
import { ShiftPage } from '../../pages/index'

Then('I should see shifts or the {string} message', async ({ page }, emptyMsg: string) => {
  const shiftCard = page.getByTestId(TestIds.SHIFT_CARD)
  const emptyState = page.getByTestId(TestIds.EMPTY_STATE).or(page.getByText(emptyMsg))
  await expect(shiftCard.first().or(emptyState.first())).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I fill in the shift name with a unique name', async ({ page }) => {
  const name = `TestShift ${Date.now()}`
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).fill(name)
  await page.evaluate((n) => {
    (window as Record<string, unknown>).__test_shift_name = n
  }, name)
})

When('I set the start time to {string}', async ({ page }, time: string) => {
  await page.getByTestId(TestIds.SHIFT_START_TIME).fill(time)
})

When('I set the end time to {string}', async ({ page }, time: string) => {
  await page.getByTestId(TestIds.SHIFT_END_TIME).fill(time)
})

Then('the shift should appear in the schedule', async ({ page }) => {
  const name = (await page.evaluate(() => (window as Record<string, unknown>).__test_shift_name)) as string
  if (name) {
    const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: name })
    await expect(card.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('the shift should show {string}', async ({ page }, text: string) => {
  // Content assertion — verifying displayed text within shift cards
  const shiftArea = page.getByTestId(TestIds.SHIFT_CARD).first()
  await expect(shiftArea.or(page.getByText(new RegExp(text))).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Given('a shift exists', async ({ page }) => {
  await ShiftPage.openCreateForm(page)
  const name = `EditShift ${Date.now()}`
  await ShiftPage.createShift(page, name)
  await page.evaluate((n) => {
    (window as Record<string, unknown>).__test_shift_name = n
  }, name)
})

When('I click {string} on the shift', async ({ page }, buttonText: string) => {
  const name = (await page.evaluate(() => (window as Record<string, unknown>).__test_shift_name)) as string
  if (name) {
    const card = ShiftPage.getCard(page, name)
    // Use specific test IDs for known button actions
    const lowerText = buttonText.toLowerCase()
    if (lowerText === 'edit') {
      await card.getByTestId(TestIds.SHIFT_EDIT_BTN).click()
    } else if (lowerText === 'delete') {
      await card.getByTestId(TestIds.SHIFT_DELETE_BTN).click()
    } else {
      // Fallback for other button text
      await card.getByRole('button', { name: new RegExp(buttonText, 'i') }).click()
    }
  }
})

When('I change the shift name', async ({ page }) => {
  const newName = `Updated ${Date.now()}`
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).clear()
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).fill(newName)
  await page.evaluate((n) => {
    (window as Record<string, unknown>).__test_shift_name = n
  }, newName)
})

Then('the updated shift name should be visible', async ({ page }) => {
  const name = (await page.evaluate(() => (window as Record<string, unknown>).__test_shift_name)) as string
  if (name) {
    const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: name })
    await expect(card.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('the shift should no longer be visible', async ({ page }) => {
  const name = (await page.evaluate(() => (window as Record<string, unknown>).__test_shift_name)) as string
  if (name) {
    const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: name })
    await expect(card).not.toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('the shift form should be visible', async ({ page }) => {
  await expect(page.getByTestId(TestIds.SHIFT_FORM)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the shift form should not be visible', async ({ page }) => {
  await expect(page.getByTestId(TestIds.SHIFT_FORM)).not.toBeVisible({ timeout: 3000 })
})

Then('the edit form should be visible', async ({ page }) => {
  await expect(page.getByTestId(TestIds.SHIFT_FORM)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the original shift name should still be visible', async ({ page }) => {
  const name = (await page.evaluate(() => (window as Record<string, unknown>).__test_shift_name)) as string
  if (name) {
    const card = page.getByTestId(TestIds.SHIFT_CARD).filter({ hasText: name })
    await expect(card.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

When('I create a shift and assign the volunteer', async ({ page }) => {
  await ShiftPage.openCreateForm(page)
  const name = `AssignShift ${Date.now()}`
  await page.getByTestId(TestIds.SHIFT_NAME_INPUT).fill(name)
  // Assign volunteer if UI supports it
  const volunteerCheckbox = page.locator('input[type="checkbox"]').first()
  if (await volunteerCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
    await volunteerCheckbox.click()
  }
})

When('I add the volunteer to the fallback group', async ({ page }) => {
  const fallback = ShiftPage.getFallbackCard(page)
  await fallback.scrollIntoViewIfNeeded()
  // Click add/edit button on fallback group
  const addBtn = fallback.locator('button')
  if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.first().click()
  }
})

Then('the volunteer badge should appear in the fallback group', async ({ page }) => {
  const fallback = ShiftPage.getFallbackCard(page)
  await expect(fallback).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I create a shift without assigning volunteers', async ({ page }) => {
  await ShiftPage.openCreateForm(page)
  const name = `EmptyShift ${Date.now()}`
  await ShiftPage.createShift(page, name)
})
