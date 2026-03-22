import { Hono } from 'hono'
import { isValidE164 } from '../lib/helpers'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const volunteers = new Hono<AppEnv>()
volunteers.use('*', requirePermission('volunteers:read'))

volunteers.get('/', async (c) => {
  const services = c.get('services')
  const vols = await services.identity.getVolunteers()
  return c.json({ volunteers: vols })
})

volunteers.post('/', requirePermission('volunteers:create'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as {
    name: string
    phone: string
    roleIds: string[]
    pubkey?: string
  }

  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }

  const newPubkey = body.pubkey
  if (!newPubkey) {
    return c.json({ error: 'pubkey is required — generate keypair client-side' }, 400)
  }

  const volunteer = await services.identity.createVolunteer({
    pubkey: newPubkey,
    name: body.name,
    phone: body.phone,
    roles: body.roleIds || ['role-volunteer'],
    encryptedSecretKey: '',
  })

  await services.records.addAuditEntry('global', 'volunteerAdded', pubkey, {
    target: newPubkey,
    roles: body.roleIds,
  })

  return c.json(volunteer, 201)
})

volunteers.patch('/:targetPubkey', requirePermission('volunteers:update'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const targetPubkey = c.req.param('targetPubkey')
  const body = (await c.req.json()) as Record<string, unknown>

  const updated = await services.identity.updateVolunteer(
    targetPubkey,
    body as Parameters<typeof services.identity.updateVolunteer>[1],
    true // isAdmin=true for admin update
  )

  if (body.roles) {
    await services.records.addAuditEntry('global', 'rolesChanged', pubkey, {
      target: targetPubkey,
      roles: body.roles,
    })
  }
  // Revoke all sessions when deactivating or changing roles
  if (body.active === false || body.roles) {
    await services.identity.revokeAllSessions(targetPubkey)
  }

  return c.json(updated)
})

volunteers.delete('/:targetPubkey', requirePermission('volunteers:delete'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const targetPubkey = c.req.param('targetPubkey')
  // Revoke all sessions before deletion
  await services.identity.revokeAllSessions(targetPubkey)
  await services.identity.deleteVolunteer(targetPubkey)
  await services.records.addAuditEntry('global', 'volunteerRemoved', pubkey, {
    target: targetPubkey,
  })
  return c.json({ ok: true })
})

export default volunteers
