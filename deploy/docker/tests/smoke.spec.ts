import { test, expect } from '@playwright/test'
import { loginAsAdmin, Timeouts } from './helpers'

test.describe('Smoke Tests', () => {
  test('app loads and shows login page', async ({ page }) => {
    await page.goto('/')
    // Unauthenticated users should be redirected to /login or /setup
    await expect(page).toHaveURL(/\/(login|setup)/, { timeout: Timeouts.NAVIGATION })
  })

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: Timeouts.ELEMENT })
  })

  test('admin can log in with PIN', async ({ page }) => {
    await loginAsAdmin(page)
    // Dashboard should be visible after login
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('API health endpoint works', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  test('config endpoint returns hotline info', async ({ request }) => {
    const res = await request.get('/api/config')
    expect(res.ok()).toBeTruthy()
    const config = await res.json()
    expect(config.adminPubkey).toBeTruthy()
  })

  test('navigation sidebar shows admin links', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Volunteers' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Shifts' })).toBeVisible()
  })
})
