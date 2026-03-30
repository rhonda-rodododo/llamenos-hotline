import { Hono } from 'hono'
import { KIND_CONVERSATION_ASSIGNED, KIND_MESSAGE_NEW } from '../../shared/nostr-events'
import { getNostrPublisher } from '../lib/adapters'
import { isReportOwner } from '../lib/report-access'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

/** Publish a report/conversation event to the Nostr relay */
function publishReportEvent(
  env: AppEnv['Bindings'],
  kind: number,
  content: Record<string, unknown>,
  hubId?: string
) {
  try {
    const publisher = getNostrPublisher(env)
    publisher
      .publish({
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', hubId ?? 'global'],
          ['t', 'llamenos:event'],
        ],
        content: JSON.stringify(content),
      })
      .catch((err) => console.error('[nostr] report event publish failed:', err))
  } catch {
    // Nostr not configured
  }
}

const reports = new Hono<AppEnv>()

// List reports — reporters see only their own, users with reports:read-all see everything
reports.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const status = c.req.query('status') || ''
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10), 100)

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  // Build filters: reports are conversations with channelType='web' and metadata.type='report'
  const result = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    channelType: 'web',
    ...(status ? { status } : {}),
    page,
    limit,
  })

  // Filter to only report-type conversations
  let filteredConvs = result.conversations.filter(
    (c) => (c.metadata as Record<string, unknown>)?.type === 'report'
  )

  // Access filter: restrict to own reports unless has read-all/read-assigned
  if (!canReadAll) {
    filteredConvs = filteredConvs.filter((conv) => {
      if (canReadAssigned && conv.assignedTo === pubkey) return true
      if (isReportOwner(conv, pubkey)) return true
      return false
    })
  }

  return c.json({ conversations: filteredConvs, total: filteredConvs.length })
})

// Create a new report (requires reports:create)
reports.post('/', requirePermission('reports:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')

  const body = (await c.req.json()) as {
    title: string
    category?: string
    reportTypeId?: string
    // First message content (envelope-encrypted)
    encryptedContent: string
    readerEnvelopes: import('../types').MessageKeyEnvelope[]
  }

  if (!body.encryptedContent || !body.readerEnvelopes?.length) {
    return c.json({ error: 'Report content is required' }, 400)
  }

  // Validate reportTypeId belongs to this hub if provided
  if (body.reportTypeId) {
    const reportType = await services.reportTypes.getReportType(
      hubId ?? 'global',
      body.reportTypeId
    )
    if (!reportType || reportType.archivedAt) {
      return c.json({ error: 'Invalid or archived report type' }, 400)
    }
  }

  // Create the conversation with report metadata.
  // Each report is a separate conversation, so use skipDedup to avoid the
  // (hubId, channelType, contactIdentifierHash) unique constraint that normally
  // deduplicates messaging threads per contact.
  const conversation = await services.conversations.createConversation({
    hubId: hubId ?? 'global',
    channelType: 'web',
    contactIdentifierHash: pubkey, // Reporter is the "contact"
    skipDedup: true,
    status: 'waiting',
    metadata: {
      type: 'report',
      reportTitle: body.title,
      reportCategory: body.category,
    },
    reportTypeId: body.reportTypeId,
  })

  // Add the initial message
  const msg = await services.conversations.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    authorPubkey: pubkey,
    encryptedContent: body.encryptedContent,
    readerEnvelopes: body.readerEnvelopes,
    hasAttachments: false,
    status: 'delivered',
  })

  // Publish report event to Nostr relay
  publishReportEvent(
    c.env,
    KIND_MESSAGE_NEW,
    {
      type: 'report:new',
      conversationId: conversation.id,
      category: body.category,
    },
    hubId ?? undefined
  )

  await services.records.addAuditEntry(hubId ?? 'global', 'reportCreated', pubkey, {
    conversationId: conversation.id,
    category: body.category,
  })

  return c.json({ ...conversation, firstMessage: msg }, 201)
})

// Get report categories (from settings) — must be before /:id to avoid being caught by the param route
reports.get('/categories', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const result = await services.settings.getReportCategories(hubId ?? undefined)
  return c.json(result)
})

