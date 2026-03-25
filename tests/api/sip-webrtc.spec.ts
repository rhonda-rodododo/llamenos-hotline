import { expect, test } from '@playwright/test'

test.describe('SIP WebRTC Token Generation', () => {
  // These tests verify the token endpoint works for Asterisk provider configurations.
  // They require a hub configured with an Asterisk telephony provider.
  // Skip gracefully if Asterisk is not configured.

  test('GET /api/telephony/webrtc-token returns SIP credentials for Asterisk provider', async ({
    request,
  }) => {
    // This test only runs when Asterisk is the configured provider.
    // If not configured, skip gracefully.
    const response = await request.get('/api/telephony/webrtc-token')

    // If the response indicates Asterisk is not configured (e.g., 400 or different provider), skip
    if (!response.ok()) {
      test.skip(true, 'WebRTC token endpoint not available (Asterisk may not be configured)')
      return
    }

    const data = await response.json()

    // Only assert SIP-specific fields if provider is asterisk
    if (data.provider === 'asterisk') {
      expect(data.token).toBeTruthy()
      expect(data.ttl).toBe(600)

      // Decode token — should be base64 JSON
      const decoded = JSON.parse(atob(data.token))
      expect(decoded.wsUri).toContain('wss://')
      expect(decoded.sipUri).toContain('sip:vol_')
      expect(decoded.password).toBeTruthy()
      expect(decoded.iceServers).toBeInstanceOf(Array)
      expect(decoded.iceServers.length).toBeGreaterThan(0)

      // Verify STUN server present
      const stunServer = decoded.iceServers.find((s: { urls: string }) =>
        typeof s.urls === 'string' ? s.urls.startsWith('stun:') : false
      )
      expect(stunServer).toBeTruthy()

      // If TURN is configured, verify time-limited credentials
      const turnServer = decoded.iceServers.find((s: { urls: string }) =>
        typeof s.urls === 'string' ? s.urls.startsWith('turn:') : false
      )
      if (turnServer) {
        expect(turnServer.username).toMatch(/^\d+:vol_/) // timestamp:identity format
        expect(turnServer.credential).toBeTruthy()
      }
    }
  })

  test('isWebRtcConfigured returns true for Asterisk with ariUrl and bridgeCallbackUrl', async () => {
    // Unit-style test that imports the function directly
    const { isWebRtcConfigured } = await import('../../src/server/telephony/webrtc-tokens')

    expect(
      isWebRtcConfigured({
        type: 'asterisk',
        phoneNumber: '+1234567890',
        ariUrl: 'http://localhost:8088/ari',
        ariUsername: 'llamenos',
        ariPassword: 'test',
        bridgeCallbackUrl: 'http://bridge:3000',
      })
    ).toBe(true)

    expect(
      isWebRtcConfigured({
        type: 'asterisk',
        phoneNumber: '+1234567890',
        ariUrl: 'http://localhost:8088/ari',
        ariUsername: 'llamenos',
        ariPassword: 'test',
        // No bridgeCallbackUrl
      })
    ).toBe(false)
  })
})
