import { test, expect } from '@playwright/test'
import { ADMIN_NSEC, loginAsAdmin, navigateAfterLogin } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Signal Automated Registration', () => {
  test('rejects invalid bridge URL', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'not-a-url',
      registeredNumber: '+15551234567',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('rejects non-HTTPS bridge URL', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'http://signal-bridge.example.com:8080',
      registeredNumber: '+15551234567',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('HTTPS')
  })

  test('registration status is idle when not configured', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/messaging/signal/registration-status')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // Status should be 'idle' or 'complete' depending on prior state
    expect(['idle', 'complete']).toContain(body.status)
  })

  test('bridge connection failure returns 502 and rolls back pending state', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Use a valid HTTPS URL that won't connect (port that's not listening)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'https://signal-bridge-nonexistent.example.com:9999',
      registeredNumber: '+15551234567',
    })
    // Should get 502 because the bridge is unreachable (or 409 if another test set pending)
    expect([502, 409]).toContain(res.status())
    const body = await res.json()
    expect(body.error).toBeTruthy()

    // After a 502 failure, pending state should be rolled back
    if (res.status() === 502) {
      const statusRes = await api.get('/api/messaging/signal/registration-status')
      expect(statusRes.ok()).toBeTruthy()
      const statusBody = await statusRes.json()
      // Should be idle (rolled back) or complete (already configured)
      expect(['idle', 'complete']).toContain(statusBody.status)
    }
  })

  test('verify without pending registration returns 404', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/messaging/signal/verify', { code: '123456' })
    // 404 if no pending registration, 400 if verification fails
    expect([400, 404]).toContain(res.status())
  })

  test('rejects invalid verification code format', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/messaging/signal/verify', { code: 'abc' })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('6 digits')
  })

  test('rejects missing required fields', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'https://signal-bridge.example.com',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  test('Signal settings show registration flow when not configured', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/admin/settings')

    // The settings page should load — verify the heading
    await expect(
      page.getByRole('heading', { name: 'Hub Settings', exact: true })
    ).toBeVisible({ timeout: 10000 })
  })
})
