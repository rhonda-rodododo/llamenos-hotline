import { Hono } from 'hono'
import { validateExternalUrl } from '../lib/ssrf-guard'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const setup = new Hono<AppEnv>()

// Get setup state (any authenticated user — used for redirect logic)
setup.get('/state', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const state = await services.settings.getSetupState(hubId ?? undefined)
  return c.json(state)
})

// Update setup state (admin only)
setup.patch('/state', requirePermission('settings:manage'), async (c) => {
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

// Complete setup (admin only) — also creates default hub if none exists
setup.post('/complete', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json().catch(() => ({}))) as { demoMode?: boolean }

  // Create default hub if none exists
  try {
    const existingHubs = await services.settings.getHubs()
    if (existingHubs.length === 0) {
      const hotlineName = c.env.HOTLINE_NAME || 'Hotline'
      const newHub = await services.settings.createHub({
        id: crypto.randomUUID(),
        name: hotlineName,
        createdBy: pubkey,
      })
      // Assign admin to the default hub with all roles
      await services.identity.setHubRole({
        pubkey,
        hubId: newHub.id,
        roleIds: ['role-super-admin'],
      })
      // Generate and distribute hub key so field decryption works immediately
      const { envelopes } = services.crypto.generateAndWrapHubKey([pubkey])
      await services.settings.setHubKeyEnvelopes(newHub.id, envelopes)
    }
  } catch {
    // Non-fatal — hub creation failing shouldn't block setup completion
  }

  const updated = await services.settings.updateSetupState(
    { setupCompleted: true, demoMode: body.demoMode ?? false },
    hubId ?? undefined
  )

  await services.records.addAuditEntry(hubId ?? 'global', 'setupCompleted', pubkey, {
    demoMode: body.demoMode ?? false,
  })
  return c.json(updated)
})

// Test Signal bridge connection
setup.post('/test/signal', requirePermission('settings:manage-messaging'), async (c) => {
  const body = (await c.req.json()) as { bridgeUrl: string; bridgeApiKey: string }

  if (!body.bridgeUrl) {
    return c.json({ ok: false, error: 'Bridge URL is required' }, 400)
  }

  const bridgeError = validateExternalUrl(body.bridgeUrl, 'Bridge URL')
  if (bridgeError) {
    return c.json({ ok: false, error: bridgeError }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const headers: Record<string, string> = {}
    if (body.bridgeApiKey) headers.Authorization = `Bearer ${body.bridgeApiKey}`

    const res = await fetch(`${body.bridgeUrl}/v1/about`, {
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      return c.json({ ok: true })
    }
    return c.json({ ok: false, error: `Bridge returned ${res.status}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

// Test WhatsApp connection (direct Meta API)
setup.post('/test/whatsapp', requirePermission('settings:manage-messaging'), async (c) => {
  const body = (await c.req.json()) as { phoneNumberId: string; accessToken: string }

  if (!body.phoneNumberId || !body.accessToken) {
    return c.json({ ok: false, error: 'Phone Number ID and Access Token are required' }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${encodeURIComponent(body.phoneNumberId)}`,
      {
        headers: { Authorization: `Bearer ${body.accessToken}` },
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)

    if (res.ok) {
      return c.json({ ok: true })
    }
    return c.json({ ok: false, error: `WhatsApp API returned ${res.status}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

export default setup
