import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('User flow', () => {
  test('user sees limited navigation', async ({ volunteerPage }) => {
    // Should see Dashboard, Notes, Settings
    await expect(volunteerPage.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(volunteerPage.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(volunteerPage.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Should NOT see admin links
    await expect(volunteerPage.getByRole('link', { name: 'Users' })).not.toBeVisible()
    await expect(volunteerPage.getByRole('link', { name: 'Shifts' })).not.toBeVisible()
    await expect(volunteerPage.getByRole('link', { name: 'Ban List' })).not.toBeVisible()
  })

  test('user can toggle on-break', async ({ volunteerPage }) => {
    // Find the break button
    const breakBtn = volunteerPage.getByRole('button', { name: /take a break/i })
    if (await breakBtn.isVisible()) {
      await breakBtn.click()
      await expect(volunteerPage.getByText('On Break', { exact: true })).toBeVisible()
    }
  })

  test('user cannot access admin pages via URL', async ({ volunteerPage }) => {
    // Use SPA navigation to avoid full page reload clearing the key manager
    await volunteerPage.evaluate(() =>
      (window as Record<string, unknown>).__TEST_ROUTER?.navigate({ to: '/users' })
    )
    await expect(volunteerPage.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })

  test('user cannot access /shifts via URL', async ({ volunteerPage }) => {
    // Use SPA navigation to avoid full page reload clearing the key manager
    await volunteerPage.evaluate(() =>
      (window as Record<string, unknown>).__TEST_ROUTER?.navigate({ to: '/shifts' })
    )
    await expect(volunteerPage.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })

  test('user cannot access /bans via URL', async ({ volunteerPage }) => {
    // Use SPA navigation to avoid full page reload clearing the key manager
    await volunteerPage.evaluate(() =>
      (window as Record<string, unknown>).__TEST_ROUTER?.navigate({ to: '/bans' })
    )
    await expect(volunteerPage.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })

  test('user can navigate to notes', async ({ volunteerPage }) => {
    await volunteerPage.getByRole('link', { name: 'Notes' }).click()
    await expect(volunteerPage.getByRole('heading', { name: /call notes/i })).toBeVisible()
  })

  test('user can navigate to settings', async ({ volunteerPage }) => {
    await volunteerPage.getByRole('link', { name: 'Settings' }).click()
    await expect(
      volunteerPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()
    // Should see transcription toggle but not spam settings (which is on admin settings)
    await expect(volunteerPage.getByRole('heading', { name: 'Spam Mitigation' })).not.toBeVisible()
  })
})
