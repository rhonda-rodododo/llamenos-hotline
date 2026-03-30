import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { permissionGranted, resolveHubPermissions } from '@shared/permissions'
import type { MessagingChannelType } from '@shared/types'
import type { RecipientEnvelope } from '@shared/types'
import { Hono } from 'hono'
import { getMessagingAdapter } from '../lib/adapters'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const contacts = new Hono<AppEnv>()

// ------------------------------------------------------------------ Scope helpers

function getContactReadScope(permissions: string[]): 'own' | 'assigned' | 'all' | null {
  if (permissionGranted(permissions, 'contacts:read-all')) return 'all'
  if (permissionGranted(permissions, 'contacts:read-assigned')) return 'assigned'
  if (permissionGranted(permissions, 'contacts:read-own')) return 'own'
  return null
}

function getContactUpdateScope(permissions: string[]): 'own' | 'assigned' | 'all' | null {
  if (permissionGranted(permissions, 'contacts:update-all')) return 'all'
  if (permissionGranted(permissions, 'contacts:update-assigned')) return 'assigned'
  if (permissionGranted(permissions, 'contacts:update-own')) return 'own'
  return null
}

// Base permission — all routes require contacts:envelope-summary
contacts.use('*', requirePermission('contacts:envelope-summary'))

// ------------------------------------------------------------------ Static routes (MUST precede /:id)

// GET /contacts/recipients — pubkeys by contact permission tier
contacts.get('/recipients', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  const [allUsers, allRoles] = await Promise.all([
    services.identity.getUsers(),
    services.settings.listRoles(),
  ])

  const summaryPubkeys: string[] = []
  const piiPubkeys: string[] = []

  for (const usr of allUsers) {
    if (!usr.active) continue
    const perms = resolveHubPermissions(usr.roles, usr.hubRoles ?? [], allRoles, hubId)
    if (permissionGranted(perms, 'contacts:envelope-summary')) {
      summaryPubkeys.push(usr.pubkey)
    }
    if (permissionGranted(perms, 'contacts:envelope-full')) {
      piiPubkeys.push(usr.pubkey)
    }
  }

  return c.json({ summaryPubkeys, piiPubkeys })
})

// GET /contacts/check-duplicate?identifierHash=<hash> OR ?phone=<phone>
contacts.get('/check-duplicate', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  let hash = c.req.query('identifierHash') as HmacHash | undefined
  const phone = c.req.query('phone')

  if (!hash && phone) {
    hash = services.crypto.hmac(phone, HMAC_PHONE_PREFIX) as HmacHash
  }

  if (!hash) {
    return c.json({ error: 'identifierHash or phone query parameter is required' }, 400)
  }

  const existing = await services.contacts.checkDuplicate(hash, hubId)
  return c.json({ exists: existing !== null, contactId: existing?.id ?? undefined })
})

// POST /contacts/hash-phone — compute HMAC for a phone number (server-side, returns identifierHash)
contacts.post('/hash-phone', async (c) => {
  const services = c.get('services')
  const body = await c.req.json<{ phone?: string }>()
  if (!body.phone) {
    return c.json({ error: 'phone is required' }, 400)
  }
  const identifierHash = services.crypto.hmac(body.phone, HMAC_PHONE_PREFIX)
  return c.json({ identifierHash })
})

