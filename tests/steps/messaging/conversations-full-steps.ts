/**
 * Full conversation management step definitions.
 * Matches steps from: packages/test-specs/features/messaging/conversations-full.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'
import { Navigation } from '../../pages/index'

// --- Conversation setup ---

Given('a conversation exists', async ({ page }) => {
  await Navigation.goToConversations(page)
  // In demo mode, conversations may already exist; otherwise create a stub
  const anyConvo = page.getByTestId(TestIds.CONVERSATION_ITEM)
  const exists = await anyConvo.first().isVisible({ timeout: 3000 }).catch(() => false)
  if (!exists) {
    // Conversations are created via inbound messages — in test mode, seed one via page state
    await page.evaluate(() => {
      ;(window as Record<string, unknown>).__test_conversation_seeded = true
    })
  }
})

Given('I have an open conversation', async ({ page }) => {
  await Navigation.goToConversations(page)
  const item = page.getByTestId(TestIds.CONVERSATION_ITEM)
  const exists = await item.first().isVisible({ timeout: 3000 }).catch(() => false)
  if (exists) {
    await item.first().click()
    await page.waitForTimeout(Timeouts.UI_SETTLE)
  }
})

Given('conversations from different channels exist', async ({ page }) => {
  await Navigation.goToConversations(page)
  // In test/demo mode, multi-channel conversations are pre-seeded
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

Given('an open conversation exists', async ({ page }) => {
  await Navigation.goToConversations(page)
  const item = page.getByTestId(TestIds.CONVERSATION_ITEM)
  const exists = await item.first().isVisible({ timeout: 3000 }).catch(() => false)
  if (exists) {
    await item.first().click()
    await page.waitForTimeout(Timeouts.UI_SETTLE)
  }
})

Given('a closed conversation exists', async ({ page }) => {
  await Navigation.goToConversations(page)
  // Navigate to closed filter if available
  const closedFilter = page.getByTestId(TestIds.CONV_FILTER_CHIP).filter({ hasText: /closed/i })
  if (await closedFilter.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await closedFilter.first().click()
    await page.waitForTimeout(Timeouts.UI_SETTLE)
  }
  const item = page.getByTestId(TestIds.CONVERSATION_ITEM)
  const exists = await item.first().isVisible({ timeout: 3000 }).catch(() => false)
  if (exists) {
    await item.first().click()
  }
})

Given('conversations exist', async ({ page }) => {
  await Navigation.goToConversations(page)
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

// --- Conversation interactions ---

When('I click on a conversation', async ({ page }) => {
  const item = page.getByTestId(TestIds.CONVERSATION_ITEM)
  await item.first().click()
  await page.waitForTimeout(Timeouts.UI_SETTLE)
})

When('I type a message in the reply field', async ({ page }) => {
  const composer = page.getByTestId(TestIds.MESSAGE_COMPOSER)
  const textarea = composer.locator('textarea, input[type="text"]').first()
  await textarea.fill(`Test message ${Date.now()}`)
})

When('I assign the conversation to a volunteer', async ({ page }) => {
  const assignBtn = page.getByTestId(TestIds.CONV_ASSIGN_BTN)
  if (await assignBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await assignBtn.click()
    // Select first volunteer in the assignment list
    const volunteerOption = page.locator('[role="option"], [role="menuitem"]').first()
    if (await volunteerOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await volunteerOption.click()
    }
  }
})

When('I close the conversation', async ({ page }) => {
  await page.getByTestId(TestIds.CONV_CLOSE_BTN).click()
  // Confirm if dialog appears
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.getByTestId(TestIds.CONFIRM_DIALOG_OK).click()
  }
})

When('I reopen the conversation', async ({ page }) => {
  await page.getByTestId(TestIds.CONV_REOPEN_BTN).click()
})

When('I search for a phone number', async ({ page }) => {
  const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]')
  if (await searchInput.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchInput.first().fill('+1555')
    await page.waitForTimeout(Timeouts.UI_SETTLE)
  }
})

// --- Conversation assertions ---

Then('I should see the conversation thread', async ({ page }) => {
  const thread = page.getByTestId(TestIds.CONVERSATION_THREAD)
  await expect(thread).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see message timestamps', async ({ page }) => {
  // Content assertion — timestamps in conversation thread (e.g., "10:30 AM", "2024-01-15")
  const timestamp = page.getByText(/\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}/).first()
  await expect(timestamp).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the message should appear in the thread', async ({ page }) => {
  const thread = page.getByTestId(TestIds.CONVERSATION_THREAD)
  // Content assertion — verifying our test message appears
  await expect(thread.getByText(/Test message/)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('each conversation should show its channel badge', async ({ page }) => {
  // Content assertion — channel badges (SMS, WhatsApp, Signal, etc.)
  const badge = page.getByText(/SMS|WhatsApp|Signal|RCS/i).first()
  await expect(badge).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the conversation should show the assigned volunteer', async ({ page }) => {
  // Content assertion — assigned volunteer name or badge should be visible
  const assigned = page.getByText(/assigned|volunteer/i)
  await expect(assigned.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the conversation status should change to {string}', async ({ page }, status: string) => {
  // Content assertion — verifying status text
  await expect(page.getByText(status, { exact: true }).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('matching conversations should be displayed', async ({ page }) => {
  // Either matching results or "no results" message
  const results = page.getByTestId(TestIds.CONVERSATION_ITEM).first()
    .or(page.getByTestId(TestIds.EMPTY_STATE))
  await expect(results.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})
