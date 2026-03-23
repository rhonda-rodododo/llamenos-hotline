import { test, expect } from '@playwright/test'

test.describe('Health and config endpoints', () => {
  test('GET /api/health returns status and checks', async ({ request }) => {
    const res = await request.get('/api/health')
    // May be 200 (ok) or 503 (degraded) depending on backing services
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(['ok', 'degraded']).toContain(body.status)
    expect(body).toHaveProperty('checks')
    expect(body.checks).toHaveProperty('postgres')
    expect(body).toHaveProperty('version')
  })

  test('GET /api/health/live always returns 200', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  test('GET /api/health/ready returns checks and status', async ({ request }) => {
    const res = await request.get('/api/health/ready')
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('checks')
  })

  test('GET /api/config returns public config without secrets', async ({ request }) => {
    const res = await request.get('/api/config')
    // Config endpoint may or may not exist — if it does, verify no secrets
    if (res.status() === 200) {
      const body = await res.json()
      const text = JSON.stringify(body)
      // Ensure no secrets are leaked
      expect(text).not.toContain('authToken')
      expect(text).not.toContain('apiSecret')
      expect(text).not.toContain('privateKey')
      expect(text).not.toContain('HMAC_SECRET')
    }
    // 404 is acceptable if no public config endpoint exists
    expect([200, 404]).toContain(res.status())
  })

  test('unknown API route returns 404', async ({ request }) => {
    const res = await request.get('/api/nonexistent-endpoint-test')
    expect(res.status()).toBe(404)
  })
})
