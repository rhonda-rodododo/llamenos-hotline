import { Hono } from 'hono'
import { isValidE164 } from '../lib/helpers'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const bans = new Hono<AppEnv>()

// Any authenticated user with bans:create can create a ban
bans.post('/', requirePermission('bans:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as { phone: string; reason: string }
  if (!isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }
  const ban = await services.records.addBan({ ...body, bannedBy: pubkey, hubId: hubId ?? 'global' })
  await services.records.addAuditEntry(hubId ?? 'global', 'numberBanned', pubkey, {
    phone: body.phone,
  })
  return c.json(ban, 201)
})

bans.get('/', requirePermission('bans:read'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const banList = await services.records.getBans(hubId)
  return c.json({ bans: banList })
})

bans.post('/bulk', requirePermission('bans:bulk-create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as { phones: string[]; reason: string }
  const invalidPhones = body.phones.filter((p) => !isValidE164(p))
  if (invalidPhones.length > 0) {
    return c.json(
      {
        error: `Invalid phone number(s): ${invalidPhones[0]}. Use E.164 format (e.g. +12125551234)`,
      },
      400
    )
  }
  const count = await services.records.bulkAddBans({
    phones: body.phones,
    reason: body.reason,
    bannedBy: pubkey,
    hubId: hubId ?? 'global',
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'numberBanned', pubkey, {
    count: body.phones.length,
    bulk: true,
  })
  return c.json({ count })
})

bans.delete('/:phone', requirePermission('bans:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const phone = decodeURIComponent(c.req.param('phone'))
  await services.records.removeBan(phone, hubId)
  await services.records.addAuditEntry(hubId ?? 'global', 'numberUnbanned', pubkey, {})
  return c.json({ ok: true })
})

export default bans
