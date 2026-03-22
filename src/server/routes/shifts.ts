import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const shifts = new Hono<AppEnv>()

// All authenticated users can check their shift status
shifts.get('/my-status', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const status = await services.shifts.getVolunteerStatus(pubkey, hubId)
  return c.json(status)
})

// --- Permission-gated routes ---

shifts.get('/fallback', requirePermission('shifts:manage-fallback'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const fallback = await services.settings.getFallbackGroup(hubId)
  return c.json({ volunteers: fallback })
})

shifts.put('/fallback', requirePermission('shifts:manage-fallback'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = (await c.req.json()) as { volunteers: string[] }
  await services.settings.setFallbackGroup(body.volunteers || [], hubId)
  return c.json({ ok: true })
})

shifts.get('/', requirePermission('shifts:read'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const schedules = await services.shifts.getSchedules(hubId)
  return c.json({ shifts: schedules })
})

shifts.post('/', requirePermission('shifts:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const schedule = await services.shifts.createSchedule({ ...body, hubId: hubId ?? 'global' })
  await services.records.addAuditEntry(hubId ?? 'global', 'shiftCreated', pubkey)
  return c.json(schedule, 201)
})

shifts.patch('/:id', requirePermission('shifts:update'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  const body = await c.req.json()
  const updated = await services.shifts.updateSchedule(id, body)
  await services.records.addAuditEntry(hubId ?? 'global', 'shiftEdited', pubkey, { shiftId: id })
  return c.json(updated)
})

shifts.delete('/:id', requirePermission('shifts:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  await services.shifts.deleteSchedule(id)
  await services.records.addAuditEntry(hubId ?? 'global', 'shiftDeleted', pubkey, { shiftId: id })
  return c.json({ ok: true })
})

export default shifts
