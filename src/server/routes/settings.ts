import { Hono } from 'hono'
import { MESSAGING_CAPABILITIES } from '../messaging/capabilities'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import { TELEPHONY_CAPABILITIES } from '../telephony/capabilities'
import type { AppEnv } from '../types'
import type { TelephonyProviderType, MessagingChannelType } from '@shared/types'

const settings = new Hono<AppEnv>()

// --- Transcription settings: readable by all authenticated, writable by settings:manage ---
settings.get('/transcription', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const data = await services.settings.getTranscriptionSettings(hubId ?? undefined)
  return c.json(data)
})

settings.patch('/transcription', requirePermission('settings:manage-transcription'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateTranscriptionSettings(
    body as Parameters<typeof services.settings.updateTranscriptionSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'transcriptionToggled',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

// --- Custom fields: readable by all authenticated (filtered by permissions), writable by admin ---
settings.get('/custom-fields', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const canManageFields = checkPermission(permissions, 'settings:manage-fields')
  const fields = await services.settings.getCustomFields(
    canManageFields ? 'admin' : 'volunteer',
    hubId ?? undefined
  )
  return c.json({ fields })
})

settings.put('/custom-fields', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateCustomFields(
    body as Parameters<typeof services.settings.updateCustomFields>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'customFieldsUpdated', pubkey, {})
  return c.json(updated)
})

// --- All remaining settings: require specific permissions ---
settings.get('/spam', requirePermission('settings:manage-spam'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getSpamSettings(hubId ?? undefined))
})

