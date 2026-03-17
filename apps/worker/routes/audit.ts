import { Hono } from 'hono'
import { describeRoute, validator } from 'hono-openapi'
import type { AppEnv } from '../types'
import { requirePermission } from '../middleware/permission-guard'
import { listAuditQuerySchema } from '@protocol/schemas/audit'
import { authErrors } from '../openapi/helpers'

const auditRoutes = new Hono<AppEnv>()
auditRoutes.use('*', requirePermission('audit:read'))

auditRoutes.get('/',
  describeRoute({
    tags: ['Audit'],
    summary: 'List audit log entries',
    responses: {
      200: { description: 'Paginated audit entries' },
      ...authErrors,
    },
  }),
  validator('query', listAuditQuerySchema),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId')
    const query = c.req.valid('query')

    const result = await services.audit.list(hubId, {
      actorPubkey: query.actorPubkey,
      eventType: query.eventType,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      search: query.search,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    })

    return c.json(result)
  },
)

export default auditRoutes
