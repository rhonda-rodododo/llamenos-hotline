import { expect, test } from '@playwright/test'
import {
  completeProfileSetup,
  createUserAndGetNsec,
  loginAsAdmin,
  loginAsUser,
  uniquePhone,
} from '../helpers'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

// --- Role-based UI navigation ---

test.describe('Role-based UI visibility', () => {
  let reporterNsec: string

  test.beforeAll(async ({ browser, request }) => {
    const page = await browser.newPage()
    await loginAsAdmin(page)
    reporterNsec = await createUserAndGetNsec(page, 'UI Reporter', uniquePhone())
    await page.close()

    // Derive pubkey from nsec and assign reporter role via server-side authed request
    // (avoids browser-side name matching which fails because names are now E2EE)
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const reporterApi = createAuthedRequestFromNsec(request, reporterNsec)
    await adminApi.patch(`/api/users/${reporterApi.pubkey}`, {
      roles: ['role-reporter'],
    })
  })

  test('reporter sees reports UI, not call/user management', async ({ page }) => {
    await loginAsUser(page, reporterNsec)
    await completeProfileSetup(page)

    // Reporter should see Reports link
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible()

    // Reporter should NOT see user management links
    await expect(page.getByRole('link', { name: 'Users' })).not.toBeVisible()
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
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
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

  test('role selector dropdown in user list shows all default roles', async ({ page }) => {
    await loginAsAdmin(page)
    await createUserAndGetNsec(page, 'RoleUI Vol', uniquePhone())
    await page.getByText('Close').click()

    // Find the role selector trigger (the Select with aria-label "Change role")
    const roleSelector = page.getByRole('combobox', { name: /change role/i }).first()
    await expect(roleSelector).toBeVisible()
    await roleSelector.click()

    // All 5 default roles should be visible in the dropdown
    await expect(page.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reporter' })).toBeVisible()

    // Close the dropdown by pressing Escape
    await page.keyboard.press('Escape')
  })

  test('changing a user role from Volunteer to Hub Admin via dropdown', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Users' }).click()
    await expect(page.getByText('RoleUI Vol')).toBeVisible()

    // Find the specific row containing "RoleUI Vol" text — use the row-level container
    const volText = page.getByText('RoleUI Vol')
    const volRow = page.locator('.divide-y > div').filter({ has: volText })
    const roleSelector = volRow.getByRole('combobox', { name: /change role/i })
    await roleSelector.click()

    // Select Hub Admin
    await page.getByRole('option', { name: 'Hub Admin' }).click()

    // Verify the badge now shows Hub Admin
    await expect(
      volRow.locator('[data-slot="badge"]').filter({ hasText: 'Hub Admin' })
    ).toBeVisible()
  })

  test('Hub Admin badge displays correctly after role change', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Users' }).click()

    const volText = page.getByText('RoleUI Vol')
    const volRow = page.locator('.divide-y > div').filter({ has: volText })

    // The badge should show "Hub Admin"
    await expect(
      volRow.locator('[data-slot="badge"]').filter({ hasText: 'Hub Admin' })
    ).toBeVisible()
  })

  test('Add User form shows all available roles', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Users' }).click()
    await page.getByRole('button', { name: /add user/i }).click()

    // Click the role dropdown
    const roleDropdown = page.locator('#vol-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(page.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('Invite form shows all available roles', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Users' }).click()
    await page.getByRole('button', { name: /invite user/i }).click()

    // Click the role dropdown
    const roleDropdown = page.locator('#invite-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(page.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /cancel/i }).click()
  })
})
