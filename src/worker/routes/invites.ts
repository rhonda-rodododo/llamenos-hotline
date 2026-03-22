import { Hono } from 'hono'
import { verifyAuthToken } from '../lib/auth'
import { hashIP } from '../lib/crypto'
import { isValidE164 } from '../lib/helpers'
import { auth as authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const invites = new Hono<AppEnv>()

// --- Public routes (no auth) ---

invites.get('/validate/:code', async (c) => {
  const services = c.get('services')
  const code = c.req.param('code')
  // Rate limit invite validation to prevent enumeration
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const limited = await services.settings.checkRateLimit(
    `invite-validate:${hashIP(clientIp, c.env.HMAC_SECRET)}`,
    5
  )
  if (limited) return c.json({ error: 'Too many requests' }, 429)
  const result = await services.identity.validateInvite(code)
  return c.json(result)
})

invites.post('/redeem', async (c) => {
  const services = c.get('services')
  const body = (await c.req.json()) as {
    code: string
    pubkey: string
    timestamp: number
    token: string
  }

  // Require proof of private key possession via Schnorr signature
  if (!body.pubkey || !body.timestamp || !body.token) {
    return c.json({ error: 'Signature proof required' }, 400)
  }
  const inviteUrl = new URL(c.req.url)
  const isValid = await verifyAuthToken(
    { pubkey: body.pubkey, timestamp: body.timestamp, token: body.token },
    c.req.method,
    inviteUrl.pathname
  )
  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  // Rate limit redemption attempts
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const limited = await services.settings.checkRateLimit(
    `invite-redeem:${hashIP(clientIp, c.env.HMAC_SECRET)}`,
    5
  )
  if (limited) return c.json({ error: 'Too many requests' }, 429)

  const volunteer = await services.identity.redeemInvite({ code: body.code, pubkey: body.pubkey })
  return c.json(volunteer)
})

// --- Authenticated routes (require invites permissions) ---
invites.use('/', authMiddleware, requirePermission('invites:read'))
invites.use('/:code', authMiddleware, requirePermission('invites:read'))

invites.get('/', async (c) => {
  const services = c.get('services')
  const inviteList = await services.identity.getInvites()
  return c.json({ invites: inviteList })
})

invites.post('/', requirePermission('invites:create'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as { name: string; phone: string; roleIds: string[] }
  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }
  const invite = await services.identity.createInvite({ ...body, createdBy: pubkey })
  await services.records.addAuditEntry('global', 'inviteCreated', pubkey, { name: body.name })
  return c.json(invite, 201)
})

invites.delete('/:code', requirePermission('invites:revoke'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const code = c.req.param('code')
  await services.identity.revokeInvite(code)
  await services.records.addAuditEntry('global', 'inviteRevoked', pubkey, { code })
  return c.json({ ok: true })
})

export default invites
