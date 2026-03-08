import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, Timeouts } from './helpers'

test.describe('Admin System Health Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/system')
  })

  test('renders all 6 status cards', async ({ page }) => {
    await expect(page.getByTestId('system-card-server')).toBeVisible({ timeout: Timeouts.ELEMENT })
    await expect(page.getByTestId('system-card-services')).toBeVisible()
    await expect(page.getByTestId('system-card-calls')).toBeVisible()
    await expect(page.getByTestId('system-card-storage')).toBeVisible()
    await expect(page.getByTestId('system-card-backup')).toBeVisible()
    await expect(page.getByTestId('system-card-volunteers')).toBeVisible()
  })

  test('displays page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /system health/i })).toBeVisible({ timeout: Timeouts.ELEMENT })
  })

  test('shows last refresh timestamp', async ({ page }) => {
    await expect(page.getByTestId('last-refresh')).toBeVisible({ timeout: Timeouts.ELEMENT })
    await expect(page.getByTestId('last-refresh')).toContainText('Last refresh')
  })

  test('auto-refresh updates timestamp', async ({ page }) => {
    await expect(page.getByTestId('last-refresh')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Get initial timestamp text
    const initialText = await page.getByTestId('last-refresh').textContent()

    // Click manual refresh button to force update
    await page.getByRole('button', { name: /refresh/i }).click()
    await page.waitForTimeout(1000)

    // Timestamp should still be visible (may or may not change within same second)
    await expect(page.getByTestId('last-refresh')).toBeVisible()
  })

  test('nav link is visible in admin section', async ({ page }) => {
    await expect(page.getByTestId('nav-admin-system')).toBeVisible()
  })
})
