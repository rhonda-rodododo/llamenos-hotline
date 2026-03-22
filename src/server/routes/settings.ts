import { Hono } from 'hono'
import { validateExternalUrl } from '../lib/ssrf-guard'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

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
  return c.json(fields)
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
  return c.json(await services.settings.getIvrLanguages(hubId ?? undefined))
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
    const body = (await c.req.json()) as {
      type: string
      accountSid?: string
      authToken?: string
      phoneNumber?: string
      signalwireSpace?: string
      apiKey?: string
      apiSecret?: string
      applicationId?: string
      authId?: string
      ariUrl?: string
      ariUsername?: string
      ariPassword?: string
    }
    try {
      let testUrl: string
      const testHeaders: Record<string, string> = {}

      switch (body.type) {
        case 'twilio':
          testUrl = `https://api.twilio.com/2010-04-01/Accounts/${body.accountSid}.json`
          testHeaders.Authorization = `Basic ${btoa(`${body.accountSid}:${body.authToken}`)}`
          break
        case 'signalwire': {
          if (!body.signalwireSpace || !/^[a-zA-Z0-9_-]+$/.test(body.signalwireSpace)) {
            return Response.json(
              { ok: false, error: 'Invalid SignalWire space name' },
              { status: 400 }
            )
          }
          testUrl = `https://${body.signalwireSpace}.signalwire.com/api/relay/rest/phone_numbers`
          testHeaders.Authorization = `Basic ${btoa(`${body.accountSid}:${body.authToken}`)}`
          break
        }
        case 'vonage':
          testUrl = `https://rest.nexmo.com/account/get-balance?api_key=${encodeURIComponent(body.apiKey || '')}&api_secret=${encodeURIComponent(body.apiSecret || '')}`
          break
        case 'plivo':
          testUrl = `https://api.plivo.com/v1/Account/${encodeURIComponent(body.authId || '')}/`
          testHeaders.Authorization = `Basic ${btoa(`${body.authId}:${body.authToken}`)}`
          break
        case 'asterisk': {
          if (!body.ariUrl) {
            return Response.json({ ok: false, error: 'ARI URL is required' }, { status: 400 })
          }
          const ariError = validateExternalUrl(body.ariUrl, 'ARI URL')
          if (ariError) {
            return Response.json({ ok: false, error: ariError }, { status: 400 })
          }
          testUrl = `${body.ariUrl}/api/asterisk/info`
          testHeaders.Authorization = `Basic ${btoa(`${body.ariUsername}:${body.ariPassword}`)}`
          break
        }
        default:
          return Response.json({ ok: false, error: 'Unknown provider type' }, { status: 400 })
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const testRes = await fetch(testUrl, { headers: testHeaders, signal: controller.signal })
        clearTimeout(timeout)
        if (testRes.ok) {
          return Response.json({ ok: true })
        }
        return Response.json(
          { ok: false, error: `Provider returned ${testRes.status}` },
          { status: 400 }
        )
      } finally {
        clearTimeout(timeout)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      return Response.json({ ok: false, error: message }, { status: 400 })
    }
  }
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
  return c.json(await services.settings.getIvrAudioList(hubId ?? undefined))
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
  return c.json(await services.settings.listRoles(hubId ?? undefined))
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

// --- Permissions catalog ---
settings.get('/permissions', requirePermission('system:manage-roles'), async (c) => {
  const { PERMISSION_CATALOG, getPermissionsByDomain } = await import('../../shared/permissions')
  return c.json({
    permissions: PERMISSION_CATALOG,
    byDomain: getPermissionsByDomain(),
  })
})

export default settings
