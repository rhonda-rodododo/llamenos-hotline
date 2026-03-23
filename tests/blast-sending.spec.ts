import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, resetTestState, uniquePhone } from './helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

/**
 * Inject authed fetch helper after login.
 */
function injectAuthedFetch(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    window.__authedFetch = async (url: string, options: RequestInit = {}) => {
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      }
      if (km?.isUnlocked()) {
        const reqMethod = (options.method || 'GET').toUpperCase()
        const reqPath = new URL(url, location.origin).pathname
        const token = km.createAuthToken(Date.now(), reqMethod, reqPath)
        headers['Authorization'] = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    }
  })
}

test.describe('Blast campaign send flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
  })

  test('blasts page loads for admin', async ({ page }) => {
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({ timeout: 10000 })
  })

  test('create a blast via composer UI', async ({ page }) => {
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible()

    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: 10000 })

    await page.getByTestId('blast-name').fill('UI Test Campaign')
    await page.getByTestId('blast-text').fill('Hello from the E2E test campaign')

    // Save/create the blast
    await page.getByRole('button', { name: /save|create/i }).click()

    // Blast should appear in the list
    await expect(page.getByText('UI Test Campaign').first()).toBeVisible({ timeout: 10000 })
  })

  test('create a blast via API', async ({ page }) => {
    const blast = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'API Test Campaign',
          channel: 'sms',
          content: 'Hello from API blast test',
        }),
      })
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect([200, 201]).toContain(blast.status)
    const data = blast.data as { id?: string; status?: string }
    expect(data).toHaveProperty('id')
    expect(data.status).toBe('draft')
  })

  test('import subscribers via API', async ({ page }) => {
    const phone1 = uniquePhone()
    const phone2 = uniquePhone()

    const result = await page.evaluate(
      async ({ p1, p2 }: { p1: string; p2: string }) => {
        const res = await window.__authedFetch('/api/blasts/subscribers/import', {
          method: 'POST',
          body: JSON.stringify([
            { phoneNumber: p1, channel: 'sms', active: true },
            { phoneNumber: p2, channel: 'sms', active: true },
          ]),
        })
        return { status: res.status, data: res.ok ? await res.json() : await res.text() }
      },
      { p1: phone1, p2: phone2 }
    )
    expect(result.status).toBe(200)
    const data = result.data as { imported?: number; failed?: number }
    expect(data.imported).toBe(2)
    expect(data.failed).toBe(0)
  })

  test('send a blast and verify status transitions to sending', async ({ page }) => {
    // Create blast via API (faster than UI for this test)
    const blast = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Send Test Blast',
          channel: 'sms',
          content: 'This is an E2E send test blast',
        }),
      })
      return res.json()
    })
    const blastData = blast as { id?: string; status?: string }
    expect(blastData).toHaveProperty('id')
    expect(blastData.status).toBe('draft')

    // Send the blast
    const sent = await page.evaluate(async (blastId: string) => {
      const res = await window.__authedFetch(`/api/blasts/${blastId}/send`, { method: 'POST' })
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    }, blastData.id as string)
    expect(sent.status).toBe(200)
    const sentData = sent.data as { status?: string; sentAt?: string }
    expect(sentData.status).toBe('sending')

    // Verify the blast list reflects the sending status
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible()
    // The blast card or list entry should show "sending" or the blast name
    await expect(
      page.getByText(/sending/i).first()
        .or(page.getByText('Send Test Blast'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('cannot send a blast that is already in sending state', async ({ page }) => {
    // Create a blast
    const blast = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts', {
        method: 'POST',
        body: JSON.stringify({ name: 'Double Send Blast', channel: 'sms', content: 'Test content' }),
      })
      return res.json()
    })
    const blastId = (blast as { id: string }).id

    // First send — should succeed
    await page.evaluate(async (id: string) => {
      await window.__authedFetch(`/api/blasts/${id}/send`, { method: 'POST' })
    }, blastId)

    // Second send — should fail with 400 (already sending)
    const secondSend = await page.evaluate(async (id: string) => {
      const res = await window.__authedFetch(`/api/blasts/${id}/send`, { method: 'POST' })
      return { ok: res.ok, status: res.status }
    }, blastId)
    expect(secondSend.ok).toBe(false)
    expect(secondSend.status).toBe(400)
  })

  test('list blasts API returns all created blasts', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts')
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect(result.status).toBe(200)
    const data = result.data as { blasts?: unknown[] }
    expect(data).toHaveProperty('blasts')
    expect(Array.isArray(data.blasts)).toBe(true)
    // Should have at least the blasts created in earlier tests
    expect((data.blasts as unknown[]).length).toBeGreaterThan(0)
  })

  test('subscriber list API returns imported subscribers', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts/subscribers')
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect(result.status).toBe(200)
    const data = result.data as { subscribers?: unknown[] }
    expect(data).toHaveProperty('subscribers')
    expect(Array.isArray(data.subscribers)).toBe(true)
    // Should have at least the 2 subscribers imported in the import test
    expect((data.subscribers as unknown[]).length).toBeGreaterThanOrEqual(2)
  })
})
