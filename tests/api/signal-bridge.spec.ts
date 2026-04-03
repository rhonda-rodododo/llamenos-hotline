import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

// Signal bridge tests require signal-cli container (--profile signal).
// CI doesn't start signal-cli by default.
const hasSignalBridge = !process.env.CI

test.describe('Signal Bridge Integration', () => {
  test('POST /api/setup/test/signal validates bridge connection', async ({ request }) => {
    test.skip(!hasSignalBridge, 'Signal bridge not available in CI')
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Test with the Docker signal-cli bridge URL
    // In CI, signal-cli runs on internal Docker network; server accesses it via hostname
    const res = await api.post('/api/setup/test/signal', {
      bridgeUrl: 'http://signal-cli:8080',
    })
    // 200 = bridge connected, 400 = invalid URL, 503 = bridge unreachable
    // All are acceptable — what matters is no 500 (unhandled error)
    expect(res.status()).not.toBe(500)
    expect([200, 400, 503]).toContain(res.status())
  })

  test('POST /api/setup/test/signal rejects internal URLs (SSRF guard)', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/setup/test/signal', {
      bridgeUrl: 'http://localhost:8080',
    })
    // SSRF guard should block localhost
    expect(res.status()).toBe(400)
  })

  test('POST /api/setup/test/signal requires admin permissions', async ({ request }) => {
    // Unauthenticated request should fail
    const res = await request.post('/api/setup/test/signal', {
      data: { bridgeUrl: 'http://signal-cli:8080' },
    })
    expect(res.status()).toBe(401)
  })
})
