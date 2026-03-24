import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const reportTypesRoutes = new Hono<AppEnv>()

// GET /api/report-types — list all (active + archived) for hub; admin + volunteer
reportTypesRoutes.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  const types = await services.reportTypes.listReportTypes(hubId)
  return c.json({ reportTypes: types })
})

// POST /api/report-types — create a new report type (admin only)
reportTypesRoutes.post('/', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    name?: string
    description?: string
    isDefault?: boolean
  }>()

  if (!body.name?.trim()) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const reportType = await services.reportTypes.createReportType(hubId, {
    name: body.name.trim(),
    description: body.description?.trim() || undefined,
    isDefault: body.isDefault ?? false,
  })

  await services.records.addAuditEntry(hubId, 'reportTypeCreated', pubkey, {
    reportTypeId: reportType.id,
    name: reportType.name,
  })

  return c.json(reportType, 201)
})

// PATCH /api/report-types/:id — update name/description (admin only)
reportTypesRoutes.patch('/:id', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')

  const body = await c.req.json<{
    name?: string
    description?: string
  }>()

  const reportType = await services.reportTypes.updateReportType(hubId, id, {
    ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.description !== undefined
      ? { description: body.description.trim() || undefined }
      : {}),
  })

  await services.records.addAuditEntry(hubId, 'reportTypeUpdated', pubkey, {
    reportTypeId: id,
  })

  return c.json(reportType)
})

// DELETE /api/report-types/:id — archive (soft delete, admin only)
reportTypesRoutes.delete('/:id', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')

  await services.reportTypes.archiveReportType(hubId, id)

  await services.records.addAuditEntry(hubId, 'reportTypeArchived', pubkey, {
    reportTypeId: id,
  })

  return c.json({ ok: true })
})

// POST /api/report-types/:id/unarchive — restore archived type (admin only)
reportTypesRoutes.post('/:id/unarchive', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')

  const reportType = await services.reportTypes.unarchiveReportType(hubId, id)

  await services.records.addAuditEntry(hubId, 'reportTypeUnarchived', pubkey, {
    reportTypeId: id,
  })

  return c.json(reportType)
})

// POST /api/report-types/:id/default — set as default type (admin only)
reportTypesRoutes.post('/:id/default', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')

  const reportType = await services.reportTypes.setDefaultReportType(hubId, id)

  await services.records.addAuditEntry(hubId, 'reportTypeDefaultChanged', pubkey, {
    reportTypeId: id,
  })

  return c.json(reportType)
})

export default reportTypesRoutes
