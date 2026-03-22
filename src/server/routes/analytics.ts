import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const analytics = new Hono<AppEnv>()

/**
 * GET /api/analytics/calls?days=7|30
 * Returns call volume grouped by day for the last N days.
 * Permission: calls:read-history
 */
analytics.get('/calls', requirePermission('calls:read-history'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const daysParam = c.req.query('days')
  const days = daysParam === '7' ? 7 : 30

  const data = await services.records.getCallVolumeByDay(hubId, days)
  return c.json({ days, data })
})

/**
 * GET /api/analytics/hours?days=30
 * Returns call count per hour (0–23) for the last N days.
 * Permission: calls:read-history
 */
analytics.get('/hours', requirePermission('calls:read-history'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const data = await services.records.getCallHourDistribution(hubId, 30)
  return c.json({ days: 30, data })
})

/**
 * GET /api/analytics/volunteers?days=30
 * Returns per-volunteer call stats for the last N days.
 * Permission: audit:read (admin only)
 */
analytics.get('/volunteers', requirePermission('audit:read'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const data = await services.records.getVolunteerCallStats(hubId, 30)
  return c.json({ days: 30, data })
})

export default analytics
