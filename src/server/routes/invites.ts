import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { resolvePermissions } from '@shared/permissions'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { getIdPAdapter } from '../app'
import { hashIP } from '../lib/crypto-service'
import { isValidE164 } from '../lib/helpers'
import { signAccessToken } from '../lib/jwt'
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
    `invite-validate:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
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
  }

  if (!body.pubkey || !body.code) {
    return c.json({ error: 'Missing code or pubkey' }, 400)
  }

  // Rate limit redemption attempts (relaxed in dev for parallel test runs)
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const maxAttempts = c.env.ENVIRONMENT === 'development' ? 50 : 5
  const limited = await services.settings.checkRateLimit(
    `invite-redeem:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    maxAttempts
  )
  if (limited) return c.json({ error: 'Too many requests' }, 429)

  const user = await services.identity.redeemInvite({ code: body.code, pubkey: body.pubkey })

  // Auto-assign new user to the default hub (single-hub deployment) and distribute hub key
  try {
    const allHubs = await services.settings.getHubs()
    const activeHubs = allHubs.filter((h) => h.status === 'active')
    if (activeHubs.length >= 1) {
      const defaultHub = activeHubs[0]
      // Assign user to the hub with the same roles from the invite
      await services.identity.setHubRole({
        pubkey: body.pubkey,
        hubId: defaultHub.id,
        roleIds: user.roles,
      })
      // Distribute hub key envelope: unwrap server's copy, re-wrap for new member
      const existingEnvelopes = await services.settings.getHubKeyEnvelopes(defaultHub.id)
      if (existingEnvelopes.length > 0) {
        const newEnvelope = services.crypto.wrapHubKeyForNewMember(existingEnvelopes, body.pubkey)
        await services.settings.setHubKeyEnvelopes(defaultHub.id, [
          ...existingEnvelopes,
          newEnvelope,
        ])
      }
    }
  } catch {
    // Non-fatal — hub assignment or key distribution failure shouldn't block invite redemption
  }

  // Enroll the new user in the IdP and return their nsecSecret for KEK derivation
  let nsecSecret: string | undefined
  const idpAdapter = getIdPAdapter()
  if (idpAdapter) {
    try {
      const existing = await idpAdapter.getUser(body.pubkey)
      if (!existing) {
        await idpAdapter.createUser(body.pubkey)
      }
      const secret = await idpAdapter.getNsecSecret(body.pubkey)
      nsecSecret = Buffer.from(secret).toString('hex')
    } catch {
      // IdP enrollment failed — client will use synthetic value and rotate on first unlock
    }
  }

  // Issue a JWT so the client can call authenticated endpoints (e.g. getMe) immediately
  const allRoles = await services.settings.listRoles()
  const permissions = resolvePermissions(user.roles, allRoles)
  const accessToken = await signAccessToken(
    { pubkey: body.pubkey, permissions: [...new Set(permissions)] },
    c.env.JWT_SECRET
  )

  // Set refresh cookie so PIN unlock works after page reload (matches bootstrap pattern)
  const { signRefreshToken } = await import('./auth-facade')
  const refreshToken = await signRefreshToken(body.pubkey, c.env.JWT_SECRET)
  setCookie(c, 'llamenos-refresh', refreshToken, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== 'development',
    sameSite: 'Strict',
    path: '/api/auth/token',
    maxAge: 30 * 24 * 60 * 60,
  })

  return c.json({ ...user, nsecSecret, accessToken })
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
  return c.json({ invite }, 201)
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
      crypto: services.crypto,
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
