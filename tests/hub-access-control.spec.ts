/**
 * Hub Admin Zero-Trust Visibility — E2E Tests
 *
 * Verifies that:
 *   - New hubs default to allowSuperAdminAccess = false
 *   - Hub admins can toggle super admin access via the UI
 *   - Hub admins can disable super admin access after enabling
 *   - Super admins cannot self-grant access via the API
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin, resetTestState, navigateAfterLogin, Timeouts } from './helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

async function injectAuthedFetch(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.__authedFetch = async (url: string, options: RequestInit = {}) => {
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      }
      if (km?.isUnlocked()) {
        const reqMethod = (options.method || 'GET').toUpperCase()
        const reqPath = new URL(url, location.origin).pathname
        const token = km.createAuthToken(Date.now(), reqMethod, reqPath)
        headers['Authorization'] = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    }
  })
}

test.describe('Hub admin zero-trust visibility', () => {
  test.describe.configure({ mode: 'serial' })

  /** Hub created for the test suite — shared across all tests */
  let testHubId: string
  const testHubName = `access-ctrl-${Date.now()}`

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
  })

  // ─── Test 1: Default is restricted ──────────────────────────────────────────

  test('newly created hub defaults to allowSuperAdminAccess = false', async ({ page }) => {
    // Create a hub via API
    const created = await page.evaluate(async (hubName: string) => {
      const res = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: hubName }),
      })
      if (!res.ok) throw new Error(`createHub failed: ${res.status} ${await res.text()}`)
      return res.json()
    }, testHubName)

    expect(created).toHaveProperty('hub')
    testHubId = created.hub.id

    // Verify via GET that allowSuperAdminAccess defaults to false
    const fetched = await page.evaluate(async (hubId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hubId}`)
      return res.json()
    }, testHubId)

    expect(fetched.hub.allowSuperAdminAccess).toBe(false)

    // Also verify in the hubs list UI — the badge should show "restricted"
    await navigateAfterLogin(page, '/admin/hubs')
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: testHubName })
    await expect(hubRow).toBeVisible({ timeout: Timeouts.ELEMENT })
    const accessBadge = hubRow.getByTestId('hub-access-badge')
    await expect(accessBadge).toBeVisible()
  })

  // ─── Test 2: Hub admin can toggle super admin access ON ─────────────────────

  test('hub admin can enable super admin access via the edit dialog', async ({ page }) => {
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

    // Verify the change persisted by reloading and checking via API
    const fetched = await page.evaluate(async (hubId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hubId}`)
      return res.json()
    }, testHubId)

    expect(fetched.hub.allowSuperAdminAccess).toBe(true)
  })

  // ─── Test 3: Hub admin can disable super admin access ───────────────────────

  test('hub admin can disable super admin access after enabling', async ({ page }) => {
    // First confirm it is currently enabled (from test 2)
    const before = await page.evaluate(async (hubId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hubId}`)
      return res.json()
    }, testHubId)
    expect(before.hub.allowSuperAdminAccess).toBe(true)

    await navigateAfterLogin(page, '/admin/hubs')

    // Open the edit dialog
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: testHubName })
    await expect(hubRow).toBeVisible({ timeout: Timeouts.ELEMENT })
    await hubRow.getByRole('button', { name: /edit/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Toggle should be ON — click to disable
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
    const after = await page.evaluate(async (hubId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hubId}`)
      return res.json()
    }, testHubId)

    expect(after.hub.allowSuperAdminAccess).toBe(false)
  })

  // ─── Test 4: Super admin cannot self-grant via API ──────────────────────────

  test('super admin cannot self-grant hub access via PATCH /api/hubs/:hubId/settings', async ({ page }) => {
    // The admin user IS the super admin — attempt to self-grant should be blocked
    const result = await page.evaluate(async (hubId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hubId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ allowSuperAdminAccess: true }),
      })
      return { status: res.status, body: await res.json() }
    }, testHubId)

    expect(result.status).toBe(403)
    expect(result.body.error).toContain('Super admin cannot modify')
  })
})
