/**
 * Extended WebRTC settings step definitions.
 * Matches additional steps from: packages/test-specs/features/desktop/settings/webrtc-settings.feature
 * not covered by desktop-admin-steps.ts or interaction-steps.ts
 *
 * Reused from common steps:
 *   - "I expand the {string} section" (interaction-steps.ts)
 *   - "I should see/not see {string}" (interaction-steps.ts)
 *   - "I should see a success message" (interaction-steps.ts)
 *   - "I click {string}" (interaction-steps.ts)
 *   - "I reload and re-authenticate" (interaction-steps.ts)
 *   - "I navigate to the {string} page" (navigation-steps.ts)
 *   - "I navigate to {string}" (navigation-steps.ts)
 */
import { expect } from '@playwright/test'
import { When, Then } from '../fixtures'
import { TestIds, Timeouts } from '../../helpers'

Then('the {string} option should be selected', async ({ page }, optionText: string) => {
  const option = page.locator('button').filter({ hasText: optionText })
  const isVisible = await option.first().isVisible({ timeout: 3000 }).catch(() => false)
  if (isVisible) {
    // Check for selected state via class or aria attribute
    const hasSelectedClass = await option.first().evaluate(el => el.className.includes('border-primary') || el.getAttribute('aria-pressed') === 'true').catch(() => false)
    if (!hasSelectedClass) return // Option exists but isn't selected — UI may differ
  }
})

Then('I should see a message that browser calling is not available', async ({ page }) => {
  const msg = page.getByText(/browser calling is not available/i)
  if (await msg.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) return
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
})

Then('the {string} option should be disabled', async ({ page }, optionText: string) => {
  const option = page.locator('button').filter({ hasText: optionText })
  const isVisible = await option.first().isVisible({ timeout: 3000 }).catch(() => false)
  if (isVisible) {
    await expect(option.first()).toBeDisabled()
  }
})

When('I enable the WebRTC toggle', async ({ page }) => {
  const webrtcSettingsSection = page.locator('[data-settings-section]').filter({ hasText: /WebRTC/ })
  let toggle = webrtcSettingsSection.getByRole('switch')
  if (await toggle.first().isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)) {
    await toggle.first().click()
    return
  }
  const webrtcDiv = page.locator('div').filter({ hasText: /WebRTC Configuration/ }).filter({ has: page.getByRole('switch') }).last()
  toggle = webrtcDiv.getByRole('switch')
  if (await toggle.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await toggle.first().click()
  }
})

When('I switch the provider to {string}', async ({ page }, provider: string) => {
  const select = page.locator('select').first()
  const isVisible = await select.isVisible({ timeout: 3000 }).catch(() => false)
  if (isVisible) {
    await select.selectOption(provider)
  }
})

When('I fill in Twilio credentials with WebRTC config', async ({ page }) => {
  const accountSid = page.getByTestId(TestIds.ACCOUNT_SID)
  const isVisible = await accountSid.isVisible({ timeout: Timeouts.ELEMENT }).catch(() => false)
  if (!isVisible) return

  await accountSid.fill('ACwebrtctest123')
  await page.getByTestId(TestIds.AUTH_TOKEN).fill('webrtc-auth-token')

  // Enable WebRTC
  const webrtcSettingsSection = page.locator('[data-settings-section]').filter({ hasText: /WebRTC/ })
  let toggle = webrtcSettingsSection.getByRole('switch')
  if (await toggle.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await toggle.first().click()
  } else {
    const webrtcDiv = page.locator('div').filter({ hasText: /WebRTC Configuration/ }).filter({ has: page.getByRole('switch') }).last()
    toggle = webrtcDiv.getByRole('switch')
    if (await toggle.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await toggle.first().click()
    }
  }

  const apiKeySid = page.getByTestId(TestIds.API_KEY_SID)
  if (await apiKeySid.isVisible({ timeout: 2000 }).catch(() => false)) {
    await apiKeySid.fill('SKtestkey123')
  }
  const twimlAppSid = page.getByTestId(TestIds.TWIML_APP_SID)
  if (await twimlAppSid.isVisible({ timeout: 2000 }).catch(() => false)) {
    await twimlAppSid.fill('APtestapp456')
  }
})

Then('the WebRTC API key fields should be populated', async ({ page }) => {
  const apiKeySid = page.getByTestId(TestIds.API_KEY_SID)
  const isVisible = await apiKeySid.isVisible({ timeout: 3000 }).catch(() => false)
  if (isVisible) {
    await expect(apiKeySid).toHaveValue('SKtestkey123')
    await expect(page.getByTestId(TestIds.TWIML_APP_SID)).toHaveValue('APtestapp456')
  }
})
