import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsVolunteer, createVolunteerAndGetNsec, dismissNsecCard, resetTestState, uniquePhone, completeProfileSetup, navigateAfterLogin } from './helpers'

test.describe('Audit log', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTestState(request)
    await loginAsAdmin(page)
  })

  test('page loads with heading and layout', async ({ page }) => {
    await page.getByRole('link', { name: 'Audit Log' }).click()
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()
  })

  test('shows entries after hub-scoped admin actions', async ({ page }) => {
    // Create a ban (hub-scoped action that generates audit entries for default-hub)
    await page.getByRole('link', { name: 'Ban List' }).click()
    await expect(page.getByRole('heading', { name: /ban list/i })).toBeVisible()
    await page.getByRole('button', { name: /ban number/i }).click()
    await page.getByLabel('Phone Number').fill('+15551234567')
    await page.getByLabel('Phone Number').blur()
    await page.getByLabel('Reason').fill('Audit test')
    await page.getByRole('button', { name: /save/i }).click()
    await page.waitForTimeout(1000)

    // Navigate to audit log — should now have entries
    await page.getByRole('link', { name: 'Audit Log' }).click()
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()

    // Wait for entries to appear (ban action should create an audit entry)
    await expect(page.getByText(/banned/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('filter bar is visible with all controls', async ({ page }) => {
    await page.getByRole('link', { name: 'Audit Log' }).click()
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()

    // Filter controls should be present
    await expect(page.getByPlaceholder(/search/i)).toBeVisible()
    // Event type dropdown
    await expect(page.getByText(/all events/i).first()).toBeVisible()
  })

  test('volunteer sees access denied on audit page', async ({ page }) => {
    const phone = uniquePhone()
    const name = `AuditVol ${Date.now()}`
    const nsec = await createVolunteerAndGetNsec(page, name, phone)
    await dismissNsecCard(page)

    // Log in as the volunteer
    await loginAsVolunteer(page, nsec)
    await completeProfileSetup(page)

    // Try to access audit log
    await navigateAfterLogin(page, '/audit')
    // Volunteer should either be redirected or see access denied / empty state
    const heading = page.getByRole('heading', { name: /audit log/i })
    const isVisible = await heading.isVisible({ timeout: 3000 }).catch(() => false)
    // Whether redirected or shown the page, the volunteer should not see real audit entries
    if (isVisible) {
      // If shown the page, entries should be empty or access denied
      await expect(page.getByText(/no audit log entries|access denied|forbidden/i)).toBeVisible({ timeout: 5000 })
    }
    // If not visible (redirected), that's also correct behavior
  })

  test('search filter input works', async ({ page }) => {
    await page.getByRole('link', { name: 'Audit Log' }).click()
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()

    // Type in search box
    const searchBox = page.getByPlaceholder(/search/i)
    await searchBox.fill('nonexistent-event-xyz')
    await page.waitForTimeout(500)

    // Should show "no entries" state since search won't match
    await expect(page.getByText(/no audit log entries/i)).toBeVisible({ timeout: 5000 })
  })

  test('audit log API returns array', async ({ page, request }) => {
    // Verify the audit log API returns the expected shape
    const res = await request.get('/api/audit')
    // Super admin can access global audit (may return entries or empty)
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('entries')
      expect(Array.isArray(body.entries)).toBe(true)
    } else {
      // 400 = hub context required (non-super-admin), 401 = not authenticated
      expect([400, 401]).toContain(res.status())
    }
  })
})
