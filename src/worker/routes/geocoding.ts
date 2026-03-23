import { Hono } from 'hono'
import type { GeocodingConfigAdmin } from '../../shared/types'
import { createGeocodingAdapter } from '../geocoding/factory'
import { getDOs } from '../lib/do-access'
import { requirePermission } from '../middleware/permission-guard'
import { audit } from '../services/audit'
import type { AppEnv } from '../types'

const geocoding = new Hono<AppEnv>()

/**
 * Helper: load geocoding config from SettingsDO and create an adapter.
 * Recreated per-request since adapter is stateless.
 */
async function getAdapter(env: AppEnv['Bindings']) {
  const dos = getDOs(env)
  const res = await dos.settings.fetch(new Request('http://do/settings/geocoding/admin'))
  const config = (await res.json()) as GeocodingConfigAdmin
  return { adapter: createGeocodingAdapter(config), config }
}

/**
 * Helper: check rate limit via SettingsDO.
 * Returns true if the request should be blocked.
 */
async function isRateLimited(
  env: AppEnv['Bindings'],
  key: string,
  maxPerMinute: number
): Promise<boolean> {
  const dos = getDOs(env)
  const res = await dos.settings.fetch(
    new Request('http://do/rate-limit/check', {
      method: 'POST',
      body: JSON.stringify({ key, maxPerMinute }),
    })
  )
  const data = (await res.json()) as { limited: boolean }
  return data.limited
}

// --- POST /api/geocoding/autocomplete ---
geocoding.post('/autocomplete', requirePermission('notes:create'), async (c) => {
  const body = (await c.req.json()) as { query?: string; limit?: number }
  if (!body.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
    return c.json({ error: 'Query string required' }, 400)
  }
  const query = body.query.trim()
  const limit = Math.min(Math.max(body.limit ?? 5, 1), 10)
  const pubkey = c.get('pubkey')

  if (await isRateLimited(c.env, `geocoding:autocomplete:${pubkey}`, 60)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c.env)
    const results = await adapter.autocomplete(query, { limit })
    return c.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// --- POST /api/geocoding/geocode ---
geocoding.post('/geocode', requirePermission('notes:create'), async (c) => {
  const body = (await c.req.json()) as { address?: string }
  if (!body.address || typeof body.address !== 'string' || body.address.trim().length === 0) {
    return c.json({ error: 'Address string required' }, 400)
  }
  const pubkey = c.get('pubkey')

  if (await isRateLimited(c.env, `geocoding:geocode:${pubkey}`, 20)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c.env)
    const result = await adapter.geocode(body.address.trim())
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// --- POST /api/geocoding/reverse ---
geocoding.post('/reverse', requirePermission('notes:create'), async (c) => {
  const body = (await c.req.json()) as { lat?: number; lon?: number }
  if (typeof body.lat !== 'number' || typeof body.lon !== 'number') {
    return c.json({ error: 'lat and lon numbers required' }, 400)
  }
  if (body.lat < -90 || body.lat > 90 || body.lon < -180 || body.lon > 180) {
    return c.json({ error: 'Invalid coordinates' }, 400)
  }
  const pubkey = c.get('pubkey')

  if (await isRateLimited(c.env, `geocoding:reverse:${pubkey}`, 20)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c.env)
    const result = await adapter.reverse(body.lat, body.lon)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// --- GET /api/geocoding/settings ---
geocoding.get('/settings', requirePermission('settings:manage'), async (c) => {
  const dos = getDOs(c.env)
  const res = await dos.settings.fetch(new Request('http://do/settings/geocoding/admin'))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

// --- PATCH /api/geocoding/settings ---
geocoding.patch('/settings', requirePermission('settings:manage'), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.settings.fetch(
    new Request('http://do/settings/geocoding', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  )
  if (res.ok) {
    await audit(dos.records, 'geocodingConfigUpdated', pubkey, {
      provider: (body as { provider?: string }).provider,
    })
  }
  return new Response(res.body, { status: res.status, headers: res.headers })
})

// --- GET /api/geocoding/test ---
geocoding.get('/test', requirePermission('settings:manage'), async (c) => {
  try {
    const start = Date.now()
    const { adapter, config } = await getAdapter(c.env)

    if (!config.enabled || !config.provider || !config.apiKey) {
      return c.json({ ok: false, latency: 0, error: 'Geocoding not configured' })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const result = await adapter.geocode('London, UK')
      clearTimeout(timeout)
      const latency = Date.now() - start
      return c.json({ ok: !!result, latency })
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test failed'
    return c.json({ ok: false, latency: 0, error: message })
  }
})

// --- GET /api/geocoding/config (public, no apiKey) ---
geocoding.get('/config', async (c) => {
  const dos = getDOs(c.env)
  const res = await dos.settings.fetch(new Request('http://do/settings/geocoding'))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

export default geocoding
