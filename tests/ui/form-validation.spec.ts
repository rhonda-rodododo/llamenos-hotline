import { expect, test } from '../fixtures/auth'
import { uniquePhone } from '../helpers'

test.describe('Form validation', () => {
  test('user form rejects invalid phone', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /add user/i }).click()

    await adminPage.getByLabel('Name').fill('Test')
    // PhoneInput strips non-digits; use a too-short number that fails E.164 validation
    await adminPage.getByLabel('Phone Number').fill('+123')
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible()
  })

  test('user form rejects phone without plus prefix', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /add user/i }).click()

    await adminPage.getByLabel('Name').fill('Test')
    // PhoneInput auto-prepends +, so '1234' becomes '+1234' which is too short for E.164
    await adminPage.getByLabel('Phone Number').fill('1234')
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible()
  })

  test('user form accepts valid E.164 phone', async ({ adminPage }) => {
    const phone = uniquePhone()
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /add user/i }).click()

    await adminPage.getByLabel('Name').fill('Valid Phone Test')
    await adminPage.getByLabel('Phone Number').fill(phone)
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Should show nsec (success)
    await expect(adminPage.getByText(/nsec1/)).toBeVisible({ timeout: 15000 })
  })

  test('ban form rejects invalid phone', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await adminPage.getByRole('button', { name: /ban number/i }).click()

    // PhoneInput strips non-digits; use a too-short number
    await adminPage.getByLabel('Phone Number').fill('+123')
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByLabel('Reason').fill('Test reason')
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible()
  })

  test('ban form rejects short phone numbers', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await adminPage.getByRole('button', { name: /ban number/i }).click()

    await adminPage.getByLabel('Phone Number').fill('+123')
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByLabel('Reason').fill('Test reason')
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible()
  })

  test('login rejects nsec without nsec prefix', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /log out/i }).click()
    // After logout, encrypted key is still in localStorage so PIN view shows.
    // Click "Recovery options" to access the nsec input.
    await adminPage.getByRole('button', { name: /recovery options/i }).click()
    await adminPage.locator('#nsec').fill('npub1abc123')
    await adminPage.getByRole('button', { name: /log in/i }).click()
    await expect(adminPage.getByText(/invalid/i)).toBeVisible()
  })

  test('login rejects very short nsec', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /log out/i }).click()
    await adminPage.getByRole('button', { name: /recovery options/i }).click()
    await adminPage.locator('#nsec').fill('nsec1short')
    await adminPage.getByRole('button', { name: /log in/i }).click()
    await expect(adminPage.getByText(/invalid/i)).toBeVisible()
  })

  test('bulk ban import validates phone format', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await adminPage.getByRole('button', { name: /import/i }).click()

    await adminPage.locator('textarea').fill('not-a-phone\n+invalid')
    await adminPage.getByLabel('Reason').fill('Test reason')
    await adminPage.getByRole('button', { name: /submit/i }).click()

    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible()
  })
})