// POST /contacts/from-call/:callId — create contact from call + auto-link + auto-assign
contacts.post('/from-call/:callId', requirePermission('contacts:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const callId = c.req.param('callId')

  const body = await c.req.json<{
    contactType: string
    riskLevel: string
    tags?: string[]
    encryptedDisplayName: Ciphertext
    displayNameEnvelopes: RecipientEnvelope[]
    encryptedPhone?: Ciphertext
    phoneEnvelopes?: RecipientEnvelope[]
    identifierHash?: HmacHash
    encryptedFullName?: Ciphertext
    fullNameEnvelopes?: RecipientEnvelope[]
    encryptedPII?: Ciphertext
    piiEnvelopes?: RecipientEnvelope[]
  }>()

  if (
    !body.contactType ||
    !body.riskLevel ||
    !body.encryptedDisplayName ||
    !body.displayNameEnvelopes
  ) {
    return c.json(
      {
        error:
          'contactType, riskLevel, encryptedDisplayName, and displayNameEnvelopes are required',
      },
      400
    )
  }

  // Create contact
  const contact = await services.contacts.createContact({
    hubId,
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags ?? [],
    identifierHash: body.identifierHash,
    encryptedDisplayName: body.encryptedDisplayName,
    displayNameEnvelopes: body.displayNameEnvelopes,
    encryptedPhone: body.encryptedPhone,
    phoneEnvelopes: body.phoneEnvelopes,
    encryptedFullName: body.encryptedFullName,
    fullNameEnvelopes: body.fullNameEnvelopes,
    encryptedPII: body.encryptedPII,
    piiEnvelopes: body.piiEnvelopes,
    createdBy: pubkey ?? '',
  })

  // Auto-link to call
  await services.contacts.linkCall(contact.id, callId, hubId, pubkey ?? '')

  return c.json({ contact, linked: true }, 201)
})

// GET /contacts/relationships — list all relationships for hub
contacts.get('/relationships', requirePermission('contacts:envelope-full'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const relationships = await services.contacts.listRelationships(hubId)
  return c.json({ relationships })
})

// POST /contacts/relationships — create relationship
contacts.post('/relationships', requirePermission('contacts:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    encryptedPayload: Ciphertext
    payloadEnvelopes: RecipientEnvelope[]
  }>()

  if (!body.encryptedPayload || !body.payloadEnvelopes) {
    return c.json({ error: 'encryptedPayload and payloadEnvelopes are required' }, 400)
  }

  const relationship = await services.contacts.createRelationship({
    hubId,
    encryptedPayload: body.encryptedPayload,
    payloadEnvelopes: body.payloadEnvelopes,
    createdBy: pubkey ?? '',
  })

  return c.json({ relationship }, 201)
})

// DELETE /contacts/relationships/:id — delete relationship
contacts.delete('/relationships/:id', requirePermission('contacts:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  await services.contacts.deleteRelationship(id, hubId)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ List / Create

// GET /contacts — list contacts (filterable by contactType, riskLevel, assignedTo)
contacts.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const contactType = c.req.query('contactType')
  const riskLevel = c.req.query('riskLevel')
  const tag = c.req.query('tag')
  const tags = c.req.query('tags')?.split(',').filter(Boolean)
  const assignedTo = c.req.query('assignedTo')

  const rows = await services.contacts.listContactsByScope(
    { hubId, contactType, riskLevel, tag, tags, assignedTo },
    readScope,
    pubkey
  )

  return c.json({ contacts: rows })
})

// POST /contacts — create contact
contacts.post('/', requirePermission('contacts:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    contactType: string
    riskLevel: string
    tags?: string[]
    identifierHash?: HmacHash
    assignedTo?: string
    encryptedDisplayName: Ciphertext
    displayNameEnvelopes: RecipientEnvelope[]
    encryptedNotes?: Ciphertext
    notesEnvelopes?: RecipientEnvelope[]
    encryptedFullName?: Ciphertext
    fullNameEnvelopes?: RecipientEnvelope[]
    encryptedPhone?: Ciphertext
    phoneEnvelopes?: RecipientEnvelope[]
    encryptedPII?: Ciphertext
    piiEnvelopes?: RecipientEnvelope[]
  }>()

  if (
    !body.contactType ||
    !body.riskLevel ||
    !body.encryptedDisplayName ||
    !body.displayNameEnvelopes
  ) {
    return c.json(
      {
        error:
          'contactType, riskLevel, encryptedDisplayName, and displayNameEnvelopes are required',
      },
      400
    )
  }

  const contact = await services.contacts.createContact({
    hubId,
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags ?? [],
    identifierHash: body.identifierHash,
    assignedTo: body.assignedTo,
    encryptedDisplayName: body.encryptedDisplayName,
    displayNameEnvelopes: body.displayNameEnvelopes,
    encryptedNotes: body.encryptedNotes,
    notesEnvelopes: body.notesEnvelopes,
    encryptedFullName: body.encryptedFullName,
    fullNameEnvelopes: body.fullNameEnvelopes,
    encryptedPhone: body.encryptedPhone,
    phoneEnvelopes: body.phoneEnvelopes,
    encryptedPII: body.encryptedPII,
    piiEnvelopes: body.piiEnvelopes,
    createdBy: pubkey ?? '',
  })

  return c.json({ contact }, 201)
})

