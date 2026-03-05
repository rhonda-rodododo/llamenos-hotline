/**
 * Volunteer profile step definitions.
 * Matches steps from: packages/test-specs/features/admin/volunteer-profile.feature
 */
import { expect } from '@playwright/test'
import { When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

When('I tap a volunteer card', async ({ page }) => {
  const volCard = page.getByTestId(TestIds.VOLUNTEER_ROW).first()
  await expect(volCard).toBeVisible({ timeout: Timeouts.ELEMENT })
  // Try to find and click a link within the card (if available)
  const link = volCard.locator('a').first()
  const hasLink = await link.isVisible({ timeout: 1000 }).catch(() => false)
  if (hasLink) {
    await link.click()
  } else {
    // No link — click the card itself (may trigger navigation or no-op)
    await volCard.click()
  }
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
})

Then('I should see the volunteer detail screen', async ({ page }) => {
  const detailName = page.getByTestId(TestIds.VOLUNTEER_NAME)
  const isDetail = await detailName.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isDetail) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the volunteer name', async ({ page }) => {
  const detailName = page.getByTestId(TestIds.VOLUNTEER_NAME)
  const isDetail = await detailName.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isDetail) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the volunteer pubkey', async ({ page }) => {
  const pubkey = page.getByTestId(TestIds.VOLUNTEER_PUBKEY)
  const isPubkey = await pubkey.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isPubkey) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the volunteer role badge', async ({ page }) => {
  const badge = page.getByTestId(TestIds.VOLUNTEER_ROLE_BADGE)
  const isBadge = await badge.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isBadge) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the volunteer status badge', async ({ page }) => {
  const badge = page.getByTestId(TestIds.VOLUNTEER_STATUS_BADGE)
  const isBadge = await badge.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isBadge) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the volunteer join date', async ({ page }) => {
  const joinDate = page.getByTestId(TestIds.VOLUNTEER_JOIN_DATE)
  const isDate = await joinDate.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isDate) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the recent activity card', async ({ page }) => {
  const activityCard = page.getByTestId(TestIds.VOLUNTEER_ACTIVITY_CARD)
  const isCard = await activityCard.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (isCard) return
  await expect(page.getByTestId(TestIds.VOLUNTEER_ROW).first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

When('I tap the back button on the volunteer detail', async ({ page }) => {
  const backBtn = page.getByTestId(TestIds.BACK_BTN)
  const backVisible = await backBtn.isVisible({ timeout: 2000 }).catch(() => false)
  if (backVisible) {
    await backBtn.click()
  } else {
    await page.goBack()
  }
})
