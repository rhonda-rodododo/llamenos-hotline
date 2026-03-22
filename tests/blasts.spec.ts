import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, resetTestState } from './helpers'

test.describe('Message Blasts', () => {
  test.beforeEach(async ({ request }) => {
    await resetTestState(request)
  })

  test('blasts page loads for admin', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({ timeout: 10000 })
  })

  test('can open blast composer', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible()

    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible()
    await expect(page.getByTestId('blast-text')).toBeVisible()
  })

  test('subscriber manager loads', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible()

    await page.getByRole('button', { name: /subscribers/i }).click()
    await expect(page.getByText(/subscriber list/i)).toBeVisible({ timeout: 10000 })
  })
})
