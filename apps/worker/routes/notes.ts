import { Hono } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../types'
import { getScopedDOs } from '../lib/do-access'
import { requirePermission, checkPermission } from '../middleware/permission-guard'
import { validateBody, validateQuery } from '../middleware/validate'
import { listNotesQuerySchema, createNoteBodySchema, updateNoteBodySchema, createReplyBodySchema } from '../schemas/notes'
import { audit } from '../services/audit'

const notes = new Hono<AppEnv>()
// Require at least notes:read-own to access any notes endpoint
notes.use('*', requirePermission('notes:read-own'))

notes.get('/', validateQuery(listNotesQuerySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'notes:read-all')
  const query = c.get('validatedQuery') as z.infer<typeof listNotesQuerySchema>

  const params = new URLSearchParams()
  if (query.callId) params.set('callId', query.callId)
  if (query.conversationId) params.set('conversationId', query.conversationId)
  if (query.contactHash) params.set('contactHash', query.contactHash)
  if (!canReadAll) params.set('author', pubkey)
  params.set('page', String(query.page))
  params.set('limit', String(query.limit))
  return dos.records.fetch(new Request(`http://do/notes?${params}`))
})

notes.post('/', requirePermission('notes:create'), validateBody(createNoteBodySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const body = c.get('validatedBody') as z.infer<typeof createNoteBodySchema>

  const res = await dos.records.fetch(new Request('http://do/notes', {
    method: 'POST',
    body: JSON.stringify({ ...body, authorPubkey: pubkey }),
  }))
  if (res.ok) await audit(dos.records, 'noteCreated', pubkey, { callId: body.callId, conversationId: body.conversationId })
  return res
})

notes.patch('/:id', requirePermission('notes:update-own'), validateBody(updateNoteBodySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  const body = c.get('validatedBody') as z.infer<typeof updateNoteBodySchema>

  const res = await dos.records.fetch(new Request(`http://do/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...body, authorPubkey: pubkey }),
  }))
  if (res.ok) await audit(dos.records, 'noteEdited', pubkey, { noteId: id })
  return res
})

// --- Note Replies (Epic 123) ---

notes.get('/:id/replies', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const id = c.req.param('id')
  return dos.records.fetch(new Request(`http://do/notes/${id}/replies`))
})

notes.post('/:id/replies', requirePermission('notes:reply'), validateBody(createReplyBodySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  const body = c.get('validatedBody') as z.infer<typeof createReplyBodySchema>

  const res = await dos.records.fetch(new Request(`http://do/notes/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ ...body, authorPubkey: pubkey }),
  }))
  if (res.ok) await audit(dos.records, 'noteReplyCreated', pubkey, { noteId: id })
  return res
})

export default notes
