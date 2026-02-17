import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { audit } from '../services/audit'

const reports = new Hono<AppEnv>()

// List reports — reporters see only their own, admins see all
reports.get('/', async (c) => {
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  const status = c.req.query('status') || ''
  const category = c.req.query('category') || ''
  const page = parseInt(c.req.query('page') || '1', 10)
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100)

  const qs = new URLSearchParams({
    type: 'report',
    page: String(page),
    limit: String(limit),
  })
  if (status) qs.set('status', status)
  if (category) qs.set('category', category)

  // Reporters can only see their own reports
  if (role === 'reporter') {
    qs.set('authorPubkey', pubkey)
  }

  const res = await dos.conversations.fetch(new Request(`http://do/conversations?${qs}`))
  if (!res.ok) {
    return c.json({ error: 'Failed to fetch reports' }, 500)
  }

  const data = await res.json()
  return c.json(data)
})

// Create a new report (reporter or admin)
reports.post('/', async (c) => {
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  if (role !== 'reporter' && role !== 'admin') {
    return c.json({ error: 'Only reporters and admins can create reports' }, 403)
  }

  const body = await c.req.json() as {
    title: string
    category?: string
    // First message content (encrypted)
    encryptedContent: string
    ephemeralPubkey: string
    encryptedContentAdmin: string
    ephemeralPubkeyAdmin: string
  }

  if (!body.encryptedContent || !body.ephemeralPubkey) {
    return c.json({ error: 'Report content is required' }, 400)
  }

  // Create the conversation with report metadata
  const conversationData = {
    channelType: 'web',
    contactIdentifierHash: pubkey,  // Reporter is the "contact"
    status: 'waiting',
    metadata: {
      type: 'report',
      reportTitle: body.title,
      reportCategory: body.category,
    },
  }

  const convRes = await dos.conversations.fetch(new Request('http://do/conversations', {
    method: 'POST',
    body: JSON.stringify(conversationData),
  }))

  if (!convRes.ok) {
    return c.json({ error: 'Failed to create report' }, 500)
  }

  const conversation = await convRes.json() as { id: string }

  // Add the initial message
  const msgRes = await dos.conversations.fetch(new Request(`http://do/conversations/${conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      direction: 'inbound',
      authorPubkey: pubkey,
      encryptedContent: body.encryptedContent,
      ephemeralPubkey: body.ephemeralPubkey,
      encryptedContentAdmin: body.encryptedContentAdmin,
      ephemeralPubkeyAdmin: body.ephemeralPubkeyAdmin,
    }),
  }))

  if (!msgRes.ok) {
    return c.json({ error: 'Failed to add report message' }, 500)
  }

  // Broadcast to admins
  try {
    await dos.calls.fetch(new Request('http://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'report:new',
        data: { conversationId: conversation.id, category: body.category },
      }),
    }))
  } catch { /* non-critical */ }

  await audit(dos.records, 'reportCreated', pubkey, {
    conversationId: conversation.id,
    category: body.category,
  })

  return c.json({ id: conversation.id, ...conversationData })
})

// Get a single report
reports.get('/:id', async (c) => {
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  const res = await dos.conversations.fetch(new Request(`http://do/conversations/${id}`))
  if (!res.ok) {
    return c.json({ error: 'Report not found' }, 404)
  }

  const report = await res.json() as { contactIdentifierHash: string; assignedTo?: string; metadata?: { type?: string } }

  // Verify it's actually a report
  if (report.metadata?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  // Reporters can only see their own reports
  if (role === 'reporter' && report.contactIdentifierHash !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Volunteers can only see reports assigned to them
  if (role === 'volunteer' && report.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(report)
})

// Get report messages
reports.get('/:id/messages', async (c) => {
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  // Verify access
  const convRes = await dos.conversations.fetch(new Request(`http://do/conversations/${id}`))
  if (!convRes.ok) {
    return c.json({ error: 'Report not found' }, 404)
  }

  const report = await convRes.json() as { contactIdentifierHash: string; assignedTo?: string; metadata?: { type?: string } }

  if (report.metadata?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  if (role === 'reporter' && report.contactIdentifierHash !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (role === 'volunteer' && report.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 200)
  const page = parseInt(c.req.query('page') || '1', 10)

  const msgRes = await dos.conversations.fetch(new Request(`http://do/conversations/${id}/messages?limit=${limit}&page=${page}`))
  return new Response(msgRes.body, msgRes)
})

// Send a message in a report thread
reports.post('/:id/messages', async (c) => {
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  // Verify access
  const convRes = await dos.conversations.fetch(new Request(`http://do/conversations/${id}`))
  if (!convRes.ok) {
    return c.json({ error: 'Report not found' }, 404)
  }

  const report = await convRes.json() as { contactIdentifierHash: string; assignedTo?: string; metadata?: { type?: string } }

  if (report.metadata?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  // Reporters can reply to their own reports, admins/assigned volunteers can reply
  if (role === 'reporter' && report.contactIdentifierHash !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  if (role === 'volunteer' && report.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json() as {
    encryptedContent: string
    ephemeralPubkey: string
    encryptedContentAdmin: string
    ephemeralPubkeyAdmin: string
    attachmentIds?: string[]
  }

  const direction = role === 'reporter' ? 'inbound' : 'outbound'

  const msgRes = await dos.conversations.fetch(new Request(`http://do/conversations/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      direction,
      authorPubkey: pubkey,
      encryptedContent: body.encryptedContent,
      ephemeralPubkey: body.ephemeralPubkey,
      encryptedContentAdmin: body.encryptedContentAdmin,
      ephemeralPubkeyAdmin: body.ephemeralPubkeyAdmin,
      hasAttachments: (body.attachmentIds?.length ?? 0) > 0,
      attachmentIds: body.attachmentIds,
    }),
  }))

  if (!msgRes.ok) {
    return c.json({ error: 'Failed to send message' }, 500)
  }

  const msg = await msgRes.json()

  // Broadcast
  try {
    await dos.calls.fetch(new Request('http://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({ type: 'message:new', data: { conversationId: id } }),
    }))
  } catch { /* non-critical */ }

  return c.json(msg)
})

// Assign a volunteer to a report (admin only)
reports.post('/:id/assign', async (c) => {
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const role = c.get('role')

  if (role !== 'admin') {
    return c.json({ error: 'Only admins can assign reports' }, 403)
  }

  const body = await c.req.json() as { assignedTo: string }
  const dos = getDOs(c.env)

  const res = await dos.conversations.fetch(new Request(`http://do/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ assignedTo: body.assignedTo, status: 'active' }),
  }))

  if (!res.ok) {
    return c.json({ error: 'Failed to assign report' }, 500)
  }

  await audit(dos.records, 'reportAssigned', pubkey, { reportId: id, assignedTo: body.assignedTo })

  // Broadcast
  try {
    await dos.calls.fetch(new Request('http://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'conversation:assigned',
        data: { conversationId: id, assignedTo: body.assignedTo },
      }),
    }))
  } catch { /* non-critical */ }

  return new Response(res.body, res)
})

// Update report status (admin or assigned volunteer)
reports.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  if (role === 'reporter') {
    return c.json({ error: 'Reporters cannot update report status' }, 403)
  }

  const body = await c.req.json() as { status?: string }

  const res = await dos.conversations.fetch(new Request(`http://do/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))

  if (!res.ok) {
    return c.json({ error: 'Failed to update report' }, 500)
  }

  await audit(dos.records, 'reportUpdated', pubkey, { reportId: id, ...body })
  return new Response(res.body, res)
})

// Get report categories (from settings)
reports.get('/categories', async (c) => {
  const dos = getDOs(c.env)
  const res = await dos.settings.fetch(new Request('http://do/settings/report-categories'))
  if (!res.ok) {
    return c.json({ categories: [] })
  }
  return new Response(res.body, res)
})

// Get files attached to a report
reports.get('/:id/files', async (c) => {
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const role = c.get('role')
  const dos = getDOs(c.env)

  // Verify access
  const convRes = await dos.conversations.fetch(new Request(`http://do/conversations/${id}`))
  if (!convRes.ok) {
    return c.json({ error: 'Report not found' }, 404)
  }

  const report = await convRes.json() as { contactIdentifierHash: string; assignedTo?: string; metadata?: { type?: string } }

  if (report.metadata?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  if (role === 'reporter' && report.contactIdentifierHash !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  if (role === 'volunteer' && report.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const filesRes = await dos.conversations.fetch(new Request(`http://do/files?conversationId=${id}`))
  if (!filesRes.ok) {
    return c.json({ files: [] })
  }

  return new Response(filesRes.body, filesRes)
})

export default reports
