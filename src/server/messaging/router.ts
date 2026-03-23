import { Hono } from 'hono'
import { KIND_CONVERSATION_ASSIGNED, KIND_MESSAGE_NEW } from '../../shared/nostr-events'
import type { MessagingChannelType, MessagingConfig, WhatsAppConfig } from '../../shared/types'
import { getMessagingAdapter, getNostrPublisher } from '../lib/adapters'
import { encryptMessageForStorage } from '../lib/crypto'
import type { Services } from '../services'
import type { AppEnv } from '../types'
import type { IncomingMessage, MessageStatusUpdate, MessagingAdapter } from './adapter'

const messaging = new Hono<AppEnv>()

/**
 * WhatsApp webhook verification (GET).
 * Meta's Cloud API sends a GET request with hub.mode, hub.verify_token, hub.challenge
 * to verify webhook ownership during setup.
 */
messaging.get('/whatsapp/webhook', async (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return c.text('Bad request', 400)
  }

  // Read WhatsApp config to check verify token
  const services = c.get('services')
  try {
    const config = await services.settings.getMessagingConfig()
    const waConfig = config?.whatsapp as WhatsAppConfig | null
    if (waConfig?.verifyToken && token === waConfig.verifyToken) {
      return c.text(challenge)
    }
  } catch {
    /* fall through */
  }

  return c.text('Forbidden', 403)
})

/**
 * RCS webhook verification (GET).
 * Google RBM sends a GET request to verify webhook ownership during setup.
 */
messaging.get('/rcs/webhook', async (c) => {
  // Google RBM webhook verification — just return 200
  return c.text('OK', 200)
})

/**
 * Messaging webhook handler.
 * Each channel has its own webhook URL:
 *   /api/messaging/sms/webhook?hub={hubId}
 *   /api/messaging/whatsapp/webhook?hub={hubId}
 *   /api/messaging/signal/webhook?hub={hubId}
 *
 * No auth middleware — each adapter validates its own webhook signature.
 */
