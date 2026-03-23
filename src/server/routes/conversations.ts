import { Hono } from 'hono'
import { KIND_CONVERSATION_ASSIGNED, KIND_MESSAGE_NEW } from '../../shared/nostr-events'
import { canClaimChannel, getClaimableChannels } from '../../shared/permissions'
import type { MessagingChannelType } from '../../shared/types'
import { getMessagingAdapter, getNostrPublisher } from '../lib/adapters'
import { checkPermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const conversations = new Hono<AppEnv>()

/** Publish a conversation event to the Nostr relay */
function publishConversationEvent(
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
      .catch(() => {})
  } catch {
    // Nostr not configured
  }
}

/**
 * GET /conversations — list conversations
 * Users with conversations:read-all see everything.
 * Others see only their assigned + waiting conversations (filtered by claimable channels).
 */
conversations.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const volunteer = c.get('volunteer')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')
  const status = c.req.query('status')
  const channel = c.req.query('channel')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  // Users without read-all only see their assigned conversations + waiting queue
  if (!canReadAll) {
    const [assignedResult, waitingResult] = await Promise.all([
      services.conversations.listConversations({
        hubId: hubId ?? 'global',
        ...(status ? { status } : {}),
        ...(channel ? { channelType: channel } : {}),
        assignedTo: pubkey,
        page,
        limit,
      }),
      services.conversations.listConversations({
        hubId: hubId ?? 'global',
        status: 'waiting',
        ...(channel ? { channelType: channel } : {}),
        page: 1,
        limit: 200, // fetch a larger set to filter from
      }),
    ])

    // Filter waiting conversations by channels the volunteer can claim
    const claimableChannels = getClaimableChannels(permissions)
    const volunteerChannels = volunteer.supportedMessagingChannels

    let filteredWaiting = waitingResult.conversations
    // Filter by permission-based claimable channels
    if (claimableChannels.length > 0) {
      filteredWaiting = filteredWaiting.filter((conv) =>
        claimableChannels.includes(conv.channelType)
      )
    }
    // Also filter by volunteer's configured supported channels (if set)
    if (volunteerChannels && volunteerChannels.length > 0) {
      filteredWaiting = filteredWaiting.filter((conv) =>
        volunteerChannels.includes(conv.channelType as MessagingChannelType)
      )
    }
    // Hide all waiting if messaging is disabled for this volunteer
    if (volunteer.messagingEnabled === false) {
      filteredWaiting = []
    }

    return c.json({
      conversations: [...assignedResult.conversations, ...filteredWaiting],
      assignedCount: assignedResult.total,
      waitingCount: filteredWaiting.length,
      claimableChannels,
    })
  }

  const result = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    ...(status ? { status } : {}),
    ...(channel ? { channelType: channel } : {}),
    page,
    limit,
  })
  return c.json(result)
})

/**
 * GET /conversations/stats — conversation metrics
 */
conversations.get('/stats', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const stats = await services.conversations.getConversationStats(hubId ?? 'global')
  return c.json(stats)
})

/**
 * GET /conversations/load — get volunteer load counts (active conversations per volunteer)
 * Admin only — used for reassignment UI
 */
conversations.get('/load', async (c) => {
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')
  if (!canReadAll) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const services = c.get('services')
  const hubId = c.get('hubId')

  // Get all active conversations grouped by assignedTo
  const { conversations: activeConvs } = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    status: 'active',
    limit: 1000,
  })

  const loads: Record<string, number> = {}
  for (const conv of activeConvs) {
    if (conv.assignedTo) {
      loads[conv.assignedTo] = (loads[conv.assignedTo] ?? 0) + 1
    }
  }

  return c.json({ loads })
})

/**
 * GET /conversations/:id — get single conversation
 */
conversations.get('/:id', async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')

  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)

  // Non-admins can only view their assigned or waiting conversations
  if (!canReadAll && conv.assignedTo !== pubkey && conv.status !== 'waiting') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(conv)
})

/**
 * GET /conversations/:id/messages — paginated messages
 */
conversations.get('/:id/messages', async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  // Verify access
  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)
  if (!canReadAll && conv.assignedTo !== pubkey && conv.status !== 'waiting') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const result = await services.conversations.getMessages(id, page, limit)
  return c.json(result)
})

/**
 * POST /conversations/:id/messages — send outbound message
 * Body: { encryptedContent, readerEnvelopes, plaintextForSending? }
 * If plaintext is provided, it's sent via the messaging adapter then discarded.
 */
