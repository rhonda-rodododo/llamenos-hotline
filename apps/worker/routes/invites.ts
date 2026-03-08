import { Hono } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { checkRateLimit } from '../lib/helpers'
import { hashIP } from '../lib/crypto'
import { verifyAuthToken } from '../lib/auth'
import { auth as authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permission-guard'
import { validateBody } from '../middleware/validate'
import { redeemInviteBodySchema, createInviteBodySchema } from '../schemas/invites'
import { audit } from '../services/audit'
import { permissionGranted, resolvePermissions } from '@shared/permissions'
import type { Role } from '@shared/permissions'

const invites = new Hono<AppEnv>()

// --- Public routes (no auth) ---

invites.get('/validate/:code', async (c) => {
  const dos = getDOs(c.env)
  const code = c.req.param('code')
  // Rate limit invite validation to prevent enumeration
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const limited = await checkRateLimit(dos.settings, `invite-validate:${hashIP(clientIp, c.env.HMAC_SECRET)}`, 5)
  if (limited) return c.json({ error: 'Too many requests' }, 429)
  return dos.identity.fetch(new Request(`http://do/invites/validate/${code}`))
})

invites.post('/redeem', validateBody(redeemInviteBodySchema), async (c) => {
  const dos = getDOs(c.env)
  const body = c.get('validatedBody') as z.infer<typeof redeemInviteBodySchema>

  // Verify Schnorr signature
  const inviteUrl = new URL(c.req.url)
  const isValid = await verifyAuthToken({ pubkey: body.pubkey, timestamp: body.timestamp, token: body.token }, c.req.method, inviteUrl.pathname)
  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  // Rate limit redemption attempts
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const limited = await checkRateLimit(dos.settings, `invite-redeem:${hashIP(clientIp, c.env.HMAC_SECRET)}`, 5)
  if (limited) return c.json({ error: 'Too many requests' }, 429)

  return dos.identity.fetch(new Request('http://do/invites/redeem', {
    method: 'POST',
    body: JSON.stringify({ code: body.code, pubkey: body.pubkey }),
  }))
})

// --- Authenticated routes (require invites permissions) ---
invites.use('/', authMiddleware, requirePermission('invites:read'))
invites.use('/:code', authMiddleware, requirePermission('invites:read'))

invites.get('/', async (c) => {
  const dos = getDOs(c.env)
  return dos.identity.fetch(new Request('http://do/invites'))
})

invites.post('/', requirePermission('invites:create'), validateBody(createInviteBodySchema), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = c.get('validatedBody') as z.infer<typeof createInviteBodySchema>

  // Validate that the creator can grant all requested roles (prevent privilege escalation)
  if (body.roleIds && body.roleIds.length > 0) {
    const creatorPermissions = c.get('permissions') as string[]
    if (!permissionGranted(creatorPermissions, '*')) {
      const allRoles = c.get('allRoles') as Role[]
      for (const roleId of body.roleIds) {
        const role = allRoles.find(r => r.id === roleId)
        if (!role) {
          return c.json({ error: `Unknown role: ${roleId}` }, 400)
        }
        for (const perm of role.permissions) {
          if (!permissionGranted(creatorPermissions, perm)) {
            return c.json({ error: `Cannot grant role '${role.name}' — you lack permission '${perm}'` }, 403)
          }
        }
      }
    }
  }

  const res = await dos.identity.fetch(new Request('http://do/invites', {
    method: 'POST',
    body: JSON.stringify({ ...body, createdBy: pubkey }),
  }))
  if (res.ok) await audit(dos.records, 'inviteCreated', pubkey, { name: body.name })
  return res
})

invites.delete('/:code', requirePermission('invites:revoke'), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const code = c.req.param('code')
  const res = await dos.identity.fetch(new Request(`http://do/invites/${code}`, { method: 'DELETE' }))
  if (res.ok) await audit(dos.records, 'inviteRevoked', pubkey, { code })
  return res
})

export default invites
