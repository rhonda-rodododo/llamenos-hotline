import { devices, expect, test } from '@playwright/test'
import { loginAsAdmin, resetTestState } from '../helpers'

test.use(devices['Pixel 7'])

test.beforeEach(async ({ request }) => {
  await resetTestState(request)
})

test('mobile viewport shows hamburger menu', async ({ page }) => {
  await loginAsAdmin(page)

  // Hamburger button should be visible on mobile
  await expect(page.getByRole('button', { name: /open menu/i })).toBeVisible()

  // Sidebar links should be hidden (sidebar is invisible via CSS)
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeHidden()

  // Open the menu
  await page.getByRole('button', { name: /open menu/i }).click()

  // Now sidebar links should be visible
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Notes' })).toBeVisible()

  // Close button should be visible
  await expect(page.getByRole('button', { name: /close sidebar/i })).toBeVisible()
  await page.getByRole('button', { name: /close sidebar/i }).click()

  // Links should be hidden again
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeHidden()
})

test('mobile page has no horizontal overflow', async ({ page }) => {
  await loginAsAdmin(page)

  // Check body doesn't overflow
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1) // +1 for rounding
})

test('mobile navigation works across pages', async ({ page }) => {
  await loginAsAdmin(page)

  // Open menu and navigate to Notes
  await page.getByRole('button', { name: /open menu/i }).click()
  await page.getByRole('link', { name: 'Notes' }).click()
  await expect(page.getByRole('heading', { name: /notes/i })).toBeVisible()

  // Menu should auto-close after navigation
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeHidden()

  // Navigate to Volunteers
  await page.getByRole('button', { name: /open menu/i }).click()
  await page.getByRole('link', { name: 'Volunteers' }).click()
  await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()
})

test('mobile pages have no horizontal overflow across routes', async ({ page }) => {
  await loginAsAdmin(page)

  const routes = ['/notes', '/volunteers', '/admin/settings']
  for (const route of routes) {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth, `Overflow on ${route}`).toBeLessThanOrEqual(viewportWidth + 1)
  }
})
