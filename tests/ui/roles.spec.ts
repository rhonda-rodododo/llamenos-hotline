import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

// --- Role-based UI navigation ---

test.describe('Role-based UI visibility', () => {
  test('reporter sees reports UI, not call/user management', async ({ reporterPage }) => {
    // Reporter should see Reports link
    await expect(reporterPage.getByRole('link', { name: 'Reports' })).toBeVisible()

    // Reporter should NOT see user management links
    await expect(reporterPage.getByRole('link', { name: 'Users' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Shifts' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Ban List' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Audit Log' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Hub Settings' })).not.toBeVisible()

    // Reporter should NOT see call-related links
    await expect(reporterPage.getByRole('link', { name: 'Notes' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Call History' })).not.toBeVisible()
  })

  test('admin sees all navigation items', async ({ adminPage }) => {
    await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Shifts' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Ban List' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Call History' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Audit Log' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Hub Settings' })).toBeVisible()
  })
})

// --- Role Assignment UI ---

test.describe('Role Assignment UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('role selector dropdown in user list shows all default roles', async ({ adminPage }) => {
    // Navigate to users and find a user row with a role selector
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    // Find the role selector trigger (the Select with aria-label "Change role")
    const roleSelector = adminPage.getByRole('combobox', { name: /change role/i }).first()
    await expect(roleSelector).toBeVisible()
    await roleSelector.click()

    // All 5 default roles should be visible in the dropdown
    await expect(adminPage.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reporter' })).toBeVisible()

    // Close the dropdown by pressing Escape
    await adminPage.keyboard.press('Escape')
  })

  test('Add User form shows all available roles', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /add user/i }).click()

    // Click the role dropdown
    const roleDropdown = adminPage.locator('#vol-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(adminPage.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await adminPage.keyboard.press('Escape')
    await adminPage.getByRole('button', { name: /cancel/i }).click()
  })

  test('Invite form shows all available roles', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /invite user/i }).click()

    // Click the role dropdown
    const roleDropdown = adminPage.locator('#invite-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(adminPage.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await adminPage.keyboard.press('Escape')
    await adminPage.getByRole('button', { name: /cancel/i }).click()
  })
})

// --- Role Editor: Permission Metadata Rendering ---

test.describe('Role Editor — Permission Metadata UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('Roles & Permissions section renders in Hub Settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    // Look for the Roles section
    await expect(adminPage.getByText('Roles & Permissions')).toBeVisible()
  })

  test('role list includes Case Manager and Voicemail Reviewer roles', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings?section=roles')
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    // Expand the Roles section if needed
    await adminPage.getByText('Roles & Permissions').click()

    // Default roles should be listed — role names may need hub key decryption under load
    await expect(adminPage.getByText('Case Manager')).toBeVisible({ timeout: 30000 })
    await expect(adminPage.getByText('Voicemail Reviewer')).toBeVisible({ timeout: 15000 })
    await expect(adminPage.getByText('Volunteer').first()).toBeVisible({ timeout: 15000 })
    await expect(adminPage.getByText('Hub Admin').first()).toBeVisible({ timeout: 15000 })
  })

  test('Create Role button opens editor with permission domains', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings?section=roles')
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    // Expand the Roles section
    await adminPage.getByText('Roles & Permissions').click()
    await expect(adminPage.getByTestId('create-role-btn')).toBeVisible({ timeout: 15000 })
    await adminPage.getByTestId('create-role-btn').click()

    // Permission group labels should render with human-friendly names, not raw domains
    await expect(adminPage.getByText('Contact Directory')).toBeVisible({ timeout: 15000 })
    await expect(adminPage.getByText('User Management')).toBeVisible()
    await expect(adminPage.getByText('Audit Log')).toBeVisible()
    await expect(adminPage.getByText('GDPR / Privacy')).toBeVisible()

    // Domain sections should be present via data-testid
    await expect(adminPage.getByTestId('permission-domain-contacts')).toBeVisible()
    await expect(adminPage.getByTestId('permission-domain-notes')).toBeVisible()
    await expect(adminPage.getByTestId('permission-domain-calls')).toBeVisible()
    await expect(adminPage.getByTestId('permission-domain-users')).toBeVisible()
  })

  test('expanding contacts domain shows scope radio buttons, tier checkboxes, and action checkboxes', async ({
    adminPage,
  }) => {
    await navigateAfterLogin(adminPage, '/admin/settings?section=roles')
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    // Expand Roles section and open Create Role editor
    await adminPage.getByText('Roles & Permissions').click()
    await adminPage.getByTestId('create-role-btn').click()

    // Expand the contacts domain
    const contactsDomain = adminPage.getByTestId('permission-domain-contacts')
    await contactsDomain.click()

    // Scope radio buttons should exist (data-testid="scope-<perm-key>")
    await expect(adminPage.getByTestId('scope-contacts:read-own')).toBeVisible()
    await expect(adminPage.getByTestId('scope-contacts:read-assigned')).toBeVisible()
    await expect(adminPage.getByTestId('scope-contacts:read-all')).toBeVisible()
    await expect(adminPage.getByTestId('scope-contacts:update-own')).toBeVisible()
    await expect(adminPage.getByTestId('scope-contacts:update-assigned')).toBeVisible()
    await expect(adminPage.getByTestId('scope-contacts:update-all')).toBeVisible()

    // Tier checkboxes (data-testid="tier-<perm-key>")
    await expect(adminPage.getByTestId('tier-contacts:envelope-summary')).toBeVisible()
    await expect(adminPage.getByTestId('tier-contacts:envelope-full')).toBeVisible()

    // Action checkboxes (data-testid="action-<perm-key>")
    await expect(adminPage.getByTestId('action-contacts:create')).toBeVisible()
    await expect(adminPage.getByTestId('action-contacts:update-summary')).toBeVisible()
    await expect(adminPage.getByTestId('action-contacts:update-pii')).toBeVisible()
    await expect(adminPage.getByTestId('action-contacts:delete')).toBeVisible()
    await expect(adminPage.getByTestId('action-contacts:link')).toBeVisible()
  })

  test('cancel button closes the editor without creating a role', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/settings?section=roles')
    await expect(
      adminPage.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible()

    await adminPage.getByText('Roles & Permissions').click()
    await adminPage.getByTestId('create-role-btn').click()

    // Editor should be visible
    await expect(adminPage.getByTestId('save-role-btn')).toBeVisible()

    // Click cancel
    await adminPage.getByRole('button', { name: /cancel/i }).click()

    // Editor should be gone, create button back
    await expect(adminPage.getByTestId('create-role-btn')).toBeVisible()
    await expect(adminPage.getByTestId('save-role-btn')).not.toBeVisible()
  })
})
