import { createRoute, z } from '@hono/zod-openapi'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import { permissionGranted, resolveHubPermissions } from '@shared/permissions'
import type { MessagingChannelType } from '@shared/types'
import type { RecipientEnvelope } from '@shared/types'
import { getMessagingAdapter } from '../lib/adapters'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const contacts = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })
const OkSchema = z.object({ ok: z.boolean() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'contact-abc123' }),
})

const CallIdParamSchema = z.object({
  callId: z.string().openapi({ param: { name: 'callId', in: 'path' }, example: 'call-abc123' }),
})

const RelationshipIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'rel-abc123' }),
})

// Base permission for all routes
const baseMiddleware = [requirePermission('contacts:envelope-summary')]

// ── Scope helpers ──

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

// ── Static routes (MUST precede /{id}) ──

// ── GET /recipients ──

const getRecipientsRoute = createRoute({
  method: 'get',
  path: '/recipients',
  tags: ['Contacts'],
  summary: 'Get pubkeys by contact permission tier',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Recipient pubkeys',
      content: {
        'application/json': {
          schema: z.object({
            summaryPubkeys: z.array(z.string()),
            piiPubkeys: z.array(z.string()),
          }),
        },
      },
    },
  },
})

contacts.openapi(getRecipientsRoute, async (c) => {
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

  return c.json({ summaryPubkeys, piiPubkeys }, 200)
})

// ── GET /check-duplicate ──

