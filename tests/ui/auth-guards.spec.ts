import { expect, test } from '../fixtures/auth'

test.describe('Auth guards', () => {
  test('unauthenticated user is redirected to login from /', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('unauthenticated user is redirected from /notes', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/notes')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('unauthenticated user is redirected from /settings', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('unauthenticated user is redirected from /admin/settings', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('session requires PIN re-entry after reload', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Reload clears in-memory keyManager; encrypted key persists in localStorage
    await adminPage.reload()

    // Should be redirected to login since keyManager is no longer unlocked
    await expect(adminPage).toHaveURL(/\/login/, { timeout: 10000 })

    // Re-enter PIN to unlock the stored encrypted key
    const { enterPin } = await import('../helpers')
    await enterPin(adminPage, '123456')

    // Should be back on the Dashboard
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 30000,
    })
  })

  test('logout clears session', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Logout
    await adminPage.getByRole('button', { name: /log out/i }).click()
    await expect(adminPage).toHaveURL(/\/login/)

    // Should not be able to access dashboard without re-authenticating
    await adminPage.goto('/')
    await expect(adminPage).toHaveURL(/\/login/)
  })

  test('API returns 401 for unauthenticated requests', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    // Direct API call without auth
    const response = await page.request.get('/api/users')
    expect(response.status()).toBe(401)
    await ctx.close()
  })
})
