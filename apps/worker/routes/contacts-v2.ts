import { Hono } from 'hono'
import { describeRoute, validator } from 'hono-openapi'
import type { AppEnv } from '../types'
import { getScopedDOs } from '../lib/do-access'
import { requirePermission } from '../middleware/permission-guard'
import { createContactBodySchema, updateContactBodySchema, listContactsQuerySchema } from '../schemas/contacts-v2'
import { authErrors, notFoundError } from '../openapi/helpers'
import { audit } from '../services/audit'

const contactsV2 = new Hono<AppEnv>()

// List contacts (paginated, with blind index filters)
contactsV2.get('/',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'List contacts with E2EE profiles',
    responses: {
      200: { description: 'Paginated list of contacts' },
      ...authErrors,
    },
  }),
  requirePermission('contacts:view'),
  validator('query', listContactsQuerySchema),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const query = c.req.valid('query')
    const qs = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    })
    if (query.contactTypeHash) qs.set('contactTypeHash', query.contactTypeHash)
    if (query.statusHash) qs.set('statusHash', query.statusHash)
    if (query.nameToken) qs.set('nameToken', query.nameToken)

    // Forward any additional blind index filters from the original query string
    const rawParams = new URL(c.req.url).searchParams
    for (const [key, value] of rawParams) {
      if (key.startsWith('field_') || (key.endsWith('Hash') && !qs.has(key))) {
        qs.set(key, value)
      }
    }

    const res = await dos.contactDirectory.fetch(new Request(`http://do/contacts?${qs}`))
    return new Response(res.body, res)
  },
)

// Lookup by identifier hash (phone, Signal username, etc.)
contactsV2.get('/lookup/:identifierHash',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'Lookup contact by identifier hash',
    responses: {
      200: { description: 'Contact or null' },
      ...authErrors,
    },
  }),
  requirePermission('contacts:view'),
  async (c) => {
    const hash = c.req.param('identifierHash')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.contactDirectory.fetch(new Request(`http://do/contacts/lookup/${hash}`))
    return new Response(res.body, res)
  },
)

// Search by name trigrams
contactsV2.get('/search',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'Search contacts by name trigrams',
    responses: {
      200: { description: 'Matching contacts' },
      ...authErrors,
    },
  }),
  requirePermission('contacts:view'),
  async (c) => {
    const tokens = c.req.query('tokens')
    if (!tokens) return c.json({ contacts: [] })
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.contactDirectory.fetch(
      new Request(`http://do/contacts/search?tokens=${encodeURIComponent(tokens)}`),
    )
    return new Response(res.body, res)
  },
)

// Create contact
contactsV2.post('/',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'Create a new contact with encrypted profile',
    responses: {
      201: { description: 'Contact created' },
      ...authErrors,
    },
  }),
  requirePermission('contacts:create'),
  validator('json', createContactBodySchema),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const body = c.req.valid('json')

    const res = await dos.contactDirectory.fetch(new Request('http://do/contacts', {
      method: 'POST',
      body: JSON.stringify({ ...body, hubId: c.get('hubId') ?? body.hubId }),
    }))

    if (!res.ok) return new Response(res.body, res)

    const contact = await res.json() as { id: string }
    await audit(dos.records, 'contactCreated', c.get('pubkey'), { contactId: contact.id })
    return c.json(contact, 201)
  },
)

// Update contact
contactsV2.patch('/:id',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'Update contact profile',
    responses: {
      200: { description: 'Contact updated' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('contacts:edit'),
  validator('json', updateContactBodySchema),
  async (c) => {
    const id = c.req.param('id')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const body = c.req.valid('json')

    const res = await dos.contactDirectory.fetch(new Request(`http://do/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }))

    if (!res.ok) return new Response(res.body, res)

    await audit(dos.records, 'contactUpdated', c.get('pubkey'), { contactId: id })
    return new Response(res.body, res)
  },
)

// Delete contact
contactsV2.delete('/:id',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'Delete a contact',
    responses: {
      200: { description: 'Contact deleted' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('contacts:delete'),
  async (c) => {
    const id = c.req.param('id')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    const res = await dos.contactDirectory.fetch(new Request(`http://do/contacts/${id}`, {
      method: 'DELETE',
    }))

    if (!res.ok) return new Response(res.body, res)

    await audit(dos.records, 'contactDeleted', c.get('pubkey'), { contactId: id })
    return new Response(res.body, res)
  },
)

// Get single contact
contactsV2.get('/:id',
  describeRoute({
    tags: ['Contact Directory'],
    summary: 'Get a single contact',
    responses: {
      200: { description: 'Contact details' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('contacts:view'),
  async (c) => {
    const id = c.req.param('id')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.contactDirectory.fetch(new Request(`http://do/contacts/${id}`))
    return new Response(res.body, res)
  },
)

export default contactsV2
