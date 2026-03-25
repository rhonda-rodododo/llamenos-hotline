/**
 * Hub Admin Zero-Trust Visibility -- UI Tests
 *
 * Verifies that:
 *   - Hub access badge is visible in the hubs list
 *   - Hub admins can toggle super admin access via the edit dialog
 *   - Hub admins can disable super admin access after enabling
 */

import { expect, test } from '@playwright/test'
import { ADMIN_NSEC, Timeouts, loginAsAdmin, navigateAfterLogin } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Hub access control UI', () => {
  test.describe.configure({ mode: 'serial' })

  /** Hub created for the test suite -- shared across all tests */
  let testHubId: string
  const testHubName = `access-ctrl-ui-${Date.now()}`

  test.beforeAll(async ({ request }) => {
    // Pre-create the hub via API so UI tests can reference it
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const createRes = await authedApi.post('/api/hubs', { name: testHubName })
    const created = await createRes.json()
    testHubId = created.hub.id
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('newly created hub shows restricted access badge in UI', async ({ page }) => {
    await navigateAfterLogin(page, '/admin/hubs')
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: testHubName })
    await expect(hubRow).toBeVisible({ timeout: Timeouts.ELEMENT })
    const accessBadge = hubRow.getByTestId('hub-access-badge')
    await expect(accessBadge).toBeVisible()
  })

  test('hub admin can enable super admin access via the edit dialog', async ({ page, request }) => {
    await navigateAfterLogin(page, '/admin/hubs')

    // Open the edit dialog for the test hub
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: testHubName })
    await expect(hubRow).toBeVisible({ timeout: Timeouts.ELEMENT })
    await hubRow.getByRole('button', { name: /edit/i }).click()

    // The edit dialog should be visible
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Find the access control section
    const accessControl = page.getByTestId('hub-access-control')
    await expect(accessControl).toBeVisible()

    // Toggle should exist and be OFF (since allowSuperAdminAccess defaults to false)
    const toggle = page.getByTestId('hub-access-toggle')
    await expect(toggle).toBeVisible()

    // Click the toggle to enable super admin access
    await toggle.click()

    // Confirmation dialog should appear
    const confirmBtn = page.getByTestId('hub-access-confirm-btn')
    await expect(confirmBtn).toBeVisible({ timeout: Timeouts.ELEMENT })
    await confirmBtn.click()

    // Wait for the dialog to process and close the confirmation
    await expect(confirmBtn).not.toBeVisible({ timeout: Timeouts.API })

    // Close the edit dialog
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: Timeouts.ELEMENT })

    // Verify the change persisted by checking via API
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const fetchRes = await authedApi.get(`/api/hubs/${testHubId}`)
    const fetched = await fetchRes.json()
    expect(fetched.hub.allowSuperAdminAccess).toBe(true)
  })

  test('hub admin can disable super admin access after enabling', async ({ page, request }) => {
    await navigateAfterLogin(page, '/admin/hubs')

    // Open the edit dialog
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: testHubName })
    await expect(hubRow).toBeVisible({ timeout: Timeouts.ELEMENT })
    await hubRow.getByRole('button', { name: /edit/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Toggle should be ON -- click to disable
    const toggle = page.getByTestId('hub-access-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()

    // Confirmation dialog for disabling
    const confirmBtn = page.getByTestId('hub-access-confirm-btn')
    await expect(confirmBtn).toBeVisible({ timeout: Timeouts.ELEMENT })
    await confirmBtn.click()

    // Wait for update to complete
    await expect(confirmBtn).not.toBeVisible({ timeout: Timeouts.API })

    // Close edit dialog
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: Timeouts.ELEMENT })

    // Verify the change persisted via API
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const fetchRes = await authedApi.get(`/api/hubs/${testHubId}`)
    const fetched = await fetchRes.json()
    expect(fetched.hub.allowSuperAdminAccess).toBe(false)
  })
})