// ------------------------------------------------------------------ Dynamic routes (/:id)

// GET /contacts/:id — single contact (scope-enforced)
contacts.get('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  // Scope enforcement — check if user can access this specific contact
  const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact })
})

// PATCH /contacts/:id — update contact (tiered permission check + scope enforcement)
contacts.patch('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    contactType?: string
    riskLevel?: string
    tags?: string[]
    identifierHash?: HmacHash
    assignedTo?: string | null
    // Summary-tier fields
    encryptedDisplayName?: Ciphertext
    displayNameEnvelopes?: RecipientEnvelope[]
    encryptedNotes?: Ciphertext
    notesEnvelopes?: RecipientEnvelope[]
    // PII-tier fields
    encryptedFullName?: Ciphertext
    fullNameEnvelopes?: RecipientEnvelope[]
    encryptedPhone?: Ciphertext
    phoneEnvelopes?: RecipientEnvelope[]
    encryptedPII?: Ciphertext
    piiEnvelopes?: RecipientEnvelope[]
  }>()

  // Determine which permission tier is needed
  const hasPiiFields =
    body.encryptedFullName !== undefined ||
    body.fullNameEnvelopes !== undefined ||
    body.encryptedPhone !== undefined ||
    body.phoneEnvelopes !== undefined ||
    body.encryptedPII !== undefined ||
    body.piiEnvelopes !== undefined

  const hasSummaryFields =
    body.encryptedDisplayName !== undefined ||
    body.displayNameEnvelopes !== undefined ||
    body.encryptedNotes !== undefined ||
    body.notesEnvelopes !== undefined ||
    body.contactType !== undefined ||
    body.riskLevel !== undefined ||
    body.tags !== undefined

  if (hasPiiFields && !checkPermission(permissions, 'contacts:update-pii')) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-pii' }, 403)
  }

  if (
    hasSummaryFields &&
    !hasPiiFields &&
    !checkPermission(permissions, 'contacts:update-summary')
  ) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-summary' }, 403)
  }

  // Need at least one permission to update anything
  if (
    !checkPermission(permissions, 'contacts:update-summary') &&
    !checkPermission(permissions, 'contacts:update-pii')
  ) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-summary' }, 403)
  }

  // Scope enforcement — check if user can update this specific contact
  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-own' }, 403)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, updateScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const contact = await services.contacts.updateContact(id, hubId, {
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags,
    identifierHash: body.identifierHash,
    assignedTo: body.assignedTo,
    encryptedDisplayName: body.encryptedDisplayName,
    displayNameEnvelopes: body.displayNameEnvelopes,
    encryptedNotes: body.encryptedNotes,
    notesEnvelopes: body.notesEnvelopes,
    encryptedFullName: body.encryptedFullName,
    fullNameEnvelopes: body.fullNameEnvelopes,
    encryptedPhone: body.encryptedPhone,
    phoneEnvelopes: body.phoneEnvelopes,
    encryptedPII: body.encryptedPII,
    piiEnvelopes: body.piiEnvelopes,
  })

  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact })
})

// DELETE /contacts/:id — delete contact (scope-enforced)
contacts.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  // Scope enforcement for delete — use update scope
  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-own' }, 403)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, updateScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  await services.contacts.deleteContact(id, hubId)
  return c.json({ ok: true })
})

