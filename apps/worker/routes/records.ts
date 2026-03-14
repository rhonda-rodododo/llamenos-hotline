import { Hono } from 'hono'
import { describeRoute, validator } from 'hono-openapi'
import type { AppEnv } from '../types'
import { getScopedDOs } from '../lib/do-access'
import { requirePermission, checkPermission } from '../middleware/permission-guard'
import {
  createRecordBodySchema,
  updateRecordBodySchema,
  listRecordsQuerySchema,
  linkContactBodySchema,
  assignBodySchema,
  unassignBodySchema,
} from '../schemas/records'
import type { CaseRecord } from '../schemas/records'
import { authErrors, notFoundError } from '../openapi/helpers'
import { audit } from '../services/audit'
import { KIND_RECORD_CREATED, KIND_RECORD_UPDATED, KIND_RECORD_ASSIGNED } from '@shared/nostr-events'
import { publishNostrEvent } from '../lib/nostr-events'

const records = new Hono<AppEnv>()

// --- List records (paginated, with filters) ---
records.get('/',
  describeRoute({
    tags: ['Records'],
    summary: 'List case records with pagination and filters',
    responses: {
      200: { description: 'Paginated list of records' },
      ...authErrors,
    },
  }),
  validator('query', listRecordsQuerySchema),
  async (c) => {
    const pubkey = c.get('pubkey')
    const permissions = c.get('permissions')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const query = c.req.valid('query')

    const canReadAll = checkPermission(permissions, 'cases:read-all')
    const canReadAssigned = checkPermission(permissions, 'cases:read-assigned')
    const canReadOwn = checkPermission(permissions, 'cases:read-own')

    if (!canReadAll && !canReadAssigned && !canReadOwn) {
      return c.json({ error: 'Forbidden', required: 'cases:read-own' }, 403)
    }

    const qs = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    })
    if (query.entityTypeId) qs.set('entityTypeId', query.entityTypeId)
    if (query.parentRecordId) qs.set('parentRecordId', query.parentRecordId)

    // For users with only assigned/own read access, filter by assignment
    if (!canReadAll) {
      qs.set('assignedTo', pubkey)
    } else if (query.assignedTo) {
      // Admin can explicitly filter by assignment
      qs.set('assignedTo', query.assignedTo)
    }

    // Forward blind index filters from the original query string
    const rawParams = new URL(c.req.url).searchParams
    for (const [key, value] of rawParams) {
      if (key.startsWith('field_') || (key.endsWith('Hash') && !qs.has(key))) {
        qs.set(key, value)
      }
    }

    const res = await dos.caseManager.fetch(new Request(`http://do/records?${qs}`))
    return new Response(res.body, res)
  },
)

