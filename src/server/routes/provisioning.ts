import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { Hono } from 'hono'
import { auth } from '../middleware/auth'
import type { AppEnv } from '../types'

const provisioning = new Hono<AppEnv>()

/**
 * Device provisioning relay — enables Signal-style device linking.
 *
 * Protocol:
 * 1. New device: POST /rooms → creates room with ephemeral pubkey
 * 2. New device: displays QR/code with { roomId, token }
 * 3. Primary device (authenticated): POST /rooms/:id/payload → sends encrypted nsec
 * 4. New device: GET /rooms/:id → polls for encrypted payload
 */

// Create provisioning room (public — new device has no auth yet)
provisioning.post('/rooms', async (c) => {
  const services = c.get('services')
  const body = (await c.req.json()) as { ephemeralPubkey: string }
  if (!body.ephemeralPubkey || body.ephemeralPubkey.length < 60) {
    return c.json({ error: 'Invalid ephemeral pubkey' }, 400)
  }
  const result = await services.identity.createProvisionRoom({
    ephemeralPubkey: body.ephemeralPubkey,
  })
  return c.json(result, 201)
})

// Get room status (public — new device polls this, rate limited)
provisioning.get('/rooms/:id', async (c) => {
  const services = c.get('services')
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const limited = await services.settings.checkRateLimit(
    `provision:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    30
  )
  if (limited) return c.json({ error: 'Rate limited' }, 429)
  const id = c.req.param('id')
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Missing token' }, 400)
  try {
    const result = await services.identity.getProvisionRoom(id, token)
    return c.json(result)
  } catch {
    return c.json({ error: 'Room not found or expired' }, 404)
  }
})

// Send encrypted payload (authenticated — primary device)
provisioning.post('/rooms/:id/payload', auth, async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as {
    token: string
    encryptedNsec: string
    primaryPubkey: string
  }
  if (!body.token || !body.encryptedNsec || !body.primaryPubkey) {
    return c.json({ error: 'Missing fields' }, 400)
  }
  try {
    await services.identity.setProvisionPayload(id, {
      token: body.token,
      encryptedNsec: body.encryptedNsec,
      primaryPubkey: body.primaryPubkey,
      senderPubkey: pubkey,
    })
    return c.json({ ok: true })
  } catch (err) {
    const status = err instanceof Error && err.message.includes('expired') ? 410 : 404
    return c.json({ error: err instanceof Error ? err.message : 'Room not found' }, status)
  }
})

export default provisioning