settings.patch('/spam', requirePermission('settings:manage-spam'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateSpamSettings(
    body as Parameters<typeof services.settings.updateSpamSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'spamMitigationToggled',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

settings.get('/call', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getCallSettings(hubId ?? undefined))
})

settings.patch('/call', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateCallSettings(
    body as Parameters<typeof services.settings.updateCallSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'callSettingsUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

settings.get('/ivr-languages', requirePermission('settings:manage-ivr'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const enabledLanguages = await services.settings.getIvrLanguages(hubId ?? undefined)
  return c.json({ enabledLanguages })
})

settings.patch('/ivr-languages', requirePermission('settings:manage-ivr'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateIvrLanguages(body as string[], hubId ?? undefined)
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'ivrLanguagesUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

settings.get('/webauthn', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  return c.json(await services.identity.getWebAuthnSettings())
})

settings.patch('/webauthn', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.identity.updateWebAuthnSettings(
    body as Parameters<typeof services.identity.updateWebAuthnSettings>[0]
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'webauthnSettingsUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

// --- Provider health status ---
settings.get('/provider-health', requirePermission('settings:read'), async (c) => {
  const healthService = c.get('services').providerHealth
  if (!healthService) return c.json({ error: 'Health service not available' }, 503)
  return c.json(healthService.getHealthStatus())
})

// --- Telephony Provider settings ---
settings.get('/telephony-provider', requirePermission('settings:manage-telephony'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const config = await services.settings.getTelephonyProvider(hubId ?? undefined)
  return c.json(config)
})

settings.patch('/telephony-provider', requirePermission('settings:manage-telephony'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateTelephonyProvider(
    body as Parameters<typeof services.settings.updateTelephonyProvider>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'telephonyProviderChanged', pubkey, {
    type: (body as { type?: string }).type,
  })
  return c.json(updated)
})

settings.post(
  '/telephony-provider/test',
  requirePermission('settings:manage-telephony'),
  async (c) => {
    const config = await c.req.json() as { type: string; [key: string]: unknown }
    const capabilities = TELEPHONY_CAPABILITIES[config.type as TelephonyProviderType]
    if (!capabilities) return c.json({ ok: false, error: `Unknown provider: ${config.type}` }, 400)

    const parsed = capabilities.credentialSchema.safeParse(config)
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid config', details: parsed.error }, 400)

    try {
      const result = await capabilities.testConnection(parsed.data)
      return c.json({ ok: result.connected, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      return c.json({ ok: false, error: message }, { status: 400 })
    }
  },
)

// SMS / messaging channel connection test
settings.post(
  '/messaging/test',
  requirePermission('settings:manage-messaging'),
  async (c) => {
    const hubId = c.get('hubId')
    const body = (await c.req.json()) as { channel: string }
    const channel = body.channel as MessagingChannelType
    const capabilities = MESSAGING_CAPABILITIES[channel]
    if (!capabilities) return c.json({ error: `Unknown channel: ${body.channel}` }, 400)

    const services = c.get('services')
    const messagingConfig = await services.settings.getMessagingConfig(hubId ?? undefined)
    if (!messagingConfig) return c.json({ error: 'Messaging not configured' }, 400)

    const channelConfig = messagingConfig[channel as keyof typeof messagingConfig]
    if (!channelConfig || typeof channelConfig !== 'object') {
      return c.json({ error: `Channel ${body.channel} not configured` }, 400)
    }

    try {
      const result = await capabilities.testConnection(channelConfig as Parameters<typeof capabilities.testConnection>[0])
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      return c.json({ connected: false, latencyMs: 0, error: message, errorType: 'unknown' as const }, { status: 400 })
    }
  },
)

// --- Messaging config ---
settings.get('/messaging', requirePermission('settings:manage-messaging'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getMessagingConfig(hubId ?? undefined))
})

settings.patch('/messaging', requirePermission('settings:manage-messaging'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateMessagingConfig(
    body as Parameters<typeof services.settings.updateMessagingConfig>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'messagingConfigUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

// --- Setup state ---
settings.get('/setup', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.settings.getSetupState(hubId ?? undefined))
})

settings.patch('/setup', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await services.settings.updateSetupState(
    body as Parameters<typeof services.settings.updateSetupState>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'setupStateUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated)
})

settings.get('/ivr-audio', requirePermission('settings:manage-ivr'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const recordings = await services.settings.getIvrAudioList(hubId ?? undefined)
  return c.json({ recordings })
})

settings.put(
  '/ivr-audio/:promptType/:language',
  requirePermission('settings:manage-ivr'),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId')
    const pubkey = c.get('pubkey')
    const promptType = c.req.param('promptType')
    const language = c.req.param('language')
    const rawBuffer = await c.req.arrayBuffer()
    const audioData = btoa(String.fromCharCode(...new Uint8Array(rawBuffer)))
    const mimeType = c.req.header('content-type') || 'audio/wav'
    await services.settings.upsertIvrAudio({
      hubId: hubId ?? 'global',
      promptType,
      language,
      audioData,
      mimeType,
    })
    await services.records.addAuditEntry(hubId ?? 'global', 'ivrAudioUploaded', pubkey, {
      promptType,
      language,
    })
    return c.json({ ok: true })
  }
)

settings.delete(
  '/ivr-audio/:promptType/:language',
  requirePermission('settings:manage-ivr'),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId')
    const pubkey = c.get('pubkey')
    const promptType = c.req.param('promptType')
    const language = c.req.param('language')
    await services.settings.deleteIvrAudio(promptType, language, hubId ?? undefined)
    await services.records.addAuditEntry(hubId ?? 'global', 'ivrAudioDeleted', pubkey, {
      promptType,
      language,
    })
    return c.json({ ok: true })
  }
)

// --- Roles (PBAC) ---
settings.get('/roles', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const rolesList = await services.settings.listRoles(hubId ?? undefined)
  return c.json({ roles: rolesList })
})

settings.post('/roles', requirePermission('system:manage-roles'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const role = await services.settings.createRole(
    body as Parameters<typeof services.settings.createRole>[0]
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'roleCreated', pubkey, {
    name: (body as { name?: string }).name,
  })
  return c.json(role, 201)
})

settings.patch('/roles/:id', requirePermission('system:manage-roles'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  const body = await c.req.json()
  const role = await services.settings.updateRole(
    id,
    body as Parameters<typeof services.settings.updateRole>[1]
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'roleUpdated', pubkey, { roleId: id })
  return c.json(role)
})

settings.delete('/roles/:id', requirePermission('system:manage-roles'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  await services.settings.deleteRole(id)
  await services.records.addAuditEntry(hubId ?? 'global', 'roleDeleted', pubkey, { roleId: id })
  return c.json({ ok: true })
})

// --- Data Retention settings ---
settings.get('/retention', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  return c.json(await services.gdpr.getRetentionSettings(hubId ?? undefined))
})

settings.put('/retention', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json<Record<string, unknown>>()
  const updated = await services.gdpr.updateRetentionSettings(
    body as Parameters<typeof services.gdpr.updateRetentionSettings>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(hubId ?? 'global', 'retentionSettingsUpdated', pubkey, {})
  return c.json(updated)
})

// --- Permissions catalog ---
settings.get('/permissions', requirePermission('system:manage-roles'), async (c) => {
  const { PERMISSION_CATALOG, getPermissionsByDomain } = await import('../../shared/permissions')
  return c.json({
    permissions: PERMISSION_CATALOG,
    byDomain: getPermissionsByDomain(),
  })
})

export default settings