// --- Lookup by case number ---
// NOTE: Must be defined BEFORE /:id to avoid Hono matching "by-number" as an id param
records.get('/by-number/:number',
  describeRoute({
    tags: ['Records'],
    summary: 'Lookup record by case number',
    responses: {
      200: { description: 'Record details' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const number = c.req.param('number')
    const permissions = c.get('permissions')

    const canRead = checkPermission(permissions, 'cases:read-all')
      || checkPermission(permissions, 'cases:read-assigned')
      || checkPermission(permissions, 'cases:read-own')

    if (!canRead) {
      return c.json({ error: 'Forbidden', required: 'cases:read-own' }, 403)
    }

    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.caseManager.fetch(new Request(`http://do/records/by-number/${encodeURIComponent(number)}`))
    if (!res.ok) return new Response(res.body, res)

    // If user can only see assigned records, verify assignment
    const record = await res.json() as CaseRecord
    if (!checkPermission(permissions, 'cases:read-all')) {
      const pubkey = c.get('pubkey')
      if (!record.assignedTo.includes(pubkey) && record.createdBy !== pubkey) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    }

    return c.json(record)
  },
)

// --- Get single record ---
records.get('/:id',
  describeRoute({
    tags: ['Records'],
    summary: 'Get a single record',
    responses: {
      200: { description: 'Record details' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const id = c.req.param('id')
    const pubkey = c.get('pubkey')
    const permissions = c.get('permissions')

    const canRead = checkPermission(permissions, 'cases:read-all')
      || checkPermission(permissions, 'cases:read-assigned')
      || checkPermission(permissions, 'cases:read-own')

    if (!canRead) {
      return c.json({ error: 'Forbidden', required: 'cases:read-own' }, 403)
    }

    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}`))
    if (!res.ok) return new Response(res.body, res)

    const record = await res.json() as CaseRecord

    // Non-admin users can only see records assigned to them or created by them
    if (!checkPermission(permissions, 'cases:read-all')) {
      if (!record.assignedTo.includes(pubkey) && record.createdBy !== pubkey) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    }

    return c.json(record)
  },
)

// --- Create record ---
records.post('/',
  describeRoute({
    tags: ['Records'],
    summary: 'Create a new case record',
    responses: {
      201: { description: 'Record created' },
      ...authErrors,
    },
  }),
  requirePermission('cases:create'),
  validator('json', createRecordBodySchema),
  async (c) => {
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const body = c.req.valid('json')

    // Generate case number if entity type has numbering enabled
    let caseNumber: string | undefined
    const settingsRes = await dos.settings.fetch(
      new Request(`http://do/settings/cms/entity-types/${body.entityTypeId}`),
    )
    if (settingsRes.ok) {
      const entityType = await settingsRes.json() as { numberPrefix?: string; numberingEnabled?: boolean }
      if (entityType.numberingEnabled && entityType.numberPrefix) {
        // Get next number from settings
        const nextRes = await dos.settings.fetch(
          new Request(`http://do/settings/cms/case-number/next`, {
            method: 'POST',
            body: JSON.stringify({ entityTypeId: body.entityTypeId }),
          }),
        )
        if (nextRes.ok) {
          const { caseNumber: num } = await nextRes.json() as { caseNumber: string }
          caseNumber = num
        }
      }
    }

    const res = await dos.caseManager.fetch(new Request('http://do/records', {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        hubId: c.get('hubId') ?? '',
        createdBy: pubkey,
        caseNumber,
      }),
    }))

    if (!res.ok) return new Response(res.body, res)

    const record = await res.json() as CaseRecord

    // Publish Nostr event
    publishNostrEvent(c.env, KIND_RECORD_CREATED, {
      type: 'record:created',
      recordId: record.id,
      entityTypeId: record.entityTypeId,
      caseNumber: record.caseNumber,
    }).catch((e) => { console.error('[records] Failed to publish event:', e) })

    await audit(dos.records, 'recordCreated', pubkey, {
      recordId: record.id,
      entityTypeId: record.entityTypeId,
      caseNumber: record.caseNumber,
    })

    return c.json(record, 201)
  },
)

// --- Update record ---
records.patch('/:id',
  describeRoute({
    tags: ['Records'],
    summary: 'Update a case record',
    responses: {
      200: { description: 'Record updated' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  validator('json', updateRecordBodySchema),
  async (c) => {
    const id = c.req.param('id')
    const pubkey = c.get('pubkey')
    const permissions = c.get('permissions')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    // Check update permissions — cases:update for any, cases:update-own for own
    const canUpdateAll = checkPermission(permissions, 'cases:update')
    const canUpdateOwn = checkPermission(permissions, 'cases:update-own')

    if (!canUpdateAll && !canUpdateOwn) {
      return c.json({ error: 'Forbidden', required: 'cases:update-own' }, 403)
    }

    // If only own update, verify ownership or assignment
    if (!canUpdateAll) {
      const getRes = await dos.caseManager.fetch(new Request(`http://do/records/${id}`))
      if (!getRes.ok) return new Response(getRes.body, getRes)

      const existing = await getRes.json() as CaseRecord
      if (existing.createdBy !== pubkey && !existing.assignedTo.includes(pubkey)) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    }

    const body = c.req.valid('json')

    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }))

    if (!res.ok) return new Response(res.body, res)

    // Publish update event
    publishNostrEvent(c.env, KIND_RECORD_UPDATED, {
      type: 'record:updated',
      recordId: id,
    }).catch((e) => { console.error('[records] Failed to publish event:', e) })

    await audit(dos.records, 'recordUpdated', pubkey, { recordId: id })

    return new Response(res.body, res)
  },
)

// --- Delete record ---
records.delete('/:id',
  describeRoute({
    tags: ['Records'],
    summary: 'Delete a case record',
    responses: {
      200: { description: 'Record deleted' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('cases:delete'),
  async (c) => {
    const id = c.req.param('id')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}`, {
      method: 'DELETE',
    }))

    if (!res.ok) return new Response(res.body, res)

    await audit(dos.records, 'recordDeleted', pubkey, { recordId: id })

    return new Response(res.body, res)
  },
)

// --- Link contact to record ---
records.post('/:id/contacts',
  describeRoute({
    tags: ['Records'],
    summary: 'Link a contact to a record with a role',
    responses: {
      201: { description: 'Contact linked' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('cases:link'),
  validator('json', linkContactBodySchema),
  async (c) => {
    const id = c.req.param('id')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const body = c.req.valid('json')

    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ ...body, addedBy: pubkey }),
    }))

    if (!res.ok) return new Response(res.body, res)

    await audit(dos.records, 'recordContactLinked', pubkey, {
      recordId: id,
      contactId: body.contactId,
      role: body.role,
    })

    return new Response(res.body, { status: 201, headers: res.headers })
  },
)

// --- Unlink contact from record ---
records.delete('/:id/contacts/:contactId',
  describeRoute({
    tags: ['Records'],
    summary: 'Unlink a contact from a record',
    responses: {
      200: { description: 'Contact unlinked' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('cases:link'),
  async (c) => {
    const id = c.req.param('id')
    const contactId = c.req.param('contactId')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}/contacts/${contactId}`, {
      method: 'DELETE',
    }))

    if (!res.ok) return new Response(res.body, res)

    await audit(dos.records, 'recordContactUnlinked', pubkey, {
      recordId: id,
      contactId,
    })

    return new Response(res.body, res)
  },
)

// --- List contacts linked to a record ---
records.get('/:id/contacts',
  describeRoute({
    tags: ['Records'],
    summary: 'List contacts linked to a record',
    responses: {
      200: { description: 'Linked contacts' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const id = c.req.param('id')
    const permissions = c.get('permissions')

    const canRead = checkPermission(permissions, 'cases:read-all')
      || checkPermission(permissions, 'cases:read-assigned')
      || checkPermission(permissions, 'cases:read-own')

    if (!canRead) {
      return c.json({ error: 'Forbidden', required: 'cases:read-own' }, 403)
    }

    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}/contacts`))
    return new Response(res.body, res)
  },
)

// --- Assign volunteers ---
records.post('/:id/assign',
  describeRoute({
    tags: ['Records'],
    summary: 'Assign volunteers to a record',
    responses: {
      200: { description: 'Volunteers assigned' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('cases:assign'),
  validator('json', assignBodySchema),
  async (c) => {
    const id = c.req.param('id')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const body = c.req.valid('json')

    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }))

    if (!res.ok) return new Response(res.body, res)

    // Publish assignment event
    publishNostrEvent(c.env, KIND_RECORD_ASSIGNED, {
      type: 'record:assigned',
      recordId: id,
      pubkeys: body.pubkeys,
    }).catch((e) => { console.error('[records] Failed to publish event:', e) })

    await audit(dos.records, 'recordAssigned', pubkey, {
      recordId: id,
      assignedPubkeys: body.pubkeys,
    })

    return new Response(res.body, res)
  },
)

// --- Unassign volunteer ---
records.post('/:id/unassign',
  describeRoute({
    tags: ['Records'],
    summary: 'Unassign a volunteer from a record',
    responses: {
      200: { description: 'Volunteer unassigned' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('cases:assign'),
  validator('json', unassignBodySchema),
  async (c) => {
    const id = c.req.param('id')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const body = c.req.valid('json')

    const res = await dos.caseManager.fetch(new Request(`http://do/records/${id}/unassign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }))

    if (!res.ok) return new Response(res.body, res)

    // Publish assignment change event
    publishNostrEvent(c.env, KIND_RECORD_ASSIGNED, {
      type: 'record:unassigned',
      recordId: id,
      pubkey: body.pubkey,
    }).catch((e) => { console.error('[records] Failed to publish event:', e) })

    await audit(dos.records, 'recordUnassigned', pubkey, {
      recordId: id,
      unassignedPubkey: body.pubkey,
    })

    return new Response(res.body, res)
  },
)

export default records
