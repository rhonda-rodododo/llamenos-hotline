import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Hub } from '../../shared/types'
import { getDb } from '../db'
import { hubStorageCredentials, hubStorageSettings } from '../db/schema/storage'
import { encryptStorageCredential } from '../lib/crypto'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import { type AppEnv, STORAGE_NAMESPACES, type StorageNamespace } from '../types'

const routes = new Hono<AppEnv>()

// List hubs (filtered by user's membership, super admin sees all)
routes.get('/', async (c) => {
  const services = c.get('services')
  const volunteer = c.get('volunteer')
  const permissions = c.get('permissions')

  const allHubs = await services.settings.getHubs()

  // Super admin sees all (including archived — needed for hub management page)
  if (checkPermission(permissions, '*')) {
    return c.json({ hubs: allHubs })
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

  if (services.storage) {
    try {
      const iamResult = await services.storage.provisionHub(hub.id)

      // Store per-hub IAM credentials if created
      if (iamResult) {
        const serverSecret = c.env.HMAC_SECRET
        const encrypted = encryptStorageCredential(iamResult.secretAccessKey, serverSecret)
        const db = getDb()
        await db.insert(hubStorageCredentials).values({
          hubId: hub.id,
          accessKeyId: iamResult.accessKeyId,
          encryptedSecretKey: encrypted,
          policyName: iamResult.policyName,
          userName: iamResult.userName,
        })
      }
    } catch (err) {
      console.error(`[hubs] Failed to provision storage for hub ${hub.id}:`, err)
    }
  }

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

// Archive hub (super admin only — soft-delete: sets status to 'archived')
routes.post('/:hubId/archive', requirePermission('system:manage-hubs'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')

  try {
    const updated = await services.settings.updateHub(hubId, { status: 'archived' })
    return c.json({ hub: updated })
  } catch {
    return c.json({ error: 'Failed to archive hub' }, 500)
  }
})

// Export hub data as ZIP (super admin only — includes DB records + encrypted blob files)
routes.get('/:hubId/export', requirePermission('system:manage-hubs'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const categoriesParam =
    c.req.query('categories') || 'notes,calls,conversations,audit,voicemails,attachments'
  const validCategories = new Set([
    'notes',
    'calls',
    'conversations',
    'audit',
    'voicemails',
    'attachments',
  ])
  const categories = categoriesParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => validCategories.has(s))

  if (categories.length === 0) {
    return c.json({ error: 'No valid categories specified' }, 400)
  }

  const hub = await services.settings.getHub(hubId)
  if (!hub) return c.json({ error: 'Hub not found' }, 404)

  const { zipSync, strToU8 } = await import('fflate')

  const zipFiles: Record<string, Uint8Array> = {}

  // Manifest with metadata
  const manifest: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    hubId,
    hubName: hub.name,
    categories,
    note: 'All content fields are E2EE ciphertext. Decryption requires the hub key.',
  }

  // DB record exports as JSON files
  if (categories.includes('notes')) {
    const { notes, total } = await services.records.getNotes({ hubId })
    zipFiles['records/notes.json'] = strToU8(JSON.stringify({ total, records: notes }, null, 2))
  }
  if (categories.includes('calls')) {
    const { calls, total } = await services.records.getCallHistory(1, 100_000, hubId)
    zipFiles['records/calls.json'] = strToU8(JSON.stringify({ total, records: calls }, null, 2))
  }
  if (categories.includes('conversations')) {
    const { conversations, total } = await services.conversations.listConversations({ hubId })
    zipFiles['records/conversations.json'] = strToU8(
      JSON.stringify({ total, records: conversations }, null, 2)
    )
  }
  if (categories.includes('audit')) {
    const { entries, total } = await services.records.getAuditLog({ hubId, limit: 100_000 })
    zipFiles['records/audit.json'] = strToU8(JSON.stringify({ total, records: entries }, null, 2))
  }

  // Blob exports — encrypted files from object storage
  const includeBlobs = categories.includes('voicemails') || categories.includes('attachments')
  if (includeBlobs && services.files.hasStorage) {
    const allFiles = await services.files.getFilesByHub(hubId)
    let blobCount = 0

    for (const fileRecord of allFiles) {
      const isVoicemail = fileRecord.contextType === 'voicemail'
      const category = isVoicemail ? 'voicemails' : 'attachments'
      if (!categories.includes(category)) continue

      const namespace = isVoicemail ? ('voicemails' as const) : ('attachments' as const)
      try {
        const blob = await services.storage?.get(hubId, namespace, `${fileRecord.id}/content`)
        if (blob) {
          zipFiles[`${category}/${fileRecord.id}/content.bin`] = new Uint8Array(
            await blob.arrayBuffer()
          )
          blobCount++
        }
      } catch {
        // Skip files that can't be retrieved — may have been cleaned up by lifecycle
      }

      // Include metadata/envelopes if available
      try {
        const envelopes = await services.storage?.get(
          hubId,
          'attachments',
          `${fileRecord.id}/envelopes`
        )
        if (envelopes) {
          zipFiles[`${category}/${fileRecord.id}/envelopes.json`] = new Uint8Array(
            await envelopes.arrayBuffer()
          )
        }
      } catch {}
      try {
        const meta = await services.storage?.get(hubId, 'attachments', `${fileRecord.id}/metadata`)
        if (meta) {
          zipFiles[`${category}/${fileRecord.id}/metadata.json`] = new Uint8Array(
            await meta.arrayBuffer()
          )
        }
      } catch {}
    }

    manifest.blobsIncluded = blobCount
    manifest.fileRecords = allFiles.length
  }

  zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))

  const zipData = zipSync(zipFiles)

  const zipBuffer = new Uint8Array(zipData).buffer as ArrayBuffer
  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="hub-${hubId}-export.zip"`,
      'Content-Length': String(zipData.length),
    },
  })
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
    // Look up IAM credentials BEFORE deleting hub (cascade would remove them)
    let storedUserName: string | undefined
    if (services.storage) {
      try {
        const db = getDb()
        const [cred] = await db
          .select({ userName: hubStorageCredentials.userName })
          .from(hubStorageCredentials)
          .where(eq(hubStorageCredentials.hubId, hubId))
        storedUserName = cred?.userName
      } catch {
        // No credentials stored — hub may not have had IAM provisioned
      }
    }

    await services.settings.deleteHub(hubId)

    if (services.storage) {
      try {
        await services.storage.destroyHub(hubId, storedUserName)
      } catch (err) {
        console.error(`[hubs] Failed to destroy storage for hub ${hubId} — orphaned buckets:`, err)
      }
    }

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

  return c.json({
    wrappedKey: myEnvelope.wrappedKey,
    ephemeralPubkey: myEnvelope.ephemeralPubkey,
    ephemeralPk: myEnvelope.ephemeralPubkey, // backwards compat
  })
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

  // Verify hub exists first
  const hub = await services.settings.getHub(hubId)
  if (!hub) return c.json({ error: 'Hub not found' }, 404)

  const envelopes = await services.settings.getHubKeyEnvelopes(hubId)
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

// --- Hub Storage Settings ---

// GET merged storage settings (hub overrides + platform defaults)
routes.get('/:hubId/storage-settings', requirePermission('settings:manage'), async (c) => {
  const hubId = c.req.param('hubId')
  const db = getDb()

  const overrides = await db
    .select()
    .from(hubStorageSettings)
    .where(eq(hubStorageSettings.hubId, hubId))

  const overrideMap = new Map(overrides.map((o) => [o.namespace, o.retentionDays]))

  const settings = Object.entries(STORAGE_NAMESPACES).map(([ns, defaults]) => ({
    namespace: ns as StorageNamespace,
    retentionDays: overrideMap.has(ns) ? overrideMap.get(ns)! : defaults.defaultRetentionDays,
    isOverridden: overrideMap.has(ns),
    platformDefault: defaults.defaultRetentionDays,
  }))

  return c.json({ settings })
})

// PATCH update retention for a namespace
routes.patch('/:hubId/storage-settings', requirePermission('settings:manage'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const db = getDb()

  const body = (await c.req.json()) as {
    namespace: string
    retentionDays: number | null
  }

  // Validate namespace
  if (!body.namespace || !(body.namespace in STORAGE_NAMESPACES)) {
    return c.json(
      { error: `Invalid namespace. Must be one of: ${Object.keys(STORAGE_NAMESPACES).join(', ')}` },
      400
    )
  }

  const ns = body.namespace as StorageNamespace
  const platformDefault = STORAGE_NAMESPACES[ns].defaultRetentionDays

  // Enforce platform cap: hub can't set retention higher than platform default
  if (
    body.retentionDays !== null &&
    platformDefault !== null &&
    body.retentionDays > platformDefault
  ) {
    return c.json(
      { error: `Retention cannot exceed platform default of ${platformDefault} days` },
      400
    )
  }

  // Validate retentionDays is a positive integer or null
  if (body.retentionDays !== null) {
    if (!Number.isInteger(body.retentionDays) || body.retentionDays < 1) {
      return c.json({ error: 'retentionDays must be a positive integer or null' }, 400)
    }
  }

  // Upsert into hub_storage_settings
  await db
    .insert(hubStorageSettings)
    .values({
      hubId,
      namespace: ns,
      retentionDays: body.retentionDays,
    })
    .onConflictDoUpdate({
      target: [hubStorageSettings.hubId, hubStorageSettings.namespace],
      set: { retentionDays: body.retentionDays },
    })

  // Apply to storage backend if available
  if (services.storage) {
    try {
      await services.storage.setRetention(hubId, ns, body.retentionDays)
    } catch (err) {
      console.error('[hubs] Failed to apply retention to storage backend:', err)
    }
  }

  // Audit log
  await services.records.addAuditEntry(hubId, 'storage.retention.updated', pubkey, {
    namespace: ns,
    retentionDays: body.retentionDays,
    platformDefault,
  })

  return c.json({ ok: true, namespace: ns, retentionDays: body.retentionDays })
})

export default routes