// Get a single report
reports.get('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  // Verify it's actually a report and belongs to this hub
  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }
  if (report.hubId !== (hubId ?? 'global')) {
    return c.json({ error: 'Report not found' }, 404)
  }

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  // Users with read-all can see everything
  if (!canReadAll) {
    // Users with read-assigned can see assigned reports
    if (canReadAssigned && report.assignedTo === pubkey) {
      // OK
    } else if (isReportOwner(report, pubkey)) {
      // Own report
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  return c.json(report)
})

// Get report messages
reports.get('/:id/messages', async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  // Verify access
  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  if (!canReadAll) {
    if (canReadAssigned && report.assignedTo === pubkey) {
      // OK
    } else if (isReportOwner(report, pubkey)) {
      // Own report
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '100', 10), 200)
  const page = Number.parseInt(c.req.query('page') || '1', 10)

  const result = await services.conversations.getMessages(id, page, limit)
  return c.json(result)
})

// Send a message in a report thread
reports.post('/:id/messages', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  // Verify access
  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  const canSendAny = checkPermission(permissions, 'reports:send-message')
  const canSendOwn = checkPermission(permissions, 'reports:send-message-own')

  // Check if user can send messages in this report
  if (!canSendAny) {
    if (canSendOwn && isReportOwner(report, pubkey)) {
      // Reporter can reply to own report
    } else if (report.assignedTo === pubkey) {
      // Assigned user can reply
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  const body = (await c.req.json()) as {
    encryptedContent: string
    readerEnvelopes: import('../types').MessageKeyEnvelope[]
    attachmentIds?: string[]
  }

  const isReporter = isReportOwner(report, pubkey)
  const direction = isReporter ? 'inbound' : 'outbound'

  const msg = await services.conversations.addMessage({
    conversationId: id,
    direction,
    authorPubkey: pubkey,
    encryptedContent: body.encryptedContent,
    readerEnvelopes: body.readerEnvelopes,
    hasAttachments: (body.attachmentIds?.length ?? 0) > 0,
    attachmentIds: body.attachmentIds,
    status: 'delivered',
  })

  // Publish message event to Nostr relay
  publishReportEvent(
    c.env,
    KIND_MESSAGE_NEW,
    {
      type: 'message:new',
      conversationId: id,
    },
    hubId ?? undefined
  )

  return c.json(msg)
})

// Assign a user to a report (requires reports:assign)
reports.post('/:id/assign', requirePermission('reports:assign'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')

  const body = (await c.req.json()) as { assignedTo: string }

  const updated = await services.conversations.updateConversation(id, {
    assignedTo: body.assignedTo,
    status: 'active',
  })

  await services.records.addAuditEntry(hubId ?? 'global', 'reportAssigned', pubkey, {
    reportId: id,
    assignedTo: body.assignedTo,
  })

  // Publish assignment event to Nostr relay
  publishReportEvent(
    c.env,
    KIND_CONVERSATION_ASSIGNED,
    {
      type: 'conversation:assigned',
      conversationId: id,
      assignedTo: body.assignedTo,
    },
    hubId ?? undefined
  )

  return c.json(updated)
})

// Update report status (requires reports:update)
reports.patch('/:id', requirePermission('reports:update'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')

  const body = (await c.req.json()) as { status?: string }

  const updated = await services.conversations.updateConversation(id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
  })

  await services.records.addAuditEntry(hubId ?? 'global', 'reportUpdated', pubkey, {
    reportId: id,
    ...body,
  })
  return c.json(updated)
})

// Get files attached to a report
reports.get('/:id/files', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  // Verify access
  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  if (!canReadAll) {
    if (canReadAssigned && report.assignedTo === pubkey) {
      // OK
    } else if (isReportOwner(report, pubkey)) {
      // Own
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  void hubId // hubId available but file listing not yet implemented in service layer
  // Files are stored as attachments on messages — list messages with hasAttachments=true
  const { messages } = await services.conversations.getMessages(id, 1, 200)
  const filesFromMessages = messages
    .filter((m) => m.hasAttachments && m.attachmentIds?.length)
    .flatMap((m) =>
      (m.attachmentIds ?? []).map((fileId) => ({
        id: fileId,
        messageId: m.id,
        conversationId: id,
      }))
    )

  return c.json({ files: filesFromMessages })
})

export default reports
