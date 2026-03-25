import { Hono } from 'hono'
import { verifyAuthToken } from '../lib/auth'
import { hashIP } from '../lib/crypto'
import { isValidE164 } from '../lib/helpers'
import { auth as authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permission-guard'
import {
  type InviteDeliveryChannel,
  InviteDeliveryService,
} from '../services/invite-delivery-service'
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

  // Rate limit redemption attempts (relaxed in dev for parallel test runs)
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const maxAttempts = c.env.ENVIRONMENT === 'development' ? 50 : 5
  const limited = await services.settings.checkRateLimit(
    `invite-redeem:${hashIP(clientIp, c.env.HMAC_SECRET)}`,
    maxAttempts
  )
  if (limited) return c.json({ error: 'Too many requests' }, 429)

  const volunteer = await services.identity.redeemInvite({ code: body.code, pubkey: body.pubkey })
  return c.json(volunteer)
})

// --- Authenticated routes (require invites permissions) ---

invites.get('/', authMiddleware, requirePermission('invites:read'), async (c) => {
  const services = c.get('services')
  const inviteList = await services.identity.getInvites()
  return c.json({ invites: inviteList })
})

/**
 * GET /api/invites/available-channels
 * Returns which messaging channels are configured for invite delivery.
 * Signal > WhatsApp > SMS — always prefer encrypted channels.
 */
invites.get(
  '/available-channels',
  authMiddleware,
  requirePermission('invites:create'),
  async (c) => {
    const services = c.get('services')
    const config = await services.settings.getMessagingConfig()
    return c.json({
      signal: config.enabledChannels.includes('signal') && !!config.signal,
      whatsapp: config.enabledChannels.includes('whatsapp') && !!config.whatsapp,
      sms: config.enabledChannels.includes('sms') && !!config.sms?.enabled,
    })
  }
)

invites.post('/', authMiddleware, requirePermission('invites:create'), async (c) => {
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

/**
 * POST /api/invites/:code/send
 * Deliver invite link via a secure messaging channel.
 *
 * Requires:
 * - Valid, unexpired invite code
 * - E.164 phone number
 * - Explicit acknowledgedInsecure: true for SMS channel
 *
 * Phone stored as HMAC hash only — never in plaintext.
 */
invites.post('/:code/send', authMiddleware, requirePermission('invites:create'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const code = c.req.param('code')

  const body = (await c.req.json()) as {
    recipientPhone: string
    channel: InviteDeliveryChannel
    acknowledgedInsecure?: boolean
  }

  // Validate channel value
  const validChannels: InviteDeliveryChannel[] = ['signal', 'whatsapp', 'sms']
  if (!validChannels.includes(body.channel)) {
    return c.json({ error: 'Invalid channel. Must be signal, whatsapp, or sms.' }, 422)
  }

  // Validate phone format
  if (!body.recipientPhone || !isValidE164(body.recipientPhone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 422)
  }

  // SMS requires explicit insecure acknowledgment — it is not end-to-end encrypted
  if (body.channel === 'sms' && !body.acknowledgedInsecure) {
    return c.json(
      {
        error: 'SMS is not end-to-end encrypted. Set acknowledgedInsecure: true to proceed.',
        requiresAcknowledgment: true,
      },
      422
    )
  }

  // Validate invite exists and is not expired or already used
  const validation = await services.identity.validateInvite(code)
  if (!validation.valid) {
    const status = validation.error === 'expired' ? 410 : 404
    return c.json({ error: validation.error }, status)
  }

  // Look up full invite to get expiresAt
  const inviteList = await services.identity.getInvites()
  const invite = inviteList.find((i) => i.code === code)
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404)
  }

  const appUrl = c.env.APP_URL || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`

  const deliveryService = new InviteDeliveryService(services.settings)

  let deliveryResult: Awaited<ReturnType<typeof deliveryService.sendInvite>>
  try {
    deliveryResult = await deliveryService.sendInvite({
      recipientPhone: body.recipientPhone,
      inviteCode: code,
      channel: body.channel,
      expiresAt: new Date(invite.expiresAt),
      appUrl,
      hmacSecret: c.env.HMAC_SECRET,
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to send invite' }, 502)
  }

  // Record delivery metadata — phone as HMAC hash, never plaintext
  await services.identity.updateInviteDelivery(code, {
    recipientPhoneHash: deliveryResult.recipientPhoneHash,
    deliveryChannel: deliveryResult.channel,
    deliverySentAt: new Date(),
  })

  await services.records.addAuditEntry('global', 'inviteSent', pubkey, {
    code,
    channel: deliveryResult.channel,
  })

  return c.json({ sent: true, channel: deliveryResult.channel })
})

invites.delete('/:code', authMiddleware, requirePermission('invites:revoke'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const code = c.req.param('code')
  await services.identity.revokeInvite(code)
  await services.records.addAuditEntry('global', 'inviteRevoked', pubkey, { code })
  return c.json({ ok: true })
})

export default invites
