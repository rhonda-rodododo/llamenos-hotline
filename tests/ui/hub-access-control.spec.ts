/**
 * Hub Admin Zero-Trust Visibility -- UI Tests
 *
 * Verifies that:
 *   - Hub access badge is visible in the hubs list
 *   - Super admins see a read-only badge (not a toggle) in the edit dialog
 *   - Super admins cannot self-grant hub access via the settings API
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

  test('super admin sees read-only access badge in edit dialog', async ({ page, request }) => {
    await navigateAfterLogin(page, '/admin/hubs')

    // Open the edit dialog for the test hub
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: testHubName })
    await expect(hubRow).toBeVisible({ timeout: Timeouts.ELEMENT })
    await hubRow.getByRole('button', { name: /edit/i }).click()

    // The edit dialog should be visible
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Find the access control section
    const accessControl = page.getByTestId('hub-access-control')
    await expect(accessControl).toBeVisible({ timeout: 10000 })

    // Super admins see a read-only badge (not a toggle) showing access status.
    // Default is restricted, so the badge should show "Restricted".
    // The toggle (data-testid="hub-access-toggle") should NOT be present for super admins.
    await expect(accessControl.getByText(/restricted/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('hub-access-toggle')).not.toBeVisible()

    // Close the edit dialog
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: Timeouts.ELEMENT })

    // Verify initial state via API
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const fetchRes = await authedApi.get(`/api/hubs/${testHubId}`)
    const fetched = await fetchRes.json()
    expect(fetched.hub.allowSuperAdminAccess).toBe(false)
  })

  test('super admin cannot modify hub access via settings API', async ({ request }) => {
    // The settings endpoint explicitly blocks super admins from modifying their own access.
    // This is a security constraint: only hub admins can grant/revoke super admin visibility.
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const updateRes = await authedApi.patch(`/api/hubs/${testHubId}/settings`, {
      allowSuperAdminAccess: true,
    })
    // Should be 403 Forbidden because super admin cannot self-grant
    expect(updateRes.status()).toBe(403)

    // Verify the setting remains unchanged (false)
    const fetchRes = await authedApi.get(`/api/hubs/${testHubId}`)
    const fetched = await fetchRes.json()
    expect(fetched.hub.allowSuperAdminAccess).toBe(false)
  })
})
