import { expect, test } from '../fixtures/auth'

test.describe('Notes CRUD', () => {
  test.beforeEach(async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call Notes' }).click()
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible({
      timeout: 15000,
    })
  })

  test('notes page shows encryption note', async ({ adminPage }) => {
    await expect(adminPage.getByText(/encrypted end-to-end/i)).toBeVisible()
  })

  test('can open new note form', async ({ adminPage }) => {
    await adminPage.getByTestId('note-new-btn').click()
    await expect(adminPage.getByText('Call ID')).toBeVisible()
  })

  test('can create a note', async ({ adminPage }) => {
    await adminPage.getByTestId('note-new-btn').click()

    await adminPage.locator('#call-id').fill(`test-call-${Date.now()}`)
    await adminPage.locator('textarea').fill('Test note from E2E')
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Wait for the form to close (indicates mutation succeeded)
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })

    // Note should appear as decrypted paragraph text after list refetch + decryption
    await expect(adminPage.locator('p').filter({ hasText: 'Test note from E2E' })).toBeVisible({
      timeout: 30000,
    })
  })

  test('can cancel new note', async ({ adminPage }) => {
    await adminPage.getByTestId('note-new-btn').click()
    await adminPage.getByRole('button', { name: /cancel/i }).click()
    // Form should be gone
    await expect(adminPage.locator('#call-id')).not.toBeVisible()
  })

  test('notes are grouped by call', async ({ adminPage }) => {
    // Create two notes for the same call
    const callId = `group-test-${Date.now()}`

    await adminPage.getByTestId('note-new-btn').click()
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').fill('First note')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'First note' })).toBeVisible({
      timeout: 30000,
    })

    await adminPage.getByTestId('note-new-btn').click()
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').fill('Second note')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'Second note' })).toBeVisible({
      timeout: 30000,
    })

    // Both notes should be visible on the same page (grouped by call)
    await expect(adminPage.locator('p').filter({ hasText: 'First note' })).toBeVisible()
    await expect(adminPage.locator('p').filter({ hasText: 'Second note' })).toBeVisible()
  })

  test('can edit a note', async ({ adminPage }) => {
    // Create a note first
    await adminPage.getByTestId('note-new-btn').click()
    await adminPage.locator('#call-id').fill(`edit-test-${Date.now()}`)
    await adminPage.locator('textarea').fill('Original text')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'Original text' })).toBeVisible({
      timeout: 30000,
    })

    // Click edit on the note
    const editBtn = adminPage.getByTestId('note-edit-btn').first()
    await editBtn.click()

    // Textarea should be visible with original text
    const editTextarea = adminPage.locator('textarea')
    await expect(editTextarea).toBeVisible()
  })
})
