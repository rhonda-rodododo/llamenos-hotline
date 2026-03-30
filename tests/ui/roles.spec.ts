import { expect, test } from '@playwright/test'
import {
  completeProfileSetup,
  createUserAndGetNsec,
  loginAsAdmin,
  loginAsUser,
  navigateAfterLogin,
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

// --- Role Editor: Permission Metadata Rendering ---

test.describe('Role Editor — Permission Metadata UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('Roles & Permissions section renders in Hub Settings', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    // Look for the Roles section
    await expect(page.getByText('Roles & Permissions')).toBeVisible()
  })

  test('role list includes Case Manager and Voicemail Reviewer roles', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/settings?section=roles')
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    // Expand the Roles section if needed
    await page.getByText('Roles & Permissions').click()

    // Default roles should be listed
    await expect(page.getByText('Case Manager')).toBeVisible()
    await expect(page.getByText('Voicemail Reviewer')).toBeVisible()
    await expect(page.getByText('Volunteer')).toBeVisible()
    await expect(page.getByText('Hub Admin')).toBeVisible()
  })

  test('Create Role button opens editor with permission domains', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/settings?section=roles')
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    // Expand the Roles section
    await page.getByText('Roles & Permissions').click()
    await expect(page.getByTestId('create-role-btn')).toBeVisible()
    await page.getByTestId('create-role-btn').click()

    // Permission group labels should render with human-friendly names, not raw domains
    await expect(page.getByText('Contact Directory')).toBeVisible()
    await expect(page.getByText('User Management')).toBeVisible()
    await expect(page.getByText('Audit Log')).toBeVisible()
    await expect(page.getByText('GDPR / Privacy')).toBeVisible()

    // Domain sections should be present via data-testid
    await expect(page.getByTestId('permission-domain-contacts')).toBeVisible()
    await expect(page.getByTestId('permission-domain-notes')).toBeVisible()
    await expect(page.getByTestId('permission-domain-calls')).toBeVisible()
    await expect(page.getByTestId('permission-domain-users')).toBeVisible()
  })

  test('expanding contacts domain shows scope radio buttons, tier checkboxes, and action checkboxes', async ({
    page,
  }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/settings?section=roles')
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    // Expand Roles section and open Create Role editor
    await page.getByText('Roles & Permissions').click()
    await page.getByTestId('create-role-btn').click()

    // Expand the contacts domain
    const contactsDomain = page.getByTestId('permission-domain-contacts')
    await contactsDomain.click()

    // Scope radio buttons should exist (data-testid="scope-<perm-key>")
    await expect(page.getByTestId('scope-contacts:read-own')).toBeVisible()
    await expect(page.getByTestId('scope-contacts:read-assigned')).toBeVisible()
    await expect(page.getByTestId('scope-contacts:read-all')).toBeVisible()
    await expect(page.getByTestId('scope-contacts:update-own')).toBeVisible()
    await expect(page.getByTestId('scope-contacts:update-assigned')).toBeVisible()
    await expect(page.getByTestId('scope-contacts:update-all')).toBeVisible()

    // Tier checkboxes (data-testid="tier-<perm-key>")
    await expect(page.getByTestId('tier-contacts:envelope-summary')).toBeVisible()
    await expect(page.getByTestId('tier-contacts:envelope-full')).toBeVisible()

    // Action checkboxes (data-testid="action-<perm-key>")
    await expect(page.getByTestId('action-contacts:create')).toBeVisible()
    await expect(page.getByTestId('action-contacts:update-summary')).toBeVisible()
    await expect(page.getByTestId('action-contacts:update-pii')).toBeVisible()
    await expect(page.getByTestId('action-contacts:delete')).toBeVisible()
    await expect(page.getByTestId('action-contacts:link')).toBeVisible()
  })

  test('cancel button closes the editor without creating a role', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/settings?section=roles')
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    await page.getByText('Roles & Permissions').click()
    await page.getByTestId('create-role-btn').click()

    // Editor should be visible
    await expect(page.getByTestId('save-role-btn')).toBeVisible()

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click()

    // Editor should be gone, create button back
    await expect(page.getByTestId('create-role-btn')).toBeVisible()
    await expect(page.getByTestId('save-role-btn')).not.toBeVisible()
  })
})
