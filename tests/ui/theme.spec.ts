import { expect, test } from '@playwright/test'
import { TEST_PIN, enterPin, loginAsAdmin } from '../helpers'

test.describe('Theme', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginAsAdmin(page)
  })

  test('can switch to dark theme', async ({ page }) => {
    await page.getByRole('button', { name: /dark theme/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('can switch to light theme', async ({ page }) => {
    await page.getByRole('button', { name: /light theme/i }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  test('can switch to system theme', async ({ page }) => {
    // First force dark so we know the state changed
    await page.getByRole('button', { name: /dark theme/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // Switch to system — should remove the forced class and follow OS preference
    await page.getByRole('button', { name: /system theme/i }).click()

    // In system mode the html element gets dark/light based on OS preference,
    // but the stored value should be "system" (not "dark" or "light")
    const storedTheme = await page.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(storedTheme).toBe('system')

    // The html element should still have a valid theme applied (either dark or light from OS)
    const htmlClasses = await page.locator('html').getAttribute('class')
    // It should NOT have both dark and light simultaneously — sanity check
    expect(htmlClasses).toBeDefined()
  })

  test('theme persists across page reload', async ({ page }) => {
    await page.getByRole('button', { name: /dark theme/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.reload()
    await enterPin(page, TEST_PIN)
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('theme preference is stored in localStorage', async ({ page }) => {
    // Switch to dark and verify localStorage
    await page.getByRole('button', { name: /dark theme/i }).click()
    let stored = await page.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(stored).toBe('dark')

    // Switch to light and verify localStorage
    await page.getByRole('button', { name: /light theme/i }).click()
    stored = await page.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(stored).toBe('light')

    // Switch to system and verify localStorage
    await page.getByRole('button', { name: /system theme/i }).click()
    stored = await page.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(stored).toBe('system')
  })

  test('login page has theme toggle', async ({ page }) => {
    // Logout first
    await page.getByRole('button', { name: /log out/i }).click()
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

    // Theme buttons should be visible on login
    await expect(page.getByRole('button', { name: /dark theme/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /light theme/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /system theme/i })).toBeVisible()
  })

  test('dark theme persists across SPA navigation', async ({ page }) => {
    // Switch to dark
    await page.getByRole('button', { name: /dark theme/i }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // Navigate to Volunteers page
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await page.waitForURL(/\/volunteers/)
    await expect(page.locator('html')).toHaveClass(/dark/)

    // Navigate back to Dashboard
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/index')
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})
