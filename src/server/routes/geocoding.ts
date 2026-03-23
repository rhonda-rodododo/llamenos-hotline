import { Hono } from 'hono'
import type { GeocodingConfigAdmin } from '../../shared/types'
import { createGeocodingAdapter } from '../geocoding/factory'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const geocoding = new Hono<AppEnv>()

/**
 * Helper: load geocoding config from SettingsService and create an adapter.
 */
async function getAdapter(c: { get: (key: 'services') => { settings: { getGeocodingConfig: () => Promise<GeocodingConfigAdmin> } } }) {
  const config = await c.get('services').settings.getGeocodingConfig()
  return { adapter: createGeocodingAdapter(config), config }
}

/**
 * Helper: check rate limit via SettingsService.
 */
async function isRateLimited(
  c: { get: (key: 'services') => { settings: { checkRateLimit: (key: string, maxPerMinute: number) => Promise<boolean> } } },
  key: string,
  maxPerMinute: number
): Promise<boolean> {
  return c.get('services').settings.checkRateLimit(key, maxPerMinute)
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

  if (await isRateLimited(c, `geocoding:autocomplete:${pubkey}`, 60)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c)
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

  if (await isRateLimited(c, `geocoding:geocode:${pubkey}`, 20)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c)
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

  if (await isRateLimited(c, `geocoding:reverse:${pubkey}`, 20)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c)
    const result = await adapter.reverse(body.lat, body.lon)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// --- GET /api/geocoding/settings ---
geocoding.get('/settings', requirePermission('settings:manage'), async (c) => {
  const config = await c.get('services').settings.getGeocodingConfig()
  return c.json(config)
})

// --- PATCH /api/geocoding/settings ---
geocoding.patch('/settings', requirePermission('settings:manage'), async (c) => {
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const updated = await c.get('services').settings.updateGeocodingConfig(body)
  await c.get('services').records.addAuditEntry('global', 'geocodingConfigUpdated', pubkey, {
    provider: (body as { provider?: string }).provider,
  })
  return c.json(updated)
})

// --- GET /api/geocoding/test ---
geocoding.get('/test', requirePermission('settings:manage'), async (c) => {
  try {
    const start = Date.now()
    const { adapter, config } = await getAdapter(c)

    if (!config.enabled || !config.provider || !config.apiKey) {
      return c.json({ ok: false, latency: 0, error: 'Geocoding not configured' })
    }

    const timeout = setTimeout(() => {}, 5000)
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
  const full = await c.get('services').settings.getGeocodingConfig()
  // Strip apiKey for public response
  const { apiKey: _, ...publicConfig } = full
  return c.json({ ...publicConfig })
})

export default geocoding
