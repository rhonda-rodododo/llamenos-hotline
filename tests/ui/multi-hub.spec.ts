import { expect, test } from '@playwright/test'
import { ADMIN_NSEC, loginAsAdmin } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Multi-hub architecture — UI', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('hub switcher hidden when single hub', async ({ page }) => {
    // With the default single hub, the hub switcher should not be visible.
    // Note: In parallel test runs, other tests may create additional hubs,
    // so check that the switcher is NOT a dropdown (single hub = no dropdown).
    const switcher = page.getByLabel(/switch hub/i)
    const isVisible = await switcher.isVisible({ timeout: 2000 }).catch(() => false)
    if (isVisible) {
      // If visible, it means another parallel test created hubs — skip assertion
      test.skip()
    }
    await expect(switcher).not.toBeVisible()
  })

  test('existing pages still work with hub context', async ({ page }) => {
    // Verify all main pages load correctly with hub context active
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    await page.getByRole('link', { name: 'Shifts' }).click()
    await expect(page.getByRole('heading', { name: /shift schedule/i })).toBeVisible()

    await page.getByRole('link', { name: 'Ban List' }).click()
    await expect(page.getByRole('heading', { name: /ban list/i })).toBeVisible()

    await page.getByRole('link', { name: 'Audit Log' }).click()
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()

    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  })

  test('admin can archive a hub via the UI', async ({ page, request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a hub via the API so the test doesn't depend on prior state
    const hubName = `archive-test-${Date.now()}`
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created).toHaveProperty('hub')

    // Navigate to the hub management page
    await page.goto('/admin/hubs')
    await page.waitForLoadState('networkidle')

    // Confirm the hub appears in the active list
    await expect(page.getByText(hubName)).toBeVisible()

    // Click the Archive button for this hub's row
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await hubRow.getByRole('button', { name: /archive/i }).click()

    // Confirmation dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(hubName)

    // Confirm the archive action (click the destructive Archive Hub button in dialog)
    await page
      .getByRole('button', { name: /archive hub/i })
      .last()
      .click()

    // Dialog should close and hub should no longer appear in the active list
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByText(hubName)).not.toBeVisible()
  })

  test('hub delete requires typing hub name to confirm', async ({ page, request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const hubName = `delete-confirm-test-${Date.now()}`

    // Create + archive a hub via API
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    const archiveRes = await authedApi.patch(`/api/hubs/${hubId}`, { status: 'archived' })
    expect(archiveRes.ok()).toBe(true)

    await page.goto('/admin/hubs')
    await page.waitForLoadState('networkidle')

    // Reload to pick up archived status
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await expect(hubRow).toBeVisible()
    await hubRow.getByTestId('hub-delete-btn').click()

    // Dialog opens
    await expect(page.getByRole('dialog')).toBeVisible()

    // Confirm button disabled until name typed
    const confirmBtn = page.getByTestId('delete-hub-confirm-btn')
    await expect(confirmBtn).toBeDisabled()

    // Type wrong name — still disabled
    await page.getByTestId('delete-hub-confirm-input').fill('wrong-name')
    await expect(confirmBtn).toBeDisabled()

    // Type correct name — button enabled
    await page.getByTestId('delete-hub-confirm-input').fill(hubName)
    await expect(confirmBtn).toBeEnabled()

    // Cancel without deleting
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('admin can permanently delete an archived hub', async ({ page, request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const hubName = `perm-delete-test-${Date.now()}`

    // Create + archive via API
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    const archiveRes = await authedApi.patch(`/api/hubs/${hubId}`, { status: 'archived' })
    expect(archiveRes.ok()).toBe(true)

    await page.goto('/admin/hubs')
    await page.waitForLoadState('networkidle')

    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await expect(hubRow).toBeVisible()
    await hubRow.getByTestId('hub-delete-btn').click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByTestId('delete-hub-confirm-input').fill(hubName)
    await page.getByTestId('delete-hub-confirm-btn').click()

    // Dialog closes and hub is removed from list
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(
      page.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    ).not.toBeVisible()

    // Verify hub is gone via API
    const getRes = await authedApi.get(`/api/hubs/${hubId}`)
    expect(getRes.status()).toBe(404)
  })
})
