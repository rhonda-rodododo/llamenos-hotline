import { Hono } from 'hono'
import type { Hub } from '../../shared/types'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const routes = new Hono<AppEnv>()

// List hubs (filtered by user's membership, super admin sees all)
routes.get('/', async (c) => {
  const services = c.get('services')
  const volunteer = c.get('volunteer')
  const permissions = c.get('permissions')

  const allHubs = await services.settings.getHubs()

  // Super admin sees all
  if (checkPermission(permissions, '*')) {
    return c.json({ hubs: allHubs.filter((h) => h.status === 'active') })
  }

  // Others see only their hubs
  const userHubIds = new Set((volunteer.hubRoles || []).map((hr) => hr.hubId))
  return c.json({ hubs: allHubs.filter((h) => h.status === 'active' && userHubIds.has(h.id)) })
})

// Create hub (super admin only)
routes.post('/', requirePermission('system:manage-hubs'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as {
    name: string
    slug?: string
    description?: string
    phoneNumber?: string
  }

  if (!body.name?.trim()) return c.json({ error: 'Name required' }, 400)

  const hubData = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    slug:
      body.slug?.trim() ||
      body.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-'),
    description: body.description?.trim(),
    status: 'active' as const,
    phoneNumber: body.phoneNumber?.trim(),
    createdBy: pubkey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const hub = await services.settings.createHub({
    id: hubData.id,
    name: hubData.name,
    slug: hubData.slug,
    description: hubData.description,
    status: hubData.status,
    phoneNumber: hubData.phoneNumber,
    createdBy: hubData.createdBy,
  })

  return c.json({ hub })
})

// Get hub details
routes.get('/:hubId', async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const volunteer = c.get('volunteer')
  const permissions = c.get('permissions')

  const hub = await services.settings.getHub(hubId)
  if (!hub) return c.json({ error: 'Hub not found' }, 404)

  // Check access
  const isSuperAdmin = checkPermission(permissions, '*')
  const hasHubAccess = (volunteer.hubRoles || []).some((hr) => hr.hubId === hubId)
  if (!isSuperAdmin && !hasHubAccess) {
    return c.json({ error: 'Access denied' }, 403)
  }

  return c.json({ hub })
})

// Update hub
routes.patch('/:hubId', requirePermission('system:manage-hubs'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const body = (await c.req.json()) as Partial<Hub>

  try {
    const updated = await services.settings.updateHub(hubId, body)
    return c.json({ hub: updated })
  } catch {
    return c.json({ error: 'Failed to update hub' }, 500)
  }
})

// Delete hub (super admin only — cascades all hub data)
routes.delete('/:hubId', requirePermission('system:manage-hubs'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')

  // Safety gate: refuse if there are active calls on this hub
  const hubCalls = await services.calls.getActiveCalls(hubId)
  if (hubCalls.some((call) => call.status === 'ringing' || call.status === 'in-progress')) {
    return c.json({ error: 'Cannot delete hub with active calls in progress' }, 409)
  }

  try {
    await services.settings.deleteHub(hubId)
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return c.json({ error: 'Hub not found' }, 404)
    }
    return c.json({ error: 'Failed to delete hub' }, 500)
  }
})

// Add member to hub
routes.post('/:hubId/members', requirePermission('volunteers:manage-roles'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const body = (await c.req.json()) as { pubkey: string; roleIds: string[] }

  if (!body.pubkey || !body.roleIds?.length) {
    return c.json({ error: 'pubkey and roleIds required' }, 400)
  }

  try {
    const updated = await services.identity.setHubRole({
      pubkey: body.pubkey,
      hubId,
      roleIds: body.roleIds,
    })
    return c.json(updated)
  } catch {
    return c.json({ error: 'Failed to add member' }, 500)
  }
})

// Remove member from hub
routes.delete(
  '/:hubId/members/:pubkey',
  requirePermission('volunteers:manage-roles'),
  async (c) => {
    const hubId = c.req.param('hubId')
    const pubkey = c.req.param('pubkey')
    const services = c.get('services')

    try {
      await services.identity.removeHubRole(pubkey, hubId)
      return c.json({ ok: true })
    } catch {
      return c.json({ error: 'Failed to remove member' }, 500)
    }
  }
)

// --- Hub Settings (zero-trust visibility) ---

// Update hub settings (hub admin only — super admin CANNOT modify their own access)
routes.patch('/:hubId/settings', requirePermission('settings:manage'), async (c) => {
  const hubId = c.req.param('hubId')
  const body = (await c.req.json()) as { allowSuperAdminAccess?: boolean }
  const callerPubkey = c.get('pubkey')
  const services = c.get('services')

  if (body.allowSuperAdminAccess !== undefined) {
    // Super admin cannot self-grant visibility
    const isSuperAdmin = await services.identity.isSuperAdmin(callerPubkey)
    if (isSuperAdmin) {
      return c.json({ error: 'Super admin cannot modify their own hub access' }, 403)
    }
    await services.settings.updateHub(hubId, { allowSuperAdminAccess: body.allowSuperAdminAccess })
  }
  return c.body(null, 204)
})

// --- Hub Key Management ---

// Get my hub key envelope (re-fetch after rotation)
routes.get('/:hubId/key-envelope', async (c) => {
  const hubId = c.req.param('hubId')
  const pubkey = c.get('pubkey')
  const services = c.get('services')

  const envelopes = await services.settings.getHubKeyEnvelopes(hubId)
  const myEnvelope = envelopes.find((e) => e.pubkey === pubkey)
  if (!myEnvelope) return c.json({ error: 'not_a_member' }, 404)

  return c.json({ wrappedKey: myEnvelope.wrappedKey, ephemeralPk: myEnvelope.ephemeralPubkey })
})

// Get my hub key envelope (any hub member — membership required)
routes.get('/:hubId/key', async (c) => {
  const hubId = c.req.param('hubId')
  const pubkey = c.get('pubkey')
  const volunteer = c.get('volunteer')
  const permissions = c.get('permissions')
  const services = c.get('services')

  // Enforce hub membership — only members and super-admins may fetch hub key envelopes
  const isSuperAdmin = checkPermission(permissions, '*')
  const isMember = (volunteer.hubRoles || []).some((hr) => hr.hubId === hubId)
  if (!isSuperAdmin && !isMember) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const envelopes = await services.settings.getHubKeyEnvelopes(hubId)
  if (!envelopes.length) return c.json({ error: 'Hub not found' }, 404)

  // Return only the envelope for this user
  const myEnvelope = envelopes.find((e) => e.pubkey === pubkey)
  if (!myEnvelope) return c.json({ error: 'No key envelope for this user' }, 404)

  return c.json({ envelope: myEnvelope })
})

// Set hub key envelopes (admin only — distributes wrapped hub key to all members)
routes.put('/:hubId/key', requirePermission('system:manage-hubs'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const body = (await c.req.json()) as {
    envelopes: { pubkey: string; wrappedKey: string; ephemeralPubkey: string }[]
  }

  if (!Array.isArray(body.envelopes) || body.envelopes.length === 0) {
    return c.json({ error: 'At least one envelope required' }, 400)
  }

  try {
    await services.settings.setHubKeyEnvelopes(hubId, body.envelopes)
    return c.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set hub key'
    return c.json({ error: message }, 500)
  }
})

export default routes
