import { Hono } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { requirePermission } from '../middleware/permission-guard'
import { validateBody } from '../middleware/validate'
import { createVolunteerBodySchema, adminUpdateVolunteerBodySchema } from '../schemas/volunteers'
import { audit } from '../services/audit'

const volunteers = new Hono<AppEnv>()
volunteers.use('*', requirePermission('volunteers:read'))

volunteers.get('/', async (c) => {
  const dos = getDOs(c.env)
  return dos.identity.fetch(new Request('http://do/volunteers'))
})

volunteers.post('/', requirePermission('volunteers:create'), validateBody(createVolunteerBodySchema), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = c.get('validatedBody') as z.infer<typeof createVolunteerBodySchema>

  const res = await dos.identity.fetch(new Request('http://do/volunteers', {
    method: 'POST',
    body: JSON.stringify({
      pubkey: body.pubkey,
      name: body.name,
      phone: body.phone,
      roles: body.roleIds || body.roles || ['role-volunteer'],
      encryptedSecretKey: body.encryptedSecretKey || '',
    }),
  }))

  if (res.ok) {
    await audit(dos.records, 'volunteerAdded', pubkey, { target: body.pubkey, roles: body.roleIds || body.roles })
  }

  return res
})

volunteers.patch('/:targetPubkey', requirePermission('volunteers:update'), validateBody(adminUpdateVolunteerBodySchema), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const targetPubkey = c.req.param('targetPubkey')
  const body = c.get('validatedBody') as z.infer<typeof adminUpdateVolunteerBodySchema>

  const res = await dos.identity.fetch(new Request(`http://do/admin/volunteers/${targetPubkey}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
  if (res.ok) {
    if (body.roles) await audit(dos.records, 'rolesChanged', pubkey, { target: targetPubkey, roles: body.roles })
    // Revoke all sessions when deactivating or changing roles
    if (body.active === false || body.roles) {
      await dos.identity.fetch(new Request(`http://do/sessions/revoke-all/${targetPubkey}`, { method: 'DELETE' }))
    }
  }
  return res
})

volunteers.delete('/:targetPubkey', requirePermission('volunteers:delete'), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const targetPubkey = c.req.param('targetPubkey')
  // Revoke all sessions before deletion
  await dos.identity.fetch(new Request(`http://do/sessions/revoke-all/${targetPubkey}`, { method: 'DELETE' }))
  const res = await dos.identity.fetch(new Request(`http://do/volunteers/${targetPubkey}`, { method: 'DELETE' }))
  if (res.ok) await audit(dos.records, 'volunteerRemoved', pubkey, { target: targetPubkey })
  return res
})

export default volunteers
