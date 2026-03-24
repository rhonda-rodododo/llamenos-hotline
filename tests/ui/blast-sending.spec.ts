import { expect, test } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin } from '../helpers'

test.describe('Blast campaign UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('blasts page loads for admin', async ({ page }) => {
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
      timeout: 10000,
    })
  })

  test('create a blast via composer UI', async ({ page }) => {
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible()

    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: 10000 })

    const blastName = `UI Test Campaign ${Date.now()}`
    await page.getByTestId('blast-name').fill(blastName)
    await page.getByTestId('blast-text').fill('Hello from the E2E test campaign')

    // Save/create the blast
    await page.getByRole('button', { name: /save|create/i }).click()

    // Blast should appear in the list
    await expect(page.getByText(blastName).first()).toBeVisible({ timeout: 10000 })
  })
})
