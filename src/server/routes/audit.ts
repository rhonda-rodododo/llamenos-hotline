import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const auditRoutes = new Hono<AppEnv>()
auditRoutes.use('*', requirePermission('audit:read'))

auditRoutes.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const result = await services.records.getAuditLog({
    page: Number.parseInt(c.req.query('page') || '1', 10),
    limit: Number.parseInt(c.req.query('limit') || '50', 10),
    ...(c.req.query('actorPubkey') ? { actorPubkey: c.req.query('actorPubkey')! } : {}),
    ...(c.req.query('eventType') ? { eventType: c.req.query('eventType')! } : {}),
    ...(c.req.query('dateFrom') ? { dateFrom: c.req.query('dateFrom')! } : {}),
    ...(c.req.query('dateTo') ? { dateTo: c.req.query('dateTo')! } : {}),
    ...(c.req.query('search') ? { search: c.req.query('search')! } : {}),
    hubId: hubId ?? 'global',
  })
  return c.json(result)
})

export default auditRoutes
