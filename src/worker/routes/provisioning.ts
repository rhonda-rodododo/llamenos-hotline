import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { auth } from '../middleware/auth'
import { checkRateLimit } from '../lib/helpers'
import { hashIP } from '../lib/crypto'

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
  const dos = getDOs(c.env)
  const body = await c.req.json() as { ephemeralPubkey: string }
  if (!body.ephemeralPubkey || body.ephemeralPubkey.length < 60) {
    return c.json({ error: 'Invalid ephemeral pubkey' }, 400)
  }
  return dos.identity.fetch(new Request('http://do/provision/rooms', {
    method: 'POST',
    body: JSON.stringify({ ephemeralPubkey: body.ephemeralPubkey }),
  }))
})

// Get room status (public — new device polls this, rate limited)
provisioning.get('/rooms/:id', async (c) => {
  const dos = getDOs(c.env)
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const limited = await checkRateLimit(dos.settings, `provision:${hashIP(clientIp, c.env.HMAC_SECRET)}`, 30)
  if (limited) return c.json({ error: 'Rate limited' }, 429)
  const id = c.req.param('id')
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Missing token' }, 400)
  return dos.identity.fetch(new Request(`http://do/provision/rooms/${id}?token=${token}`))
})

// Send encrypted payload (authenticated — primary device)
provisioning.post('/rooms/:id/payload', auth, async (c) => {
  const dos = getDOs(c.env)
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const body = await c.req.json() as {
    token: string
    encryptedNsec: string
    primaryPubkey: string
  }
  if (!body.token || !body.encryptedNsec || !body.primaryPubkey) {
    return c.json({ error: 'Missing fields' }, 400)
  }
  return dos.identity.fetch(new Request(`http://do/provision/rooms/${id}/payload`, {
    method: 'POST',
    body: JSON.stringify({ ...body, senderPubkey: pubkey }),
  }))
})

export default provisioning
