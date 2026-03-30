import { secp256k1 } from '@noble/curves/secp256k1.js'
import { Hono } from 'hono'
import { isValidE164 } from '../lib/helpers'
import { projectVolunteer } from '../lib/volunteer-projector'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

/** Check that a string is a valid 64-char hex x-only secp256k1 pubkey (on the curve). */
function isValidSecp256k1Pubkey(pk: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(pk)) return false
  try {
    secp256k1.Point.fromHex(`02${pk}`)
    return true
  } catch {
    return false
  }
}

const volunteers = new Hono<AppEnv>()
volunteers.use('*', requirePermission('volunteers:read'))

volunteers.get('/', async (c) => {
  const services = c.get('services')
  const requestorPubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const isAdmin = checkPermission(permissions, 'settings:manage')

  const vols = await services.identity.getVolunteers()
  return c.json({ volunteers: vols.map((v) => projectVolunteer(v, requestorPubkey, isAdmin)) })
})

volunteers.get('/:targetPubkey', async (c) => {
  const services = c.get('services')
  const requestorPubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const isAdmin = checkPermission(permissions, 'settings:manage')
  const targetPubkey = c.req.param('targetPubkey')

  const volunteer = await services.identity.getVolunteer(targetPubkey)
  if (!volunteer) return c.json({ error: 'Not found' }, 404)

  // ?unmask=true: admin-only; creates audit entry
  const unmask = isAdmin && c.req.query('unmask') === 'true'
  if (unmask) {
    await services.records.addAuditEntry('global', 'phoneUnmasked', requestorPubkey, {
      target: targetPubkey,
    })
  }

  return c.json(projectVolunteer(volunteer, requestorPubkey, isAdmin, unmask))
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

  if (!isValidSecp256k1Pubkey(newPubkey)) {
    return c.json(
      { error: 'Invalid pubkey — must be a valid secp256k1 x-only public key (64 hex chars)' },
      400
    )
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

  // Return admin view for the creator (always an admin)
  return c.json({ volunteer: projectVolunteer(volunteer, pubkey, true) }, 201)
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
  // JWT tokens are short-lived; deactivated volunteers will fail auth on next request

  return c.json({ volunteer: projectVolunteer(updated, pubkey, true) })
})

volunteers.delete('/:targetPubkey', requirePermission('volunteers:delete'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const targetPubkey = c.req.param('targetPubkey')
  await services.identity.deleteVolunteer(targetPubkey)
  await services.records.addAuditEntry('global', 'volunteerRemoved', pubkey, {
    target: targetPubkey,
  })
  return c.json({ ok: true })
})

export default volunteers
