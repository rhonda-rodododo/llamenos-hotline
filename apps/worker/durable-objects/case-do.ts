import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../types'
import type { CaseRecord, CreateRecordBody, RecordContact } from '../schemas/records'
import { DORouter } from '../lib/do-router'
import { parseBlindIndexFilters, matchesBlindIndexFilters } from '../lib/blind-index-query'

/**
 * CaseDO — per-hub E2EE case/record storage.
 *
 * Stores records (instances of entity types) with 3-tier encryption:
 * - Summary: title, status, category (visible to anyone with cases:read)
 * - Fields: custom field values (visible to case participants)
 * - PII: sensitive identifiers (restricted access)
 *
 * Maintains indexes for fast server-side filtering:
 * - idx:status:{statusHash}:{recordId} → true
 * - idx:severity:{severityHash}:{recordId} → true
 * - idx:assigned:{pubkey}:{recordId} → true
 * - idx:type:{entityTypeId}:{recordId} → true
 * - idx:number:{caseNumber} → recordId
 *
 * Contact linking (M:N with role metadata):
 * - recordcontact:{recordId}:{contactId} → RecordContact
 * - contactrecords:{contactId}:{recordId} → RecordContact (reverse index)
 *
 * Storage keys:
 * - record:{uuid} → CaseRecord
 */