// GET /contacts/:id/timeline — unified timeline (calls, conversations, notes)
contacts.get('/:id/timeline', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  // Scope enforcement
  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  // Fetch linked IDs from contact links
  const [callIds, conversationIds] = await Promise.all([
    services.contacts.getLinkedCallIds(id),
    services.contacts.getLinkedConversationIds(id),
  ])

  // Fetch linked records and notes in parallel
  const [calls, convs, notes] = await Promise.all([
    services.records.getCallRecordsByIds(callIds, hubId),
    services.conversations.getConversationsByIds(conversationIds, hubId),
    services.records.getNotes({ hubId, contactHash: contact.identifierHash ?? undefined }),
  ])

  return c.json({
    calls,
    conversations: convs,
    notes: notes.notes,
  })
})

// POST /contacts/:id/link — manually link a call or conversation
contacts.post('/:id/link', requirePermission('contacts:link'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    type: 'call' | 'conversation'
    targetId: string
  }>()

  if (!body.type || !body.targetId) {
    return c.json({ error: 'type and targetId are required' }, 400)
  }

  if (body.type !== 'call' && body.type !== 'conversation') {
    return c.json({ error: 'type must be "call" or "conversation"' }, 400)
  }

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  // Scope enforcement — user must have update access to link/unlink
  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) return c.json({ error: 'Forbidden' }, 403)
  if (updateScope !== 'all') {
    const accessible = await services.contacts.isContactAccessible(
      id,
      hubId,
      updateScope,
      pubkey ?? ''
    )
    if (!accessible) return c.json({ error: 'Contact not found' }, 404)
  }

  if (body.type === 'call') {
    const link = await services.contacts.linkCall(id, body.targetId, hubId, pubkey ?? '')
    return c.json({ link })
  }

  const link = await services.contacts.linkConversation(id, body.targetId, hubId, pubkey ?? '')
  return c.json({ link })
})

// DELETE /contacts/:id/link — unlink a call or conversation
contacts.delete('/:id/link', requirePermission('contacts:link'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    type: 'call' | 'conversation'
    targetId: string
  }>()

  if (!body.type || !body.targetId) {
    return c.json({ error: 'type and targetId are required' }, 400)
  }

  if (body.type !== 'call' && body.type !== 'conversation') {
    return c.json({ error: 'type must be "call" or "conversation"' }, 400)
  }

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  // Scope enforcement — user must have update access to link/unlink
  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) return c.json({ error: 'Forbidden' }, 403)
  if (updateScope !== 'all') {
    const accessible = await services.contacts.isContactAccessible(
      id,
      hubId,
      updateScope,
      pubkey ?? ''
    )
    if (!accessible) return c.json({ error: 'Contact not found' }, 404)
  }

  if (body.type === 'call') {
    await services.contacts.unlinkCall(id, body.targetId)
  } else {
    await services.contacts.unlinkConversation(id, body.targetId)
  }

  return c.json({ ok: true })
})

// POST /contacts/:id/notify — send notifications to support contacts
contacts.post(
  '/:id/notify',
  requirePermission('contacts:envelope-full', 'conversations:send'),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId') ?? 'global'
    const id = c.req.param('id')

    const contact = await services.contacts.getContact(id, hubId)
    if (!contact) return c.json({ error: 'Contact not found' }, 404)

    const body = await c.req.json<{
      notifications: Array<{
        contactId: string
        channel: { type: string; identifier: string }
        message: string
      }>
    }>()

    if (!body.notifications?.length) {
      return c.json({ error: 'notifications array is required' }, 400)
    }

    const results: Array<{ contactId: string; status: 'sent' | 'failed'; error?: string }> = []

    for (const notification of body.notifications) {
      try {
        const channelType = notification.channel.type as MessagingChannelType
        const adapter = await getMessagingAdapter(
          channelType,
          services.settings,
          services.crypto,
          hubId !== 'global' ? hubId : undefined
        )
        const result = await adapter.sendMessage({
          recipientIdentifier: notification.channel.identifier,
          body: notification.message,
        })
        results.push({
          contactId: notification.contactId,
          status: result.success ? 'sent' : 'failed',
          error: result.success ? undefined : result.error,
        })
      } catch (err) {
        results.push({
          contactId: notification.contactId,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return c.json({ results })
  }
)

export default contacts
