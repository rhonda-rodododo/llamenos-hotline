import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsVolunteer, createVolunteerAndGetNsec, completeProfileSetup, resetTestState, uniquePhone } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'
import { ADMIN_NSEC } from '../helpers'

/**
 * Helper to make authenticated API calls from the browser context.
 * Used only for test setup (creating/assigning roles) within UI test beforeAll hooks.
 */
async function apiCall(page: import('@playwright/test').Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body }) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    // Try session token first (WebAuthn sessions)
    const sessionToken = sessionStorage.getItem('llamenos-session-token')
    if (sessionToken) {
      headers['Authorization'] = `Session ${sessionToken}`
    } else {
      // Use the test key manager exposed by main.tsx
      const km = (window as any).__TEST_KEY_MANAGER
      if (km?.isUnlocked?.()) {
        try {
          const token = km.createAuthToken(Date.now(), method, `/api${path}`)
          headers['Authorization'] = `Bearer ${token}`
        } catch { /* key locked or unavailable */ }
      }
    }

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }, { method, path, body })
}

// --- Role-based UI navigation ---

test.describe('Role-based UI visibility', () => {
  let reporterNsec: string

  test.beforeAll(async ({ browser, request }) => {
    await resetTestState(request)

    const page = await browser.newPage()
    await loginAsAdmin(page)
    reporterNsec = await createVolunteerAndGetNsec(page, 'UI Reporter', uniquePhone())
    const listResult = await apiCall(page, 'GET', '/volunteers')
    const reporter = listResult.body.volunteers.find((v: { name: string }) => v.name === 'UI Reporter')
    await apiCall(page, 'PATCH', `/volunteers/${reporter.pubkey}`, {
      roles: ['role-reporter'],
    })
    await page.close()
  })

  test('reporter sees reports UI, not call/volunteer management', async ({ page }) => {
    await loginAsVolunteer(page, reporterNsec)
    await completeProfileSetup(page)

    // Reporter should see Reports link
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible()

    // Reporter should NOT see volunteer management links
    await expect(page.getByRole('link', { name: 'Volunteers' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Shifts' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Ban List' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Audit Log' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Hub Settings' })).not.toBeVisible()

    // Reporter should NOT see call-related links
    await expect(page.getByRole('link', { name: 'Notes' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Call History' })).not.toBeVisible()
  })

  test('admin sees all navigation items', async ({ page }) => {
    await loginAsAdmin(page)

    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Volunteers' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Shifts' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ban List' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Call History' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Audit Log' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Hub Settings' })).toBeVisible()
  })
})

// --- Role Assignment UI ---

test.describe('Role Assignment UI', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test('role selector dropdown in volunteer list shows all default roles', async ({ page }) => {
    await loginAsAdmin(page)
    await createVolunteerAndGetNsec(page, 'RoleUI Vol', uniquePhone())
    await page.getByText('Close').click()

    // Find the role selector trigger (the Select with aria-label "Change role")
    const roleSelector = page.getByRole('combobox', { name: /change role/i }).first()
    await expect(roleSelector).toBeVisible()
    await roleSelector.click()

    // All 5 default roles should be visible in the dropdown
    await expect(page.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reviewer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reporter' })).toBeVisible()

    // Close the dropdown by pressing Escape
    await page.keyboard.press('Escape')
  })

  test('changing a volunteer role from Volunteer to Hub Admin via dropdown', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await expect(page.getByText('RoleUI Vol')).toBeVisible()

    // Find the specific row containing "RoleUI Vol" text — use the row-level container
    const volText = page.getByText('RoleUI Vol')
    const volRow = page.locator('.divide-y > div').filter({ has: volText })
    const roleSelector = volRow.getByRole('combobox', { name: /change role/i })
    await roleSelector.click()

    // Select Hub Admin
    await page.getByRole('option', { name: 'Hub Admin' }).click()

    // Verify the badge now shows Hub Admin
    await expect(volRow.locator('[data-slot="badge"]').filter({ hasText: 'Hub Admin' })).toBeVisible()
  })

  test('Hub Admin badge displays correctly after role change', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Volunteers' }).click()

    const volText = page.getByText('RoleUI Vol')
    const volRow = page.locator('.divide-y > div').filter({ has: volText })

    // The badge should show "Hub Admin"
    await expect(volRow.locator('[data-slot="badge"]').filter({ hasText: 'Hub Admin' })).toBeVisible()
  })

  test('Add Volunteer form shows all available roles', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await page.getByRole('button', { name: /add volunteer/i }).click()

    // Click the role dropdown
    const roleDropdown = page.locator('#vol-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(page.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reviewer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('Invite form shows all available roles', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await page.getByRole('button', { name: /invite volunteer/i }).click()

    // Click the role dropdown
    const roleDropdown = page.locator('#invite-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(page.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reviewer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /cancel/i }).click()
  })
})