messaging.post('/:channel/webhook', async (c) => {
  const channel = c.req.param('channel') as MessagingChannelType
  const validChannels: MessagingChannelType[] = ['sms', 'whatsapp', 'signal', 'rcs']
  if (!validChannels.includes(channel)) {
    return c.json({ error: 'Unknown channel' }, 404)
  }

  // Hub-scoped routing: read hubId from query param, fall back to global
  const url = new URL(c.req.url)
  const hubId = url.searchParams.get('hub') || undefined
  const services = c.get('services')

  let adapter: MessagingAdapter
  try {
    adapter = await getMessagingAdapter(channel, services.settings, c.env.HMAC_SECRET, hubId)
  } catch {
    return c.json({ error: `${channel} channel is not configured` }, 404)
  }

  // Dev bypass: skip signature validation for localhost simulation POSTs
  const isDev = c.env.ENVIRONMENT === 'development'
  const isLocal =
    isDev && (c.req.header('CF-Connecting-IP') === '127.0.0.1' || url.hostname === 'localhost')

  if (!isLocal) {
    const isValid = await adapter.validateWebhook(c.req.raw)
    if (!isValid) {
      console.error(`[messaging] Webhook signature FAILED for ${channel}`)
      return new Response('Forbidden', { status: 403 })
    }
  }

  // Try to parse as status update first (if adapter supports it)
  if (adapter.parseStatusWebhook) {
    try {
      const statusUpdate = await adapter.parseStatusWebhook(c.req.raw.clone() as Request)
      if (statusUpdate) {
        // This is a status update — find the message by externalId and update its status
        await handleStatusUpdate(services, hubId, statusUpdate, c.env)
        return c.json({ ok: true })
      }
    } catch {
      // Not a status update, continue to parse as message
    }
  }

  // Parse the incoming message
  let incoming: IncomingMessage
  try {
    incoming = await adapter.parseIncomingMessage(c.req.raw)
  } catch (err) {
    console.error(`[messaging] Failed to parse ${channel} webhook:`, err)
    return c.json({ error: 'Failed to parse message' }, 400)
  }

  // Keyword interception for blast subscribe/unsubscribe
  if (incoming.body) {
    const normalizedBody = incoming.body.trim().toUpperCase()
    const hId = hubId ?? 'global'
    // STOP is always recognized (TCPA compliance)
    if (normalizedBody === 'STOP') {
      // Find subscriber and deactivate them
      const existing = await services.blasts.findSubscriberByHash(
        incoming.senderIdentifierHash,
        hId
      )
      if (existing) {
        await services.blasts.updateSubscriber(existing.id, { status: 'unsubscribed' })
      }
      // Still forward to conversation for logging
    } else {
      // Check if it matches the subscribe keyword
      try {
        const config = await services.settings.getMessagingConfig(hId)
        const subscribeKeyword = (config as MessagingConfig & { subscribeKeyword?: string })
          .subscribeKeyword
        if (subscribeKeyword && normalizedBody === subscribeKeyword.toUpperCase()) {
          await services.blasts.createSubscriber({
            hubId: hId,
            identifierHash: incoming.senderIdentifierHash,
            channels: [{ type: incoming.channelType as 'sms' | 'whatsapp' | 'signal' | 'rcs', verified: false }],
            status: 'active',
          })
        }
      } catch {
        /* blast settings not configured — ignore */
      }
    }
  }

  // Find or create conversation for this inbound message
  const hId = hubId ?? 'global'
  let conversation = await services.conversations.findByExternalId(
    hId,
    incoming.channelType,
    incoming.senderIdentifier
  )

  const isNew = !conversation
  if (!conversation) {
    conversation = await services.conversations.createConversation({
      hubId: hId,
      channelType: incoming.channelType,
      contactIdentifierHash: incoming.senderIdentifierHash,
      externalId: incoming.senderIdentifier,
      status: 'waiting',
    })
  }

  // Encrypt the inbound message body before storage (server encrypts, plaintext is discarded)
  const adminDecryptionPubkey = c.env.ADMIN_DECRYPTION_PUBKEY || c.env.ADMIN_PUBKEY
  const readerPubkeys = [adminDecryptionPubkey]
  if (conversation.assignedTo && conversation.assignedTo !== adminDecryptionPubkey) {
    readerPubkeys.push(conversation.assignedTo)
  }
  const encrypted = encryptMessageForStorage(incoming.body || '', readerPubkeys)

  // Store the encrypted message
  await services.conversations.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    authorPubkey: 'system:inbound',
    encryptedContent: encrypted.encryptedContent,
    readerEnvelopes: encrypted.readerEnvelopes,
    hasAttachments: !!(incoming.mediaUrls && incoming.mediaUrls.length > 0),
    externalId: incoming.externalId,
    status: 'delivered',
  })

  // Auto-assignment for new conversations
  if (isNew && conversation.status === 'waiting') {
    tryAutoAssign(services, c.env, conversation.id, channel, hId).catch((err) =>
      console.error('[background]', err)
    )
  }

  // Audit the incoming message (no PII — only hashed identifier)
  services.records
    .addAuditEntry(hId, 'messageReceived', 'system', {
      channel,
      senderHash: incoming.senderIdentifierHash,
    })
    .catch((err) => console.error('[background]', err))

  // Return 200 to acknowledge webhook (providers expect fast acknowledgment)
  return c.json({ ok: true })
})

/**
 * Handle a delivery status update for a previously-sent message.
 * Updates the message's deliveryStatus in the DB and publishes a Nostr event.
 */
async function handleStatusUpdate(
  services: Services,
  hubId: string | undefined,
  statusUpdate: MessageStatusUpdate,
  env: AppEnv['Bindings']
): Promise<void> {
  if (!statusUpdate.externalId) return

  // Update the message delivery status in DB by providerMessageId
  try {
    await services.conversations.updateMessageDeliveryByExternalId(statusUpdate.externalId, {
      deliveryStatus: statusUpdate.status,
      deliveryError: statusUpdate.failureReason,
    })
  } catch (err) {
    console.error('[messaging] Failed to update message delivery status:', err)
  }

  // Publish status update to Nostr relay so clients can react in real-time
  try {
    const publisher = getNostrPublisher(env)
    publisher
      .publish({
        kind: KIND_MESSAGE_NEW,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', hubId ?? 'global'],
          ['t', 'llamenos:event'],
        ],
        content: JSON.stringify({
          type: 'message:status',
          externalId: statusUpdate.externalId,
          status: statusUpdate.status,
          timestamp: statusUpdate.timestamp,
          ...(statusUpdate.failureReason ? { failureReason: statusUpdate.failureReason } : {}),
        }),
      })
      .catch(() => {})
  } catch {
    // Nostr not configured
  }
}

