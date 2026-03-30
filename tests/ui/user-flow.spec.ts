import { expect, test } from '@playwright/test'
import {
  completeProfileSetup,
  createUserAndGetNsec,
  loginAsAdmin,
  loginAsUser,
  uniquePhone,
} from '../helpers'

test.describe('User flow', () => {
  let userNsec: string
  let userPhone: string

  test.beforeAll(async ({ browser }) => {
    // Create a user via admin
    const page = await browser.newPage()
    userPhone = uniquePhone()
    await loginAsAdmin(page)
    userNsec = await createUserAndGetNsec(page, 'E2E Vol', userPhone)
    await page.close()
  })

  test('user can login', async ({ page }) => {
    await loginAsUser(page, userNsec)
    // Should be on profile-setup or dashboard
    await expect(page).toHaveURL(/\/(profile-setup)?$/)
  })

  test('user completes profile setup', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  })

  test('user sees limited navigation', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Should see Dashboard, Notes, Settings
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Should NOT see admin links
    await expect(page.getByRole('link', { name: 'Users' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Shifts' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Ban List' })).not.toBeVisible()
  })

  test('user can toggle on-break', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Find the break button
    const breakBtn = page.getByRole('button', { name: /take a break/i })
    if (await breakBtn.isVisible()) {
      await breakBtn.click()
      await expect(page.getByText('On Break', { exact: true })).toBeVisible()
    }
  })

  test('user cannot access admin pages via URL', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Use SPA navigation to avoid full page reload clearing the key manager
    await page.evaluate(() => (window as any).__TEST_ROUTER?.navigate({ to: '/users' }))
    await expect(page.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })

  test('user cannot access /shifts via URL', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Use SPA navigation to avoid full page reload clearing the key manager
    await page.evaluate(() => (window as any).__TEST_ROUTER?.navigate({ to: '/shifts' }))
    await expect(page.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })

  test('user cannot access /bans via URL', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Use SPA navigation to avoid full page reload clearing the key manager
    await page.evaluate(() => (window as any).__TEST_ROUTER?.navigate({ to: '/bans' }))
    await expect(page.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })

  test('user can navigate to notes', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()
  })

  test('user can navigate to settings', async ({ page }) => {
    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Account Settings', exact: true })).toBeVisible()
    // Should see transcription toggle but not spam settings (which is on admin settings)
    await expect(page.getByRole('heading', { name: 'Spam Mitigation' })).not.toBeVisible()
  })
})