const checkDuplicateRoute = createRoute({
  method: 'get',
  path: '/check-duplicate',
  tags: ['Contacts'],
  summary: 'Check for duplicate contact by identifier hash or phone',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Duplicate check result',
      content: {
        'application/json': {
          schema: z.object({
            exists: z.boolean(),
            contactId: z.string().optional(),
          }),
        },
      },
    },
    400: {
      description: 'Missing parameter',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(checkDuplicateRoute, async (c) => {
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
  return c.json({ exists: existing !== null, contactId: existing?.id ?? undefined }, 200)
})

// ── POST /hash-phone ──

const HashPhoneBodySchema = z.object({
  phone: z.string(),
})

const hashPhoneRoute = createRoute({
  method: 'post',
  path: '/hash-phone',
  tags: ['Contacts'],
  summary: 'Compute HMAC for a phone number',
  middleware: baseMiddleware,
  request: {
    body: { content: { 'application/json': { schema: HashPhoneBodySchema } } },
  },
  responses: {
    200: {
      description: 'Phone hash',
      content: {
        'application/json': { schema: z.object({ identifierHash: z.string() }) },
      },
    },
    400: {
      description: 'Missing phone',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(hashPhoneRoute, async (c) => {
  const services = c.get('services')
  const body = c.req.valid('json')
  if (!body.phone) {
    return c.json({ error: 'phone is required' }, 400)
  }
  const identifierHash = services.crypto.hmac(body.phone, HMAC_PHONE_PREFIX)
  return c.json({ identifierHash }, 200)
})

// ── POST /from-call/{callId} ──

const CreateFromCallBodySchema = z.object({
  contactType: z.string(),
  riskLevel: z.string(),
  tags: z.array(z.string()).optional(),
  encryptedDisplayName: z.string(),
  displayNameEnvelopes: z.array(z.object({}).passthrough()),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(z.object({}).passthrough()).optional(),
  identifierHash: z.string().optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const createFromCallRoute = createRoute({
  method: 'post',
  path: '/from-call/{callId}',
  tags: ['Contacts'],
  summary: 'Create contact from call + auto-link + auto-assign',
  middleware: [...baseMiddleware, requirePermission('contacts:create')],
  request: {
    params: CallIdParamSchema,
    body: { content: { 'application/json': { schema: CreateFromCallBodySchema } } },
  },
  responses: {
    201: {
      description: 'Contact created and linked',
      content: {
        'application/json': {
          schema: z.object({ contact: PassthroughSchema, linked: z.boolean() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(createFromCallRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { callId } = c.req.valid('param')

  const body = c.req.valid('json')

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
    identifierHash: body.identifierHash as HmacHash | undefined,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext,
    displayNameEnvelopes: body.displayNameEnvelopes as unknown as RecipientEnvelope[],
    encryptedPhone: body.encryptedPhone as Ciphertext | undefined,
    phoneEnvelopes: body.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedFullName: body.encryptedFullName as Ciphertext | undefined,
    fullNameEnvelopes: body.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPII: body.encryptedPII as Ciphertext | undefined,
    piiEnvelopes: body.piiEnvelopes as unknown as RecipientEnvelope[] | undefined,
    createdBy: pubkey ?? '',
  })

  await services.contacts.linkCall(contact.id, callId, hubId, pubkey ?? '')

  return c.json({ contact, linked: true }, 201)
})

// ── GET /relationships ──

const listRelationshipsRoute = createRoute({
  method: 'get',
  path: '/relationships',
  tags: ['Contacts'],
  summary: 'List all relationships for hub',
  middleware: [...baseMiddleware, requirePermission('contacts:envelope-full')],
  responses: {
    200: {
      description: 'Relationships list',
      content: {
        'application/json': {
          schema: z.object({ relationships: z.array(PassthroughSchema) }),
        },
      },
    },
  },
})

contacts.openapi(listRelationshipsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const relationships = await services.contacts.listRelationships(hubId)
  return c.json({ relationships }, 200)
})

// ── POST /relationships ──

const CreateRelationshipBodySchema = z.object({
  encryptedPayload: z.string(),
  payloadEnvelopes: z.array(z.object({}).passthrough()),
})

const createRelationshipRoute = createRoute({
  method: 'post',
  path: '/relationships',
  tags: ['Contacts'],
  summary: 'Create a relationship',
  middleware: [...baseMiddleware, requirePermission('contacts:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateRelationshipBodySchema } } },
  },
  responses: {
    201: {
      description: 'Relationship created',
      content: {
        'application/json': { schema: z.object({ relationship: PassthroughSchema }) },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(createRelationshipRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  if (!body.encryptedPayload || !body.payloadEnvelopes) {
    return c.json({ error: 'encryptedPayload and payloadEnvelopes are required' }, 400)
  }

  const relationship = await services.contacts.createRelationship({
    hubId,
    encryptedPayload: body.encryptedPayload as Ciphertext,
    payloadEnvelopes: body.payloadEnvelopes as unknown as RecipientEnvelope[],
    createdBy: pubkey ?? '',
  })

  return c.json({ relationship }, 201)
})

// ── DELETE /relationships/{id} ──

const deleteRelationshipRoute = createRoute({
  method: 'delete',
  path: '/relationships/{id}',
  tags: ['Contacts'],
  summary: 'Delete a relationship',
  middleware: [...baseMiddleware, requirePermission('contacts:delete')],
  request: { params: RelationshipIdParamSchema },
  responses: {
    200: {
      description: 'Relationship deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

contacts.openapi(deleteRelationshipRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  await services.contacts.deleteRelationship(id, hubId)
  return c.json({ ok: true }, 200)
})

// ── Bulk operations ──

// ── PATCH /bulk ──

const BulkUpdateBodySchema = z.object({
  contactIds: z.array(z.string()).min(1),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  riskLevel: z.string().optional(),
})

const bulkUpdateRoute = createRoute({
  method: 'patch',
  path: '/bulk',
  tags: ['Contacts'],
  summary: 'Bulk update contacts (tags/risk level)',
  middleware: [...baseMiddleware, requirePermission('contacts:update-own')],
  request: {
    body: { content: { 'application/json': { schema: BulkUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Bulk update result',
      content: {
        'application/json': {
          schema: z.object({ updated: z.number(), skipped: z.number() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(bulkUpdateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const scope = getContactUpdateScope(permissions)
  if (!scope) return c.json({ error: 'Forbidden' }, 403)

  let accessibleIds = body.contactIds
  if (scope !== 'all') {
    const accessible = await Promise.all(
      body.contactIds.map(async (id) => {
        const ok = await services.contacts.isContactAccessible(id, hubId, scope, pubkey ?? '')
        return ok ? id : null
      })
    )
    accessibleIds = accessible.filter((id): id is string => id !== null)
  }

  let updated = 0
  for (const contactId of accessibleIds) {
    const updateData: Record<string, unknown> = {}
    if (body.riskLevel) updateData.riskLevel = body.riskLevel

    if (body.addTags || body.removeTags) {
      const contact = await services.contacts.getContact(contactId, hubId)
      if (contact) {
        let currentTags = (contact.tags as string[]) ?? []
        if (body.addTags) currentTags = [...new Set([...currentTags, ...body.addTags])]
        if (body.removeTags) currentTags = currentTags.filter((t) => !body.removeTags!.includes(t))
        updateData.tags = currentTags
      }
    }

    if (Object.keys(updateData).length > 0) {
      await services.contacts.updateContact(contactId, hubId, updateData)
      updated++
    }
  }

  return c.json(
    {
      updated,
      skipped: body.contactIds.length - accessibleIds.length,
    },
    200
  )
})

// ── DELETE /bulk ──

const BulkDeleteBodySchema = z.object({
  contactIds: z.array(z.string()).min(1),
})

const bulkDeleteRoute = createRoute({
  method: 'delete',
  path: '/bulk',
  tags: ['Contacts'],
  summary: 'Bulk delete contacts',
  middleware: [...baseMiddleware, requirePermission('contacts:delete')],
  request: {
    body: { content: { 'application/json': { schema: BulkDeleteBodySchema } } },
  },
  responses: {
    200: {
      description: 'Bulk delete result',
      content: {
        'application/json': {
          schema: z.object({ deleted: z.number(), skipped: z.number() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(bulkDeleteRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const scope = getContactUpdateScope(permissions)
  if (!scope) return c.json({ error: 'Forbidden' }, 403)

  let deleted = 0
  for (const contactId of body.contactIds) {
    if (scope !== 'all') {
      const ok = await services.contacts.isContactAccessible(contactId, hubId, scope, pubkey ?? '')
      if (!ok) continue
    }
    const result = await services.contacts.deleteContact(contactId, hubId)
    if (result) deleted++
  }

  return c.json(
    {
      deleted,
      skipped: body.contactIds.length - deleted,
    },
    200
  )
})

// ── List / Create ──

// ── GET / — list contacts ──

const listContactsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Contacts'],
  summary: 'List contacts (filterable)',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Contacts list',
      content: {
        'application/json': { schema: z.object({ contacts: z.array(PassthroughSchema) }) },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
  },
})

contacts.openapi(listContactsRoute, async (c) => {
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
  const tagsQuery = c.req.query('tags')?.split(',').filter(Boolean)
  const assignedTo = c.req.query('assignedTo')

  const rows = await services.contacts.listContactsByScope(
    { hubId, contactType, riskLevel, tag, tags: tagsQuery, assignedTo },
    readScope,
    pubkey
  )

  return c.json({ contacts: rows }, 200)
})

// ── POST / — create contact ──

const CreateContactBodySchema = z.object({
  contactType: z.string(),
  riskLevel: z.string(),
  tags: z.array(z.string()).optional(),
  identifierHash: z.string().optional(),
  assignedTo: z.string().optional(),
  encryptedDisplayName: z.string(),
  displayNameEnvelopes: z.array(z.object({}).passthrough()),
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const createContactRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Contacts'],
  summary: 'Create a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateContactBodySchema } } },
  },
  responses: {
    201: {
      description: 'Contact created',
      content: { 'application/json': { schema: z.object({ contact: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(createContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

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
    identifierHash: body.identifierHash as HmacHash | undefined,
    assignedTo: body.assignedTo,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext,
    displayNameEnvelopes: body.displayNameEnvelopes as unknown as RecipientEnvelope[],
    encryptedNotes: body.encryptedNotes as Ciphertext | undefined,
    notesEnvelopes: body.notesEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedFullName: body.encryptedFullName as Ciphertext | undefined,
    fullNameEnvelopes: body.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPhone: body.encryptedPhone as Ciphertext | undefined,
    phoneEnvelopes: body.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPII: body.encryptedPII as Ciphertext | undefined,
    piiEnvelopes: body.piiEnvelopes as unknown as RecipientEnvelope[] | undefined,
    createdBy: pubkey ?? '',
  })

  return c.json({ contact }, 201)
})

// ── Dynamic routes (/{id}) ──

// ── GET /{id} — single contact ──

const getContactRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Contacts'],
  summary: 'Get a single contact',
  middleware: baseMiddleware,
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Contact details',
      content: { 'application/json': { schema: z.object({ contact: PassthroughSchema }) } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(getContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
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

  const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact }, 200)
})

// ── PATCH /{id} — update contact ──

const UpdateContactBodySchema = z.object({
  contactType: z.string().optional(),
  riskLevel: z.string().optional(),
  tags: z.array(z.string()).optional(),
  identifierHash: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
  encryptedDisplayName: z.string().optional(),
  displayNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const updateContactRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Contacts'],
  summary: 'Update a contact',
  middleware: baseMiddleware,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateContactBodySchema } } },
  },
  responses: {
    200: {
      description: 'Contact updated',
      content: { 'application/json': { schema: z.object({ contact: PassthroughSchema }) } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(updateContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

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

  if (
    !checkPermission(permissions, 'contacts:update-summary') &&
    !checkPermission(permissions, 'contacts:update-pii')
  ) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-summary' }, 403)
  }

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
    identifierHash: body.identifierHash as HmacHash | undefined,
    assignedTo: body.assignedTo,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext | undefined,
    displayNameEnvelopes: body.displayNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedNotes: body.encryptedNotes as Ciphertext | undefined,
    notesEnvelopes: body.notesEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedFullName: body.encryptedFullName as Ciphertext | undefined,
    fullNameEnvelopes: body.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPhone: body.encryptedPhone as Ciphertext | undefined,
    phoneEnvelopes: body.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPII: body.encryptedPII as Ciphertext | undefined,
    piiEnvelopes: body.piiEnvelopes as unknown as RecipientEnvelope[] | undefined,
  })

  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact }, 200)
})

// ── DELETE /{id} — delete contact ──

const deleteContactRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Contacts'],
  summary: 'Delete a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:delete')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Contact deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(deleteContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-own' }, 403)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, updateScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  await services.contacts.deleteContact(id, hubId)
  return c.json({ ok: true }, 200)
})

// ── GET /{id}/timeline ──

const getTimelineRoute = createRoute({
  method: 'get',
  path: '/{id}/timeline',
  tags: ['Contacts'],
  summary: 'Get contact timeline (calls, conversations, notes)',
  middleware: baseMiddleware,
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Contact timeline',
      content: {
        'application/json': {
          schema: z.object({
            calls: z.array(PassthroughSchema),
            conversations: z.array(PassthroughSchema),
            notes: z.array(PassthroughSchema),
          }),
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(getTimelineRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
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

  const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const [callIds, conversationIds] = await Promise.all([
    services.contacts.getLinkedCallIds(id),
    services.contacts.getLinkedConversationIds(id),
  ])

  const [calls, convs, notes] = await Promise.all([
    services.records.getCallRecordsByIds(callIds, hubId),
    services.conversations.getConversationsByIds(conversationIds, hubId),
    services.records.getNotes({ hubId, contactHash: contact.identifierHash ?? undefined }),
  ])

  return c.json(
    {
      calls,
      conversations: convs,
      notes: notes.notes,
    },
    200
  )
})

// ── POST /{id}/link ──

const LinkBodySchema = z.object({
  type: z.enum(['call', 'conversation']),
  targetId: z.string(),
})

const linkRoute = createRoute({
  method: 'post',
  path: '/{id}/link',
  tags: ['Contacts'],
  summary: 'Link a call or conversation to a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:link')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: LinkBodySchema } } },
  },
  responses: {
    200: {
      description: 'Link created',
      content: { 'application/json': { schema: z.object({ link: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(linkRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

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
    return c.json({ link }, 200)
  }

  const link = await services.contacts.linkConversation(id, body.targetId, hubId, pubkey ?? '')
  return c.json({ link }, 200)
})

// ── DELETE /{id}/link ──

const unlinkRoute = createRoute({
  method: 'delete',
  path: '/{id}/link',
  tags: ['Contacts'],
  summary: 'Unlink a call or conversation from a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:link')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: LinkBodySchema } } },
  },
  responses: {
    200: {
      description: 'Link removed',
      content: { 'application/json': { schema: OkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(unlinkRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

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

  return c.json({ ok: true }, 200)
})

// ── POST /{id}/notify ──

const NotifyBodySchema = z.object({
  notifications: z.array(
    z.object({
      contactId: z.string(),
      channel: z.object({ type: z.string(), identifier: z.string() }),
      message: z.string(),
    })
  ),
})

const notifyRoute = createRoute({
  method: 'post',
  path: '/{id}/notify',
  tags: ['Contacts'],
  summary: 'Send notifications to support contacts',
  middleware: [
    ...baseMiddleware,
    requirePermission('contacts:envelope-full', 'conversations:send'),
  ],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: NotifyBodySchema } } },
  },
  responses: {
    200: {
      description: 'Notification results',
      content: {
        'application/json': {
          schema: z.object({
            results: z.array(
              z.object({
                contactId: z.string(),
                status: z.enum(['sent', 'failed']),
                error: z.string().optional(),
              })
            ),
          }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

contacts.openapi(notifyRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) return c.json({ error: 'Contact not found' }, 404)

  const body = c.req.valid('json')

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

  return c.json({ results }, 200)
})

export default contacts
