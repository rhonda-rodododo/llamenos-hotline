import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin, uniquePhone } from '../helpers'

test.describe('Ban management', () => {
  test.beforeEach(async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await expect(adminPage.getByRole('heading', { name: /ban list/i })).toBeVisible()
  })

  test('page loads with heading and buttons', async ({ adminPage }) => {
    await expect(adminPage.getByRole('button', { name: /ban number/i })).toBeVisible()
    await expect(adminPage.getByRole('button', { name: /import ban/i })).toBeVisible()
  })

  test('page loads with ban list or empty state', async ({ adminPage }) => {
    // Either shows existing bans or empty state
    const hasBans = await adminPage
      .locator('.divide-y > div')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    const hasEmptyState = await adminPage
      .getByText(/no banned numbers/i)
      .isVisible()
      .catch(() => false)
    expect(hasBans || hasEmptyState).toBeTruthy()
  })

  test('add ban with phone and reason', async ({ adminPage }) => {
    const phone = uniquePhone()
    await adminPage.getByRole('button', { name: /ban number/i }).click()

    await adminPage.getByLabel(/phone number/i).fill(phone)
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('Spam caller')
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Ban should appear in the list
    await expect(adminPage.getByText(phone)).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText('Spam caller')).toBeVisible()
  })

  test('ban shows date', async ({ adminPage }) => {
    const phone = uniquePhone()
    await adminPage.getByRole('button', { name: /ban number/i }).click()

    await adminPage.getByLabel(/phone number/i).fill(phone)
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('Date check')
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(phone)).toBeVisible({ timeout: 10000 })

    // The ban row should contain a date
    const banRow = adminPage.locator('.divide-y > div').filter({ hasText: phone })
    const text = await banRow.textContent()
    // Should contain today's date in some format (at least the year)
    expect(text).toContain(new Date().getFullYear().toString())
  })

  test('remove ban with confirmation', async ({ adminPage }) => {
    const phone = uniquePhone()

    // Add a ban first
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel(/phone number/i).fill(phone)
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('To remove')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(phone)).toBeVisible({ timeout: 10000 })

    // Click Remove on the ban row
    const banRow = adminPage.locator('.divide-y > div').filter({ hasText: phone })
    await banRow.getByRole('button', { name: 'Remove' }).click()

    // Confirm dialog should appear
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage.getByRole('dialog').getByRole('button', { name: /unban/i }).click()

    // Dialog should close and ban should be gone
    await expect(adminPage.getByRole('dialog')).toBeHidden()
    await expect(adminPage.locator('main').getByText(phone)).not.toBeVisible()
  })

  test('cancel ban removal', async ({ adminPage }) => {
    const phone = uniquePhone()

    // Add a ban
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel(/phone number/i).fill(phone)
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('Keep this')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(phone)).toBeVisible({ timeout: 10000 })

    // Click Remove
    const banRow = adminPage.locator('.divide-y > div').filter({ hasText: phone })
    await banRow.getByRole('button', { name: 'Remove' }).click()

    // Cancel the dialog
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: /cancel/i })
      .click()

    // Ban should still be there
    await expect(adminPage.getByRole('dialog')).toBeHidden()
    await expect(adminPage.getByText(phone)).toBeVisible()
  })

  test('cancel add ban form', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await expect(adminPage.getByLabel(/phone number/i)).toBeVisible()

    await adminPage.getByRole('button', { name: /cancel/i }).click()
    await expect(adminPage.getByLabel(/phone number/i)).not.toBeVisible()
  })

  test('phone validation rejects invalid numbers', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /ban number/i }).click()

    // Use a too-short phone number
    await adminPage.getByLabel(/phone number/i).fill('+12')
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('Bad phone')
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Should show validation error
    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible({ timeout: 5000 })
  })

  test('multiple bans display in list', async ({ adminPage }) => {
    const phone1 = uniquePhone()
    const phone2 = uniquePhone()

    // Add first ban
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel(/phone number/i).fill(phone1)
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('First ban')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(phone1).first()).toBeVisible({ timeout: 10000 })

    // Add second ban
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel(/phone number/i).fill(phone2)
    await adminPage.getByLabel(/phone number/i).blur()
    await adminPage.getByLabel(/reason/i).fill('Second ban')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(phone2).first()).toBeVisible({ timeout: 10000 })

    // Both should be visible in the ban list
    const list = adminPage.locator('main')
    await expect(list.getByText(phone1).first()).toBeVisible()
    await expect(list.getByText(phone2).first()).toBeVisible()
    await expect(list.getByText('First ban')).toBeVisible()
    await expect(list.getByText('Second ban')).toBeVisible()
  })

  test('bulk import form opens and closes', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /import ban/i }).click()
    // Bulk import form should be visible with textarea
    await expect(adminPage.getByText(/paste phone numbers/i)).toBeVisible()

    await adminPage.getByRole('button', { name: /cancel/i }).click()
    await expect(adminPage.getByText(/paste phone numbers/i)).not.toBeVisible()
  })

  test('bulk import adds multiple bans', async ({ adminPage }) => {
    const phone1 = uniquePhone()
    const phone2 = uniquePhone()

    await adminPage.getByRole('button', { name: /import ban/i }).click()

    // Fill textarea with multiple phones
    const textarea = adminPage.locator('textarea')
    await textarea.fill(`${phone1}\n${phone2}`)
    await adminPage.getByLabel(/reason/i).fill('Bulk ban reason')
    await adminPage.getByRole('button', { name: /submit/i }).click()

    // Both phones should appear in the ban list (use .first() to handle retry duplicates)
    await expect(adminPage.getByText(phone1).first()).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText(phone2).first()).toBeVisible()
  })

  test('bulk import rejects invalid phones', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /import ban/i }).click()

    const textarea = adminPage.locator('textarea')
    await textarea.fill('+12\n+34')
    await adminPage.getByLabel(/reason/i).fill('Bad bulk')
    await adminPage.getByRole('button', { name: /submit/i }).click()

    // Should show validation error
    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible({ timeout: 5000 })
  })

  test('volunteer cannot access ban list', async ({ volunteerPage }) => {
    // Navigate directly to bans page as a volunteer
    await navigateAfterLogin(volunteerPage, '/bans')
    await expect(volunteerPage.getByText(/access denied/i)).toBeVisible({ timeout: 10000 })
  })
})
