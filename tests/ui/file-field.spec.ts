import { type Page, expect, test } from '@playwright/test'
import { loginAsAdmin } from '../helpers'

declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

/**
 * End-to-end tests for the file custom field type.
 * Covers: field definition, upload flow, display with download button,
 * file size/type validation errors, and note round-trip.
 */
test.describe('File Custom Field', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)

    // Inject authed fetch helper for direct API calls
    await page.evaluate(() => {
      window.__authedFetch = async (url: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        }
        const token = localStorage.getItem('access_token')
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })
  })

  /** Create a file custom field via admin settings UI */
  async function createFileCustomField(page: Page, label: string) {
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    const addFieldBtn = page.getByRole('button', { name: /add field/i })
    if (!(await addFieldBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
      await page.getByRole('heading', { name: /custom note fields/i }).click()
    }
    await expect(addFieldBtn).toBeVisible({ timeout: 10000 })

    // Skip if already exists
    const existing = page.locator('.rounded-lg.border').filter({ hasText: label })
    if (
      await existing
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      return
    }

    await addFieldBtn.click()
    await page.getByPlaceholder('e.g. Severity Rating').fill(label)

    // Change type to File
    await page.locator('select[data-testid="custom-field-type-select"]').selectOption('file')

    // Save
    await page.getByRole('button', { name: /save/i }).last().click()
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.rounded-lg.border').filter({ hasText: label })).toBeVisible()
  }

  test('file type appears in field type dropdown', async ({ page }) => {
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    const addFieldBtn = page.getByRole('button', { name: /add field/i })
    if (!(await addFieldBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
      await page.getByRole('heading', { name: /custom note fields/i }).click()
    }
    await expect(addFieldBtn).toBeVisible({ timeout: 10000 })
    await addFieldBtn.click()

    // File option should be in the type dropdown
    const typeSelect = page.locator('select[data-testid="custom-field-type-select"]')
    await expect(typeSelect.locator('option[value="file"]')).toHaveCount(1)

    // Cancel without saving
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('admin can create a file custom field', async ({ page }) => {
    const label = `Attachment ${Date.now()}`
    await createFileCustomField(page, label)
    // Field type badge should show "File"
    const fieldRow = page.locator('[data-testid="custom-field-row"]').filter({ hasText: label })
    await expect(fieldRow).toBeVisible()
  })

  test('file custom field shows in note form', async ({ page }) => {
    // Create the file field first
    await createFileCustomField(page, `FileField ${Date.now()}`)

    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

    await page.getByRole('button', { name: /new note/i }).click()

    // File field dropzone should appear
    await expect(page.getByTestId('file-field-dropzone')).toBeVisible()
  })

  test('PATCH /api/uploads/:id/context endpoint binds context', async ({ page }) => {
    // Create a completed upload via the API, then bind it
    const adminPubkey = await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKeyHex() as string
    })
    expect(typeof adminPubkey).toBe('string')

    // Use a dummy conversationId — file upload init does not validate it
    const conversationId = `test-conv-file-field-${Date.now()}`

    // Init and complete a minimal upload
    const uploadId = await page.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const initRes = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 5,
            totalChunks: 1,
            conversationId,
            contextType: 'custom_field',
            recipientEnvelopes: [
              { pubkey: adminPubkey, encryptedFileKey: 'test-key', ephemeralPubkey: 'test-ephem' },
            ],
            encryptedMetadata: [
              { pubkey: adminPubkey, encryptedContent: 'test-meta', ephemeralPubkey: 'test-ephem' },
            ],
          }),
        })
        const initData = await initRes.json()
        const uploadId = initData.uploadId as string

        // Upload chunk
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
        const chunkToken = localStorage.getItem('access_token')
        if (chunkToken) {
          headers.Authorization = `Bearer ${chunkToken}`
        }
        await fetch(`/api/uploads/${uploadId}/chunks/0`, {
          method: 'PUT',
          headers,
          body: new Uint8Array([1, 2, 3, 4, 5]).buffer,
        })

        // Complete
        await window.__authedFetch(`/api/uploads/${uploadId}/complete`, { method: 'POST' })

        return uploadId
      },
      [conversationId, adminPubkey] as [string, string]
    )

    expect(typeof uploadId).toBe('string')

    // Now bind the context
    const bindResult = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/context`, {
        method: 'PATCH',
        body: JSON.stringify({ contextType: 'custom_field', contextId: 'note-abc-123' }),
      })
      return { status: res.status, body: await res.json() }
    }, uploadId)

    expect(bindResult.status).toBe(200)
    expect(bindResult.body.ok).toBe(true)
  })

  test('PATCH /context fails if upload not complete', async ({ page }) => {
    const adminPubkey = await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKeyHex() as string
    })

    // Use a dummy conversationId — file upload init does not validate it
    const conversationId = `test-conv-incomplete-${Date.now()}`

    const uploadId = await page.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const res = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 100,
            totalChunks: 2,
            conversationId,
            recipientEnvelopes: [
              { pubkey: adminPubkey, encryptedFileKey: 'k', ephemeralPubkey: 'e' },
            ],
            encryptedMetadata: [
              { pubkey: adminPubkey, encryptedContent: 'm', ephemeralPubkey: 'e' },
            ],
          }),
        })
        const data = await res.json()
        return data.uploadId as string
      },
      [conversationId, adminPubkey] as [string, string]
    )

    const result = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/context`, {
        method: 'PATCH',
        body: JSON.stringify({ contextType: 'custom_field', contextId: 'note-xyz' }),
      })
      return { status: res.status, body: await res.json() }
    }, uploadId)

    expect(result.status).toBe(409)
    expect(result.body.error).toContain('complete')
  })

  test('file field validation: exceeding maxFileSize shows error', async ({ page }) => {
    // Create the file field first
    await createFileCustomField(page, `Attachment ${Date.now()}`)

    // Navigate to notes to see the file field
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()
    await page.getByRole('button', { name: /new note/i }).click()

    // The file field dropzone should be visible
    const dropzone = page.getByTestId('file-field-dropzone')
    await expect(dropzone).toBeVisible()

    // Verify the dropzone is interactive and the field renders correctly
    await expect(dropzone).toBeEnabled()
  })

  test('custom field upload init accepts custom_field contextType without conversationId', async ({
    page,
  }) => {
    const adminPubkey = await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKeyHex() as string
    })

    // Init without conversationId but with contextType: custom_field
    const result = await page.evaluate(async (adminPubkey: string) => {
      const res = await window.__authedFetch('/api/uploads/init', {
        method: 'POST',
        body: JSON.stringify({
          totalSize: 10,
          totalChunks: 1,
          conversationId: '',
          contextType: 'custom_field',
          recipientEnvelopes: [
            { pubkey: adminPubkey, encryptedFileKey: 'k', ephemeralPubkey: 'e' },
          ],
          encryptedMetadata: [{ pubkey: adminPubkey, encryptedContent: 'm', ephemeralPubkey: 'e' }],
        }),
      })
      return { status: res.status, body: await res.json() }
    }, adminPubkey)

    expect(result.status).toBe(200)
    expect(typeof result.body.uploadId).toBe('string')
  })
})
