import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Blast campaign UI', () => {
  test('blasts page loads for admin', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/blasts')
    await expect(adminPage.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
      timeout: 10000,
    })
  })

  test('create a blast via composer UI', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/blasts')
    await expect(adminPage.getByRole('heading', { name: 'Message Blasts' })).toBeVisible()

    await adminPage.getByRole('button', { name: /new blast/i }).click()
    await expect(adminPage.getByTestId('blast-name')).toBeVisible({ timeout: 10000 })

    const blastName = `UI Test Campaign ${Date.now()}`
    await adminPage.getByTestId('blast-name').fill(blastName)
    await adminPage.getByTestId('blast-text').fill('Hello from the E2E test campaign')

    // Save/create the blast and wait for the API response
    await Promise.all([
      adminPage.waitForResponse(
        (res) =>
          res.url().includes('/blasts') && res.request().method() === 'POST' && res.status() < 400
      ),
      adminPage.getByRole('button', { name: /save|create/i }).click(),
    ])

    // Blast should appear in the list
    await expect(adminPage.getByText(blastName).first()).toBeVisible({ timeout: 10000 })
  })
})
