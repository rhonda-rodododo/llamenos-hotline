import { Hono } from 'hono'
import { generateWebRtcToken, isWebRtcConfigured } from '../telephony/webrtc-tokens'
import type { AppEnv } from '../types'

const webrtc = new Hono<AppEnv>()

/**
 * GET /api/telephony/webrtc-token
 * Generate a provider-specific WebRTC access token for the authenticated user.
 * Requires: provider config with webrtcEnabled=true and appropriate credentials.
 */
webrtc.get('/webrtc-token', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const user = c.get('user')

  // Check user's call preference allows browser calls
  const callPref = user.callPreference ?? 'phone'
  if (callPref === 'phone') {
    return c.json(
      { error: 'Call preference is set to phone only. Enable browser calling in settings.' },
      400
    )
  }

  // Get provider config
  const config = await services.settings.getTelephonyProvider()
  if (!config || !isWebRtcConfigured(config)) {
    return c.json(
      {
        error:
          'WebRTC is not configured for the current provider. Admin must enable it in settings.',
      },
      400
    )
  }

  try {
    // Use a sanitized identity (pubkey prefix — unique per user)
    const identity = `vol_${pubkey.slice(0, 16)}`
    const result = await generateWebRtcToken(config, identity)
    return c.json({ token: result.token, provider: result.provider, identity, ttl: result.ttl })
  } catch (err) {
    console.error('[webrtc] Token generation failed:', err)
    return c.json({ error: 'Failed to generate WebRTC token' }, 500)
  }
})

/**
 * GET /api/telephony/webrtc-status
 * Check whether WebRTC is available for the current provider.
 */
webrtc.get('/webrtc-status', async (c) => {
  const services = c.get('services')
  const config = await services.settings.getTelephonyProvider()
  return c.json({
    available: isWebRtcConfigured(config),
    provider: config?.type ?? null,
  })
})

export default webrtc
