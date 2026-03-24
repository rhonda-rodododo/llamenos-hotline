import type { KeyEnvelope, RecipientEnvelope } from '@shared/types'
import { Hono } from 'hono'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const notes = new Hono<AppEnv>()
// Require at least notes:read-own to access any notes endpoint
notes.use('*', requirePermission('notes:read-own'))

notes.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'notes:read-all')
  const callId = c.req.query('callId')
  const conversationId = c.req.query('conversationId')
  const contactHash = c.req.query('contactHash')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  const result = await services.records.getNotes({
    ...(callId ? { callId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(contactHash ? { contactHash } : {}),
    ...(!canReadAll ? { authorPubkey: pubkey } : {}),
    page,
    limit,
    hubId: hubId ?? 'global',
  })
  return c.json(result)
})

notes.post('/', requirePermission('notes:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as {
    callId?: string
    conversationId?: string
    contactHash?: string
    encryptedContent: string
    authorEnvelope?: KeyEnvelope
    adminEnvelopes?: RecipientEnvelope[]
  }
  if (!body.callId && !body.conversationId) {
    return c.json({ error: 'callId or conversationId required' }, 400)
  }
  const note = await services.records.createNote({
    ...body,
    authorPubkey: pubkey,
    hubId: hubId ?? 'global',
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'noteCreated', pubkey, {
    noteId: note.id,
    callId: body.callId,
    conversationId: body.conversationId,
  })
  return c.json({ note }, 201)
})

// --- Note Permalink (GET /notes/:noteId) ---

notes.get('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const id = c.req.param('id')

  const canReadAll = checkPermission(permissions, 'notes:read-all')
  const note = await services.records.getNote(id)
  if (!note) return c.json({ error: 'Note not found' }, 404)

  // Volunteers can only view their own notes
  if (!canReadAll && note.authorPubkey !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json({ note })
})

notes.patch('/:id', requirePermission('notes:update-own'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  const body = (await c.req.json()) as {
    encryptedContent: string
    authorEnvelope?: KeyEnvelope
    adminEnvelopes?: RecipientEnvelope[]
  }
  const updated = await services.records.updateNote(id, { ...body, authorPubkey: pubkey })
  await services.records.addAuditEntry(hubId ?? 'global', 'noteEdited', pubkey, { noteId: id })
  return c.json({ note: updated })
})

// --- Note Replies (Epic 123) ---

notes.get('/:id/replies', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  // Replies are notes linked to the parent note via callId or conversationId
  // Fetch the parent note first to get its context
  const parent = await services.records.getNote(id)
  if (!parent) return c.json({ notes: [] })
  const result = await services.records.getNotes({
    ...(parent.callId ? { callId: parent.callId } : {}),
    ...(parent.conversationId ? { conversationId: parent.conversationId } : {}),
    hubId: hubId ?? 'global',
  })
  // Filter to only replies (notes after the parent that have the same context)
  const replies = result.notes.filter((n) => n.id !== id)
  return c.json({ notes: replies })
})

notes.post('/:id/replies', requirePermission('notes:reply'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const id = c.req.param('id')
  const body = (await c.req.json()) as {
    encryptedContent: string
    readerEnvelopes: RecipientEnvelope[]
    authorEnvelope?: KeyEnvelope
  }
  // Get parent note for context
  const parent = await services.records.getNote(id)
  if (!parent) return c.json({ error: 'Parent note not found' }, 404)
  const reply = await services.records.createNote({
    encryptedContent: body.encryptedContent,
    authorEnvelope: body.authorEnvelope,
    adminEnvelopes: body.readerEnvelopes,
    authorPubkey: pubkey,
    callId: parent.callId,
    conversationId: parent.conversationId,
    contactHash: parent.contactHash,
    hubId: hubId ?? 'global',
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'noteReplyCreated', pubkey, {
    noteId: id,
  })
  return c.json(reply, 201)
})

export default notes
