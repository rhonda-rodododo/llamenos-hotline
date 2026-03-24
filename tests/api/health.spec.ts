import { test, expect } from '@playwright/test'

test.describe('Health endpoints (API suite)', () => {
  test('GET /api/health returns status and checks', async ({ request }) => {
    const res = await request.get('/api/health')
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(['ok', 'degraded']).toContain(body.status)
    expect(body).toHaveProperty('checks')
  })

  test('GET /api/health/live always returns 200', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
  })
})
