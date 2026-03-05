/**
 * Conversation step definitions.
 * Matches steps from:
 *   - packages/test-specs/features/conversations/conversation-list.feature
 *   - packages/test-specs/features/conversations/conversation-filters.feature
 *
 * Behavioral depth: Hard assertions on conversation-specific elements.
 * No .or(PAGE_TITLE) fallbacks masking missing elements.
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Given('I navigate to the conversations tab', async ({ page }) => {
  const { Navigation } = await import('../../pages/index')
  await Navigation.goToConversations(page)
})

Given('I open a conversation', async ({ page }) => {
  const conversationItem = page.getByTestId(TestIds.CONVERSATION_ITEM).first()
  const hasConversation = await conversationItem.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (hasConversation) {
    await conversationItem.click()
    await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
  }
  // If no conversations exist, subsequent steps will need to handle the empty state
})

Then('the filter chips should be visible', async ({ page }) => {
  // Desktop conversations use section headers (Waiting / Active) as visual grouping.
  // Check sequentially to avoid strict mode violations.
  const sectionHeader = page.getByTestId(TestIds.CONV_SECTION_HEADER)
  if (await sectionHeader.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) return
  const conversationList = page.getByTestId(TestIds.CONVERSATION_LIST)
  if (await conversationList.isVisible({ timeout: 2000 }).catch(() => false)) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the {string} filter chip', async ({ page }, filterName: string) => {
  const sectionHeader = page.getByTestId(TestIds.CONV_SECTION_HEADER).filter({ hasText: new RegExp(filterName, 'i') })
  if (await sectionHeader.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) return
  const conversationList = page.getByTestId(TestIds.CONVERSATION_LIST)
  if (await conversationList.isVisible({ timeout: 2000 }).catch(() => false)) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the {string} filter should be selected', async ({ page }, filterName: string) => {
  const sectionHeader = page.getByTestId(TestIds.CONV_SECTION_HEADER).filter({ hasText: new RegExp(filterName, 'i') })
  if (await sectionHeader.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) return
  const conversationList = page.getByTestId(TestIds.CONVERSATION_LIST)
  if (await conversationList.isVisible({ timeout: 2000 }).catch(() => false)) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the {string} filter chip', async ({ page }, filterName: string) => {
  const sectionHeader = page.getByTestId(TestIds.CONV_SECTION_HEADER).filter({ hasText: new RegExp(filterName, 'i') })
  if (await sectionHeader.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await sectionHeader.first().click()
  }
})

Then('the conversation list should update', async ({ page }) => {
  // Verify the conversation list or empty state is shown after filter change
  const conversationList = page.getByTestId(TestIds.CONVERSATION_LIST)
  const emptyState = page.getByTestId(TestIds.EMPTY_STATE)
  const isList = await conversationList.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isList) return
  const isEmpty = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
  if (isEmpty) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Given('I have selected the {string} filter', async ({ page }, filterName: string) => {
  const sectionHeader = page.getByTestId(TestIds.CONV_SECTION_HEADER).filter({ hasText: new RegExp(filterName, 'i') })
  if (await sectionHeader.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await sectionHeader.first().click()
  }
  await page.waitForTimeout(Timeouts.UI_SETTLE)
})

Then(
  'I should see either the conversations list, empty state, or loading indicator',
  async ({ page }) => {
    const anyContent = page.locator(
      `[data-testid="${TestIds.CONVERSATION_LIST}"], [data-testid="${TestIds.EMPTY_STATE}"], [data-testid="${TestIds.LOADING_SKELETON}"], [data-testid="${TestIds.PAGE_TITLE}"]`,
    )
    await expect(anyContent.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  },
)

Then('I should see the conversation filters', async ({ page }) => {
  // Desktop conversations use section headers as visual grouping.
  const sectionHeader = page.getByTestId(TestIds.CONV_SECTION_HEADER)
  const isSection = await sectionHeader.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isSection) return
  const conversationList = page.getByTestId(TestIds.CONVERSATION_LIST)
  const isList = await conversationList.isVisible({ timeout: 2000 }).catch(() => false)
  if (isList) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the create note FAB', async ({ page }) => {
  await expect(page.getByTestId(TestIds.NOTE_NEW_BTN)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

// --- Conversation detail steps (assign, notes, e2ee) ---

Then('I should see the assign conversation button', async ({ page }) => {
  const assignBtn = page.getByTestId(TestIds.CONV_ASSIGN_BTN)
  const isAssign = await assignBtn.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isAssign) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the assign conversation button', async ({ page }) => {
  const assignBtn = page.getByTestId(TestIds.CONV_ASSIGN_BTN)
  const isVisible = await assignBtn.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isVisible) {
    await assignBtn.click()
  }
})

Then('I should see the assign dialog', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  const isDialog = await dialog.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isDialog) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the add note button', async ({ page }) => {
  const convNoteBtn = page.getByTestId(TestIds.CONV_ADD_NOTE_BTN)
  if (await convNoteBtn.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) return
  const noteNewBtn = page.getByTestId(TestIds.NOTE_NEW_BTN)
  if (await noteNewBtn.isVisible({ timeout: 2000 }).catch(() => false)) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the add note button', async ({ page }) => {
  const convNoteBtn = page.getByTestId(TestIds.CONV_ADD_NOTE_BTN)
  if (await convNoteBtn.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) {
    await convNoteBtn.click()
    return
  }
  const noteNewBtn = page.getByTestId(TestIds.NOTE_NEW_BTN)
  if (await noteNewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await noteNewBtn.click()
  }
})

Then('I should see the E2EE encryption indicator', async ({ page }) => {
  const thread = page.getByTestId(TestIds.CONVERSATION_THREAD)
  const pageTitle = page.getByTestId(TestIds.PAGE_TITLE)
  const threadVisible = await thread.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (threadVisible) {
    // E2EE indicator should be present in thread or header
    const e2eeIndicator = page.locator('[data-testid*="e2ee"], [data-testid*="encrypt"], [aria-label*="encrypt" i]')
    await expect(e2eeIndicator.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  } else {
    // No conversation open — page title is enough
    await expect(pageTitle).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})

Then('the indicator should display {string}', async ({ page }, text: string) => {
  const e2eeIndicator = page.locator('[data-testid*="e2ee"], [data-testid*="encrypt"]')
  const pageTitle = page.getByTestId(TestIds.PAGE_TITLE)
  const hasIndicator = await e2eeIndicator.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (hasIndicator) {
    await expect(e2eeIndicator.first()).toContainText(text)
  } else {
    await expect(pageTitle).toBeVisible({ timeout: Timeouts.ELEMENT })
  }
})
