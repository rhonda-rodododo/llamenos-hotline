import { Hono } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../types'
import { getScopedDOs } from '../lib/do-access'
import { requirePermission } from '../middleware/permission-guard'
import { validateBody } from '../middleware/validate'
import { createShiftBodySchema, updateShiftBodySchema, fallbackGroupSchema } from '../schemas/shifts'
import { audit } from '../services/audit'

const shifts = new Hono<AppEnv>()

// All authenticated users can check their shift status
shifts.get('/my-status', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  return dos.shifts.fetch(new Request(`http://do/my-status?pubkey=${pubkey}`))
})

// --- Permission-gated routes ---

shifts.get('/fallback', requirePermission('shifts:manage-fallback'), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  return dos.settings.fetch(new Request('http://do/fallback'))
})

shifts.put('/fallback', requirePermission('shifts:manage-fallback'), validateBody(fallbackGroupSchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = c.get('validatedBody') as z.infer<typeof fallbackGroupSchema>
  return dos.settings.fetch(new Request('http://do/fallback', {
    method: 'PUT',
    body: JSON.stringify(body),
  }))
})

shifts.get('/', requirePermission('shifts:read'), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  return dos.shifts.fetch(new Request('http://do/shifts'))
})

shifts.post('/', requirePermission('shifts:create'), validateBody(createShiftBodySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const body = c.get('validatedBody') as z.infer<typeof createShiftBodySchema>
  const res = await dos.shifts.fetch(new Request('http://do/shifts', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.records, 'shiftCreated', pubkey)
  return res
})

shifts.patch('/:id', requirePermission('shifts:update'), validateBody(updateShiftBodySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  const body = c.get('validatedBody') as z.infer<typeof updateShiftBodySchema>
  const res = await dos.shifts.fetch(new Request(`http://do/shifts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) await audit(dos.records, 'shiftEdited', pubkey, { shiftId: id })
  return res
})

shifts.delete('/:id', requirePermission('shifts:delete'), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  const res = await dos.shifts.fetch(new Request(`http://do/shifts/${id}`, { method: 'DELETE' }))
  if (res.ok) await audit(dos.records, 'shiftDeleted', pubkey, { shiftId: id })
  return res
})

export default shifts