/**
 * Try to auto-assign a new conversation to an available volunteer.
 * This runs in background via executionCtx.waitUntil() to not delay webhook response.
 */
async function tryAutoAssign(
  services: Services,
  env: AppEnv['Bindings'],
  conversationId: string,
  channelType: MessagingChannelType,
  hubId: string
): Promise<void> {
  try {
    // 1. Check if auto-assign is enabled
    const messagingConfig = await services.settings.getMessagingConfig(hubId)
    if (!messagingConfig?.autoAssign) return

    const maxConcurrent = messagingConfig.maxConcurrentPerVolunteer || 3

    // 2. Get current on-shift volunteers
    const onShiftShifts = await services.shifts.getActiveShifts(hubId)
    if (onShiftShifts.length === 0) return
    const onShiftPubkeys = onShiftShifts.map((s) => s.pubkey)

    // 3. Get volunteer details to filter by channel capability
    const allVolunteers = await services.identity.getVolunteers()
    const onShiftVolunteers = allVolunteers.filter(
      (v) =>
        onShiftPubkeys.includes(v.pubkey) && v.active && !v.onBreak && v.messagingEnabled !== false
    )

    // Filter by channel capability
    const eligibleVolunteers = onShiftVolunteers.filter((v) => {
      // If no channels specified, volunteer can handle all
      if (!v.supportedMessagingChannels || v.supportedMessagingChannels.length === 0) {
        return true
      }
      return v.supportedMessagingChannels.includes(channelType)
    })

    if (eligibleVolunteers.length === 0) return

    // 4. Get volunteer load counts (active conversations per volunteer)
    const { conversations: activeConvs } = await services.conversations.listConversations({
      hubId,
      status: 'active',
      limit: 1000,
    })
    const loads: Record<string, number> = {}
    for (const conv of activeConvs) {
      if (conv.assignedTo) {
        loads[conv.assignedTo] = (loads[conv.assignedTo] ?? 0) + 1
      }
    }

    // 5. Find least-loaded volunteer under max capacity
    let bestCandidate: string | null = null
    let lowestLoad = Number.POSITIVE_INFINITY

    for (const vol of eligibleVolunteers) {
      const currentLoad = loads[vol.pubkey] || 0
      if (currentLoad < maxConcurrent && currentLoad < lowestLoad) {
        lowestLoad = currentLoad
        bestCandidate = vol.pubkey
      }
    }

    if (!bestCandidate) return // All volunteers at capacity

    // 6. Auto-assign the conversation
    await services.conversations.updateConversation(conversationId, {
      assignedTo: bestCandidate,
      status: 'active',
    })

    // Publish assignment to Nostr relay
    try {
      const publisher = getNostrPublisher(env)
      publisher
        .publish({
          kind: KIND_CONVERSATION_ASSIGNED,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', hubId],
            ['t', 'llamenos:event'],
          ],
          content: JSON.stringify({
            type: 'conversation:assigned',
            conversationId,
            assignedTo: bestCandidate,
            autoAssigned: true,
          }),
        })
        .catch((err: unknown) => {
          console.warn('[messaging] Nostr notify for auto-assignment failed:', err)
        })
    } catch (err) {
      console.warn('[messaging] Failed to get Nostr publisher for auto-assignment:', err)
    }

    console.log(
      `[messaging] Auto-assigned conversation ${conversationId} to ${bestCandidate.slice(0, 8)}`
    )
  } catch (err) {
    console.error('[messaging] Auto-assignment failed:', err)
  }
}

export default messaging
