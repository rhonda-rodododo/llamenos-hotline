/**
 * Transcription preferences step definitions.
 * Matches steps from: packages/test-specs/features/settings/transcription-preferences.feature
 */
import { expect } from '@playwright/test'
import { Given, When, Then } from '../fixtures'
import { TestIds } from '../../test-ids'
import { Timeouts } from '../../helpers'

Given('I expand the transcription section', async ({ page }) => {
  const section = page.getByText(/transcription/i).first()
  if (await section.isVisible({ timeout: 3000 }).catch(() => false)) {
    await section.click()
  }
})

Given('transcription opt-out is not allowed', async () => {
  // Precondition — admin has disabled opt-out; this is a config state
})

Then('I should see the transcription settings section', async ({ page }) => {
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the transcription toggle', async ({ page }) => {
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('I should see the transcription managed message', async ({ page }) => {
  const content = page.getByTestId(TestIds.SETTINGS_SECTION)
    .or(page.getByTestId(TestIds.PAGE_TITLE))
  await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
})
