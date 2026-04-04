import { expect, test } from '@playwright/test'

test.describe('Unknown API routes return 404 (not 401)', () => {
  test('GET unknown route returns 404', async ({ request }) => {
    const res = await request.get('/api/definitely-nonexistent')
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  test('POST unknown route returns 404', async ({ request }) => {
    const res = await request.post('/api/definitely-nonexistent', {
      data: { foo: 'bar' },
    })
    expect(res.status()).toBe(404)
  })

  test('nested unknown route returns 404', async ({ request }) => {
    const res = await request.get('/api/definitely-nonexistent/sub/path')
    expect(res.status()).toBe(404)
  })

  test('known authenticated route without auth returns 401', async ({ request }) => {
    const res = await request.get('/api/users')
    expect(res.status()).toBe(401)
  })

  test('known public route without auth returns 200', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
  })
})