export class CaseDO extends DurableObject<Env> {
  private router: DORouter

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.router = new DORouter()
    this.setupRoutes()
  }

  private setupRoutes() {
    // --- List records (paginated, with blind index + entity type + assignment filters) ---
    this.router.get('/records', async (req) => {
      const url = new URL(req.url)
      const page = parseInt(url.searchParams.get('page') ?? '1')
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
      const entityTypeId = url.searchParams.get('entityTypeId')
      const assignedToFilter = url.searchParams.get('assignedTo')
      const parentRecordId = url.searchParams.get('parentRecordId')
      const filters = parseBlindIndexFilters(url.searchParams)

      // Use entity type index for efficient filtering when entityTypeId is specified
      let candidateIds: Set<string> | null = null

      if (entityTypeId) {
        const typeKeys = await this.ctx.storage.list<boolean>({ prefix: `idx:type:${entityTypeId}:` })
        candidateIds = new Set<string>()
        for (const [key] of typeKeys) {
          const parts = key.split(':')
          candidateIds.add(parts[parts.length - 1])
        }
      }

      if (assignedToFilter) {
        const assignedKeys = await this.ctx.storage.list<boolean>({ prefix: `idx:assigned:${assignedToFilter}:` })
        const assignedIds = new Set<string>()
        for (const [key] of assignedKeys) {
          const parts = key.split(':')
          assignedIds.add(parts[parts.length - 1])
        }
        if (candidateIds) {
          // Intersect with entity type candidates
          candidateIds = new Set([...candidateIds].filter(id => assignedIds.has(id)))
        } else {
          candidateIds = assignedIds
        }
      }

      // Fetch records — either from candidate set or full scan
      const records: CaseRecord[] = []

      if (candidateIds !== null) {
        // Fetch specific records by ID
        for (const id of candidateIds) {
          const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
          if (!record) continue
          if (parentRecordId !== null && parentRecordId !== undefined && record.parentRecordId !== parentRecordId) continue
          if (filters.size > 0 && !matchesBlindIndexFilters(record.blindIndexes ?? {}, filters)) continue
          // Also check top-level hash fields against filters
          if (!this.matchesTopLevelFilters(record, filters)) continue
          records.push(record)
        }
      } else {
        // Full scan (no entity type or assignment filter)
        const allKeys = await this.ctx.storage.list<CaseRecord>({ prefix: 'record:', limit: 1000 })
        for (const [, record] of allKeys) {
          if (parentRecordId !== null && parentRecordId !== undefined && record.parentRecordId !== parentRecordId) continue
          if (filters.size > 0 && !matchesBlindIndexFilters(record.blindIndexes ?? {}, filters)) continue
          if (!this.matchesTopLevelFilters(record, filters)) continue
          records.push(record)
        }
      }

      // Sort by updatedAt descending (most recently updated first)
      records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

      const start = (page - 1) * limit
      const paged = records.slice(start, start + limit)

      return Response.json({
        records: paged,
        total: records.length,
        page,
        limit,
        hasMore: start + limit < records.length,
      })
    })

    // --- Get single record ---
    this.router.get('/records/:id', async (_req, { id }) => {
      const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })
      return Response.json(record)
    })

    // --- Lookup by case number ---
    this.router.get('/records/by-number/:number', async (_req, { number }) => {
      const recordId = await this.ctx.storage.get<string>(`idx:number:${number}`)
      if (!recordId) return Response.json({ error: 'Record not found' }, { status: 404 })
      const record = await this.ctx.storage.get<CaseRecord>(`record:${recordId}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })
      return Response.json(record)
    })

    // --- Create record ---
    this.router.post('/records', async (req) => {
      const body = await req.json() as CreateRecordBody & { hubId?: string; createdBy?: string; caseNumber?: string }
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      const record: CaseRecord = {
        id,
        hubId: body.hubId ?? '',
        entityTypeId: body.entityTypeId,
        caseNumber: body.caseNumber,
        statusHash: body.statusHash,
        severityHash: body.severityHash,
        categoryHash: body.categoryHash,
        assignedTo: body.assignedTo ?? [],
        blindIndexes: body.blindIndexes ?? {},
        encryptedSummary: body.encryptedSummary,
        summaryEnvelopes: body.summaryEnvelopes,
        encryptedFields: body.encryptedFields,
        fieldEnvelopes: body.fieldEnvelopes,
        encryptedPII: body.encryptedPII,
        piiEnvelopes: body.piiEnvelopes,
        contactCount: 0,
        interactionCount: 0,
        fileCount: 0,
        eventIds: [],
        parentRecordId: body.parentRecordId,
        createdAt: now,
        updatedAt: now,
        createdBy: body.createdBy ?? '',
      }

      // Build all storage writes atomically
      const puts = new Map<string, unknown>()
      puts.set(`record:${id}`, record)

      // Status index
      puts.set(`idx:status:${record.statusHash}:${id}`, true)

      // Severity index
      if (record.severityHash) {
        puts.set(`idx:severity:${record.severityHash}:${id}`, true)
      }

      // Entity type index
      puts.set(`idx:type:${record.entityTypeId}:${id}`, true)

      // Assignment indexes
      for (const pubkey of record.assignedTo) {
        puts.set(`idx:assigned:${pubkey}:${id}`, true)
      }

      // Case number index
      if (record.caseNumber) {
        puts.set(`idx:number:${record.caseNumber}`, id)
      }

      // Contact links (created atomically with the record)
      if (body.contactLinks) {
        for (const link of body.contactLinks) {
          const rc: RecordContact = {
            recordId: id,
            contactId: link.contactId,
            role: link.role,
            addedAt: now,
            addedBy: record.createdBy,
          }
          puts.set(`recordcontact:${id}:${link.contactId}`, rc)
          puts.set(`contactrecords:${link.contactId}:${id}`, rc)
        }
        record.contactCount = body.contactLinks.length
        puts.set(`record:${id}`, record) // Update with correct contactCount
      }

      await this.ctx.storage.put(Object.fromEntries(puts))

      return Response.json(record, { status: 201 })
    })

    // --- Update record ---
    this.router.patch('/records/:id', async (req, { id }) => {
      const existing = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!existing) return Response.json({ error: 'Record not found' }, { status: 404 })

      const body = await req.json() as Partial<CreateRecordBody>

      const updated: CaseRecord = {
        ...existing,
        ...body,
        id, // Prevent ID override
        hubId: existing.hubId, // Prevent hubId override
        createdAt: existing.createdAt, // Preserve creation timestamp
        createdBy: existing.createdBy, // Preserve creator
        updatedAt: new Date().toISOString(),
        // Preserve counters
        contactCount: existing.contactCount,
        interactionCount: existing.interactionCount,
        fileCount: existing.fileCount,
        eventIds: existing.eventIds,
        // Ensure required fields exist
        assignedTo: body.assignedTo ?? existing.assignedTo,
        blindIndexes: body.blindIndexes ?? existing.blindIndexes,
        statusHash: body.statusHash ?? existing.statusHash,
        encryptedSummary: body.encryptedSummary ?? existing.encryptedSummary,
        summaryEnvelopes: body.summaryEnvelopes ?? existing.summaryEnvelopes,
      }

      const puts = new Map<string, unknown>()
      const deletes: string[] = []

      // Re-index status if changed
      if (body.statusHash && body.statusHash !== existing.statusHash) {
        deletes.push(`idx:status:${existing.statusHash}:${id}`)
        puts.set(`idx:status:${body.statusHash}:${id}`, true)
      }

      // Re-index severity if changed
      if (body.severityHash !== undefined) {
        if (existing.severityHash) {
          deletes.push(`idx:severity:${existing.severityHash}:${id}`)
        }
        if (body.severityHash) {
          puts.set(`idx:severity:${body.severityHash}:${id}`, true)
        }
      }

      // Re-index category if changed (stored in blindIndexes, but also as top-level)
      if (body.categoryHash !== undefined) {
        if (existing.categoryHash) {
          deletes.push(`idx:category:${existing.categoryHash}:${id}`)
        }
        if (body.categoryHash) {
          puts.set(`idx:category:${body.categoryHash}:${id}`, true)
        }
      }

      // Re-index assignments if changed
      if (body.assignedTo) {
        // Remove old assignment indexes
        for (const pubkey of existing.assignedTo) {
          deletes.push(`idx:assigned:${pubkey}:${id}`)
        }
        // Add new assignment indexes
        for (const pubkey of body.assignedTo) {
          puts.set(`idx:assigned:${pubkey}:${id}`, true)
        }
      }

      puts.set(`record:${id}`, updated)

      if (deletes.length > 0) {
        await this.ctx.storage.delete(deletes)
      }
      await this.ctx.storage.put(Object.fromEntries(puts))

      return Response.json(updated)
    })

    // --- Delete record ---
    this.router.delete('/records/:id', async (_req, { id }) => {
      const existing = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!existing) return Response.json({ error: 'Record not found' }, { status: 404 })

      const deletes: string[] = [`record:${id}`]

      // Remove status index
      deletes.push(`idx:status:${existing.statusHash}:${id}`)

      // Remove severity index
      if (existing.severityHash) {
        deletes.push(`idx:severity:${existing.severityHash}:${id}`)
      }

      // Remove entity type index
      deletes.push(`idx:type:${existing.entityTypeId}:${id}`)

      // Remove assignment indexes
      for (const pubkey of existing.assignedTo) {
        deletes.push(`idx:assigned:${pubkey}:${id}`)
      }

      // Remove case number index
      if (existing.caseNumber) {
        deletes.push(`idx:number:${existing.caseNumber}`)
      }

      // Remove contact links (both directions)
      const recordContacts = await this.ctx.storage.list({ prefix: `recordcontact:${id}:` })
      for (const [key, value] of recordContacts) {
        deletes.push(key)
        const rc = value as RecordContact
        deletes.push(`contactrecords:${rc.contactId}:${id}`)
      }

      await this.ctx.storage.delete(deletes)

      return Response.json({ deleted: true })
    })

    // --- Link contact to record ---
    this.router.post('/records/:id/contacts', async (req, { id }) => {
      const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })

      const body = await req.json() as { contactId: string; role: string; addedBy: string }
      const now = new Date().toISOString()

      const rc: RecordContact = {
        recordId: id,
        contactId: body.contactId,
        role: body.role,
        addedAt: now,
        addedBy: body.addedBy,
      }

      const puts = new Map<string, unknown>()
      puts.set(`recordcontact:${id}:${body.contactId}`, rc)
      puts.set(`contactrecords:${body.contactId}:${id}`, rc)

      // Update contact count
      record.contactCount++
      record.updatedAt = now
      puts.set(`record:${id}`, record)

      await this.ctx.storage.put(Object.fromEntries(puts))

      return Response.json(rc, { status: 201 })
    })

    // --- Unlink contact from record ---
    this.router.delete('/records/:id/contacts/:contactId', async (_req, { id, contactId }) => {
      const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })

      const rc = await this.ctx.storage.get<RecordContact>(`recordcontact:${id}:${contactId}`)
      if (!rc) return Response.json({ error: 'Contact link not found' }, { status: 404 })

      const deletes = [
        `recordcontact:${id}:${contactId}`,
        `contactrecords:${contactId}:${id}`,
      ]

      // Update contact count
      record.contactCount = Math.max(0, record.contactCount - 1)
      record.updatedAt = new Date().toISOString()

      await this.ctx.storage.delete(deletes)
      await this.ctx.storage.put(`record:${id}`, record)

      return Response.json({ deleted: true })
    })

    // --- List contacts linked to a record ---
    this.router.get('/records/:id/contacts', async (_req, { id }) => {
      const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })

      const links = await this.ctx.storage.list<RecordContact>({ prefix: `recordcontact:${id}:` })
      const contacts: RecordContact[] = []
      for (const [, rc] of links) {
        contacts.push(rc)
      }

      return Response.json({ contacts })
    })

    // --- Assign volunteers to record ---
    this.router.post('/records/:id/assign', async (req, { id }) => {
      const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })

      const body = await req.json() as { pubkeys: string[] }
      const puts = new Map<string, unknown>()

      // Add new pubkeys (dedup with existing)
      const existingSet = new Set(record.assignedTo)
      for (const pubkey of body.pubkeys) {
        if (!existingSet.has(pubkey)) {
          record.assignedTo.push(pubkey)
          puts.set(`idx:assigned:${pubkey}:${id}`, true)
        }
      }

      record.updatedAt = new Date().toISOString()
      puts.set(`record:${id}`, record)

      await this.ctx.storage.put(Object.fromEntries(puts))

      return Response.json({ assignedTo: record.assignedTo })
    })

    // --- Unassign volunteer from record ---
    this.router.post('/records/:id/unassign', async (req, { id }) => {
      const record = await this.ctx.storage.get<CaseRecord>(`record:${id}`)
      if (!record) return Response.json({ error: 'Record not found' }, { status: 404 })

      const body = await req.json() as { pubkey: string }

      // Remove pubkey from assignedTo
      const idx = record.assignedTo.indexOf(body.pubkey)
      if (idx === -1) return Response.json({ error: 'Pubkey not assigned' }, { status: 404 })

      record.assignedTo.splice(idx, 1)
      record.updatedAt = new Date().toISOString()

      // Remove assignment index
      await this.ctx.storage.delete(`idx:assigned:${body.pubkey}:${id}`)
      await this.ctx.storage.put(`record:${id}`, record)

      return Response.json({ assignedTo: record.assignedTo })
    })

    // --- Test Reset (demo/development only) ---
    this.router.post('/reset', async () => {
      if (this.env.DEMO_MODE !== 'true' && this.env.ENVIRONMENT !== 'development') {
        return new Response('Reset not allowed outside demo/development mode', { status: 403 })
      }
      await this.ctx.storage.deleteAll()
      return Response.json({ ok: true })
    })
  }

  /**
   * Check top-level hash fields (statusHash, severityHash) against filters.
   * The blind index query parser extracts filters from query params; we need to
   * also check top-level record fields that mirror commonly filtered values.
   */
  private matchesTopLevelFilters(
    record: CaseRecord,
    filters: Map<string, string[]>,
  ): boolean {
    const statusFilter = filters.get('statusHash')
    if (statusFilter && !statusFilter.includes(record.statusHash)) {
      return false
    }

    const severityFilter = filters.get('severityHash')
    if (severityFilter) {
      if (!record.severityHash || !severityFilter.includes(record.severityHash)) {
        return false
      }
    }

    const categoryFilter = filters.get('categoryHash')
    if (categoryFilter) {
      if (!record.categoryHash || !categoryFilter.includes(record.categoryHash)) {
        return false
      }
    }

    return true
  }

  async fetch(request: Request): Promise<Response> {
    return this.router.handle(request)
  }
}
