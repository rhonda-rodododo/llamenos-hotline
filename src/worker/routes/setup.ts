import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { adminGuard } from '../middleware/admin-guard'
import { audit } from '../services/audit'

const setup = new Hono<AppEnv>()

// Get setup state (any authenticated user — used for redirect logic)
setup.get('/state', async (c) => {
  const dos = getDOs(c.env)
  const res = await dos.settings.fetch(new Request('http://do/settings/setup'))
  return new Response(res.body, res)
})

// Update setup state (admin only)
setup.patch('/state', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.settings.fetch(new Request('http://do/settings/setup', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.records, 'setupStateUpdated', pubkey, body as Record<string, unknown>)
  return new Response(res.body, res)
})

// Complete setup (admin only)
setup.post('/complete', adminGuard, async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json().catch(() => ({})) as { demoMode?: boolean }

  const res = await dos.settings.fetch(new Request('http://do/settings/setup', {
    method: 'PATCH',
    body: JSON.stringify({ setupCompleted: true, demoMode: body.demoMode ?? false }),
  }))

  if (res.ok) await audit(dos.records, 'setupCompleted', pubkey, { demoMode: body.demoMode ?? false })
  return new Response(res.body, res)
})

// Test Signal bridge connection
setup.post('/test/signal', adminGuard, async (c) => {
  const body = await c.req.json() as { bridgeUrl: string; bridgeApiKey: string }

  if (!body.bridgeUrl) {
    return c.json({ ok: false, error: 'Bridge URL is required' }, 400)
  }

  // Validate URL
  let parsed: URL
  try { parsed = new URL(body.bridgeUrl) } catch {
    return c.json({ ok: false, error: 'Invalid bridge URL' }, 400)
  }

  // Block internal addresses
  const hostname = parsed.hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
      hostname.startsWith('10.') || hostname.startsWith('172.') || hostname.startsWith('192.168.') ||
      hostname === '169.254.169.254' || hostname === '0.0.0.0') {
    return c.json({ ok: false, error: 'Bridge URL must not point to internal addresses' }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const headers: Record<string, string> = {}
    if (body.bridgeApiKey) headers['Authorization'] = `Bearer ${body.bridgeApiKey}`

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
setup.post('/test/whatsapp', adminGuard, async (c) => {
  const body = await c.req.json() as { phoneNumberId: string; accessToken: string }

  if (!body.phoneNumberId || !body.accessToken) {
    return c.json({ ok: false, error: 'Phone Number ID and Access Token are required' }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${encodeURIComponent(body.phoneNumberId)}`,
      {
        headers: { 'Authorization': `Bearer ${body.accessToken}` },
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