conversations.post('/:id/messages', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canSendAny = checkPermission(permissions, 'conversations:send-any')

  // Verify access
  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)
  if (!canSendAny && conv.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = (await c.req.json()) as {
    encryptedContent: string
    readerEnvelopes: import('../types').MessageKeyEnvelope[]
    plaintextForSending?: string
  }

  // Determine message status and external ID by sending via adapter first
  let messageStatus = 'pending'
  let messageExternalId: string | undefined
  let messageFailureReason: string | undefined

  if (body.plaintextForSending && conv.channelType !== 'web') {
    try {
      const adapter = await getMessagingAdapter(
        conv.channelType as 'sms' | 'whatsapp' | 'signal',
        services.settings,
        c.env.HMAC_SECRET,
        hubId ?? undefined
      )
      // Use the conversation's externalId as the recipient identifier
      const identifier = conv.externalId
      if (!identifier) throw new Error('Contact identifier not available for outbound')
      const result = await adapter.sendMessage({
        recipientIdentifier: identifier,
        body: body.plaintextForSending,
        conversationId: id,
      })

      if (result.success && result.externalId) {
        messageExternalId = result.externalId
        messageStatus = 'sent'
      } else if (!result.success) {
        messageStatus = 'failed'
        messageFailureReason = result.error
      }
    } catch (err) {
      console.error(`[conversations] Failed to send outbound message via ${conv.channelType}:`, err)
      messageStatus = 'failed'
      messageFailureReason = err instanceof Error ? err.message : 'Unknown error'
    }
  } else if (conv.channelType === 'web') {
    // Web channel doesn't need external sending
    messageStatus = 'delivered'
  }

  // Store the message (with external ID and status)
  const stored = await services.conversations.addMessage({
    conversationId: id,
    direction: 'outbound',
    authorPubkey: pubkey,
    encryptedContent: body.encryptedContent,
    readerEnvelopes: body.readerEnvelopes,
    hasAttachments: false,
    externalId: messageExternalId,
    status: messageStatus,
  })

  // Publish new message event to Nostr relay
  publishConversationEvent(c.env, KIND_MESSAGE_NEW, {
    type: 'message:new',
    conversationId: id,
    channelType: 'outbound',
  }, hubId ?? undefined)

  c.executionCtx.waitUntil(
    services.records.addAuditEntry(hubId ?? 'global', 'messageSent', pubkey, {
      conversationId: id,
      channel: conv.channelType,
      ...(messageFailureReason ? { failureReason: messageFailureReason } : {}),
    })
  )

  return c.json(stored)
})

/**
 * PATCH /conversations/:id — update conversation (assign, close, reopen)
 */
conversations.patch('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canUpdate = checkPermission(permissions, 'conversations:update')
  const body = (await c.req.json()) as { status?: string; assignedTo?: string }

  // Only users with update permission or assigned volunteer can update
  const existing = await services.conversations.getConversation(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!canUpdate && existing.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const updated = await services.conversations.updateConversation(id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
  })

  // Publish status change to Nostr relay
  const convEventType = body.status === 'closed' ? 'conversation:closed' : 'conversation:assigned'
  publishConversationEvent(c.env, KIND_CONVERSATION_ASSIGNED, {
    type: convEventType,
    conversationId: id,
    assignedTo: body.assignedTo,
  }, hubId ?? undefined)

  c.executionCtx.waitUntil(
    services.records.addAuditEntry(
      hubId ?? 'global',
      body.status === 'closed' ? 'conversationClosed' : 'conversationUpdated',
      pubkey,
      { conversationId: id }
    )
  )

  return c.json(updated)
})

/**
 * POST /conversations/:id/claim — volunteer claims a waiting conversation
 * Channel-specific permission check: volunteer must have claim permission for the conversation's channel
 */
conversations.post('/:id/claim', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const volunteer = c.get('volunteer')

  // Fetch conversation to check channel type
  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)

  // Check channel-specific claim permission
  if (!canClaimChannel(permissions, conv.channelType)) {
    return c.json(
      {
        error: 'No permission to claim this channel type',
        channelType: conv.channelType,
        allowedChannels: getClaimableChannels(permissions),
      },
      403
    )
  }

  // Check volunteer's supported messaging channels (if defined)
  if (volunteer.supportedMessagingChannels && volunteer.supportedMessagingChannels.length > 0) {
    if (!volunteer.supportedMessagingChannels.includes(conv.channelType as MessagingChannelType)) {
      return c.json(
        {
          error: 'Volunteer not configured for this channel',
          channelType: conv.channelType,
          supportedChannels: volunteer.supportedMessagingChannels,
        },
        403
      )
    }
  }

  // Check if volunteer has messaging enabled (defaults to true for backwards compatibility)
  if (volunteer.messagingEnabled === false) {
    return c.json({ error: 'Messaging not enabled for this volunteer' }, 403)
  }

  // Only waiting conversations can be claimed
  if (conv.status !== 'waiting') {
    return c.json({ error: 'Conversation is not waiting to be claimed' }, 400)
  }

  const claimed = await services.conversations.updateConversation(id, {
    assignedTo: pubkey,
    status: 'active',
  })

  // Publish assignment to Nostr relay
  publishConversationEvent(c.env, KIND_CONVERSATION_ASSIGNED, {
    type: 'conversation:assigned',
    conversationId: id,
    assignedTo: pubkey,
  }, hubId ?? undefined)

  c.executionCtx.waitUntil(
    services.records.addAuditEntry(hubId ?? 'global', 'conversationClaimed', pubkey, {
      conversationId: id,
      channelType: conv.channelType,
    })
  )

  return c.json(claimed)
})

export default conversations
