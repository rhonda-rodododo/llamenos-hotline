import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { Hono } from 'hono'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const contacts = new Hono<AppEnv>()

// Base permission — all routes require contacts:read-summary
contacts.use('*', requirePermission('contacts:read-summary'))

// ------------------------------------------------------------------ Static routes (MUST precede /:id)

// GET /contacts/check-duplicate?identifierHash=<hash>
contacts.get('/check-duplicate', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const identifierHash = c.req.query('identifierHash')

  if (!identifierHash) {
    return c.json({ error: 'identifierHash query parameter is required' }, 400)
  }

  const existing = await services.contacts.checkDuplicate(identifierHash as HmacHash, hubId)
  return c.json({ exists: existing !== null, contactId: existing?.id ?? undefined })
})

// GET /contacts/relationships — list all relationships for hub
contacts.get('/relationships', requirePermission('contacts:read-pii'), async (c) => {
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

// GET /contacts — list contacts (filterable by contactType, riskLevel)
contacts.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  const contactType = c.req.query('contactType')
  const riskLevel = c.req.query('riskLevel')
  const tag = c.req.query('tag')

  const rows = await services.contacts.listContacts({
    hubId,
    contactType,
    riskLevel,
    tag,
  })

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

// GET /contacts/:id — single contact
contacts.get('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact })
})

// PATCH /contacts/:id — update contact (tiered permission check)
contacts.patch('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const permissions = c.get('permissions')

  const body = await c.req.json<{
    contactType?: string
    riskLevel?: string
    tags?: string[]
    identifierHash?: HmacHash
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

  const contact = await services.contacts.updateContact(id, hubId, {
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags,
    identifierHash: body.identifierHash,
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

// DELETE /contacts/:id — delete contact
contacts.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  await services.contacts.deleteContact(id, hubId)
  return c.json({ ok: true })
})

// GET /contacts/:id/timeline — unified timeline (calls, conversations, notes)
contacts.get('/:id/timeline', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
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

  if (body.type === 'call') {
    await services.contacts.unlinkCall(id, body.targetId)
  } else {
    await services.contacts.unlinkConversation(id, body.targetId)
  }

  return c.json({ ok: true })
})

export default contacts
