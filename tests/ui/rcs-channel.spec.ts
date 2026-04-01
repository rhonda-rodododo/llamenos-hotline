import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'

test.describe('RCS Channel Configuration', () => {
  test('RCS section is present and expandable on admin settings page', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings')

    // The RCS section card should exist (collapsed by default)
    const rcsSection = adminPage.getByTestId('rcs-channel')
    await expect(rcsSection).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Fields should NOT be visible when collapsed
    await expect(adminPage.getByTestId('rcs-agent-id')).not.toBeVisible()

    // Expand the RCS section by clicking the header
    await rcsSection.getByText('RCS Channel').click()

    // After expanding, all three config fields should be visible
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })
    await expect(adminPage.getByTestId('rcs-service-key')).toBeVisible()
    await expect(adminPage.getByTestId('rcs-webhook-secret')).toBeVisible()
  })

  test('RCS form fields accept input values', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings')

    // Expand the RCS section
    const rcsSection = adminPage.getByTestId('rcs-channel')
    await rcsSection.getByText('RCS Channel').click()
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Fill in test values
    const testAgentId = 'brands/TEST_BRAND/agents/TEST_AGENT'
    const testServiceKey = '{"type": "service_account", "project_id": "test-project"}'
    const testWebhookSecret = 'whsec_test_secret_12345'

    await adminPage.getByTestId('rcs-agent-id').fill(testAgentId)
    await adminPage.getByTestId('rcs-service-key').fill(testServiceKey)
    await adminPage.getByTestId('rcs-webhook-secret').fill(testWebhookSecret)

    // Verify values are set correctly
    await expect(adminPage.getByTestId('rcs-agent-id')).toHaveValue(testAgentId)
    await expect(adminPage.getByTestId('rcs-service-key')).toHaveValue(testServiceKey)
    await expect(adminPage.getByTestId('rcs-webhook-secret')).toHaveValue(testWebhookSecret)
  })

  test('RCS config can be saved', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings')

    // Expand the RCS section
    const rcsSection = adminPage.getByTestId('rcs-channel')
    await rcsSection.getByText('RCS Channel').click()
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Fill in valid config
    await adminPage.getByTestId('rcs-agent-id').fill('brands/SAVE_TEST/agents/AGENT_001')
    await adminPage
      .getByTestId('rcs-service-key')
      .fill('{"type": "service_account", "project_id": "save-test"}')
    await adminPage.getByTestId('rcs-webhook-secret').fill('whsec_save_test')

    // Save button should be enabled (agent ID is filled)
    const saveButton = rcsSection.getByRole('button', { name: /save/i })
    await expect(saveButton).toBeEnabled()

    // Click save
    await saveButton.click()

    // Wait for success toast
    await expect(adminPage.getByText(/success/i).first()).toBeVisible({ timeout: Timeouts.API })
  })

  test('save button is disabled when agent ID is empty', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings')

    // Expand the RCS section
    const rcsSection = adminPage.getByTestId('rcs-channel')
    await rcsSection.getByText('RCS Channel').click()
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Clear the agent ID field (ensure it's empty)
    await adminPage.getByTestId('rcs-agent-id').fill('')

    // Save button should be disabled when agent ID is empty
    const saveButton = rcsSection.getByRole('button', { name: /save/i })
    await expect(saveButton).toBeDisabled()

    // Fill agent ID — save should become enabled
    await adminPage.getByTestId('rcs-agent-id').fill('brands/TEST/agents/TEST')
    await expect(saveButton).toBeEnabled()
  })

  test('fallback to SMS toggle works', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings')

    // Expand the RCS section
    const rcsSection = adminPage.getByTestId('rcs-channel')
    await rcsSection.getByText('RCS Channel').click()
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Find the Fallback to SMS switch
    const fallbackSwitch = rcsSection.getByRole('switch')
    await expect(fallbackSwitch).toBeVisible()

    // Default should be checked (fallbackToSms: true)
    const initialState = await fallbackSwitch.getAttribute('data-state')

    // Toggle it
    const expectedAfterToggle = initialState === 'checked' ? 'unchecked' : 'checked'
    await fallbackSwitch.click()

    // State should have changed (wait for React re-render)
    await expect(fallbackSwitch).toHaveAttribute('data-state', expectedAfterToggle, {
      timeout: 3000,
    })

    // Toggle it back
    await fallbackSwitch.click()
    await expect(fallbackSwitch).toHaveAttribute('data-state', initialState!, {
      timeout: 3000,
    })
  })

  test('saved RCS config persists after page navigation', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings')

    // Expand and fill in config
    const rcsSection = adminPage.getByTestId('rcs-channel')
    await rcsSection.getByText('RCS Channel').click()
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })

    const testAgentId = 'brands/PERSIST_TEST/agents/PERSIST_001'
    await adminPage.getByTestId('rcs-agent-id').fill(testAgentId)
    await adminPage
      .getByTestId('rcs-service-key')
      .fill('{"type": "service_account", "project_id": "persist"}')

    // Save
    const saveButton = rcsSection.getByRole('button', { name: /save/i })
    await saveButton.click()
    await expect(adminPage.getByText(/success/i).first()).toBeVisible({ timeout: Timeouts.API })

    // Navigate away and come back
    await navigateAfterLogin(adminPage, '/')
    await navigateAfterLogin(adminPage, '/admin/settings')

    // Re-expand RCS section
    const rcsSectionAgain = adminPage.getByTestId('rcs-channel')
    await rcsSectionAgain.getByText('RCS Channel').click()
    await expect(adminPage.getByTestId('rcs-agent-id')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Verify the saved agent ID persisted
    await expect(adminPage.getByTestId('rcs-agent-id')).toHaveValue(testAgentId)
  })
})
