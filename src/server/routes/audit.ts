import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const auditRoutes = new OpenAPIHono<AppEnv>()

// ── GET / — list audit log entries ──

const listAuditRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Audit'],
  summary: 'List audit log entries',
  middleware: [requirePermission('audit:read')],
  responses: {
    200: {
      description: 'Paginated audit log entries',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

auditRoutes.openapi(listAuditRoute, async (c) => {
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
  return c.json(result, 200)
})

export default auditRoutes
