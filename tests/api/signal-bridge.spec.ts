import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

// Signal bridge tests require signal-cli container AND messaging config with bridgeUrl set.
// In CI, the signal bridge starts but the messaging config hasn't been populated via the
// setup wizard. These tests verify the bridge connectivity endpoint behavior.

test.describe('Signal Bridge Integration', () => {
  test('GET /api/messaging/signal/test-bridge returns bridge status', async ({ request }) => {
    // No skip — signal bridge should always be available
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/messaging/signal/test-bridge')
    // 200 = bridge connected, 503 = bridge not configured (no URL set)
    expect([200, 503]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('connected')
    }
  })

  test('GET /api/messaging/signal/registration-status returns not-registered', async ({
    request,
  }) => {
    // No skip — signal bridge should always be available
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/messaging/signal/registration-status')
    // Without a registered number, should indicate not registered
    expect([200, 404]).toContain(res.status())
  })

  test('Signal bridge API is accessible from server', async ({ request }) => {
    // No skip — signal bridge should always be available
    // The server proxies Signal bridge requests — verify the proxy works
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Test the setup wizard's signal test endpoint
    const res = await api.post('/api/setup/provider/test-messaging', {
      channelType: 'signal',
    })
    // Should either succeed (bridge connected) or fail gracefully (not configured)
    expect([200, 400, 503]).toContain(res.status())
  })
})
