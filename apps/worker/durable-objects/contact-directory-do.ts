import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../types'
import type { Contact, CreateContactBody } from '../schemas/contacts-v2'
import { DORouter } from '../lib/do-router'
import { parseBlindIndexFilters, matchesBlindIndexFilters } from '../lib/blind-index-query'

/**
 * ContactDirectoryDO — per-hub E2EE contact directory.
 *
 * Stores encrypted contact profiles with two encryption tiers:
 * - Summary: visible to anyone with contacts:view
 * - PII: visible only to those with contacts:view-pii
 *
 * Maintains reverse indexes for fast lookup:
 * - idx:id:{identifierHash} → contactId (phone, Signal, email lookup)
 * - idx:name:{nameHash} → contactId
 * - idx:trigram:{token}:{contactId} → true (name search)
 * - idx:tag:{tagHash}:{contactId} → true (tag filtering)
 *
 * Storage keys:
 * - contact:{uuid} → Contact record
 */
export class ContactDirectoryDO extends DurableObject<Env> {
  private router: DORouter

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.router = new DORouter()
    this.setupRoutes()
  }

  private setupRoutes() {
    // --- List contacts (paginated, with blind index filters) ---
    this.router.get('/contacts', async (req) => {
      const url = new URL(req.url)
      const page = parseInt(url.searchParams.get('page') ?? '1')
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
      const filters = parseBlindIndexFilters(url.searchParams)

      const allKeys = await this.ctx.storage.list<Contact>({ prefix: 'contact:', limit: 1000 })
      const contacts: Contact[] = []
      for (const [, value] of allKeys) {
        const contact = value
        if (filters.size > 0 && !matchesBlindIndexFilters(contact.blindIndexes ?? {}, filters)) {
          continue
        }
        contacts.push(contact)
      }

      // Sort by lastInteractionAt descending
      contacts.sort((a, b) =>
        (b.lastInteractionAt ?? b.createdAt).localeCompare(a.lastInteractionAt ?? a.createdAt),
      )

      const start = (page - 1) * limit
      const paged = contacts.slice(start, start + limit)

      return Response.json({
        contacts: paged,
        total: contacts.length,
        page,
        limit,
        hasMore: start + limit < contacts.length,
      })
    })

    // --- Get single contact ---
    this.router.get('/contacts/:id', async (_req, { id }) => {
      const contact = await this.ctx.storage.get<Contact>(`contact:${id}`)
      if (!contact) return Response.json({ error: 'Contact not found' }, { status: 404 })
      return Response.json(contact)
    })

    // --- Lookup by identifier hash ---
    this.router.get('/contacts/lookup/:identifierHash', async (_req, { identifierHash }) => {
      const contactId = await this.ctx.storage.get<string>(`idx:id:${identifierHash}`)
      if (!contactId) return Response.json({ contact: null })
      const contact = await this.ctx.storage.get<Contact>(`contact:${contactId}`)
      return Response.json({ contact: contact ?? null })
    })

    // --- Search by trigram tokens (AND intersection) ---
    this.router.get('/contacts/search', async (req) => {
      const url = new URL(req.url)
      const tokens = url.searchParams.get('tokens')?.split(',').filter(Boolean) ?? []
      if (tokens.length === 0) return Response.json({ contacts: [] })

      // Find contact IDs matching ALL tokens (AND logic)
      const matchSets: Set<string>[] = []
      for (const token of tokens) {
        const keys = await this.ctx.storage.list({ prefix: `idx:trigram:${token}:` })
        const ids = new Set<string>()
        for (const [key] of keys) {
          const parts = key.split(':')
          ids.add(parts[parts.length - 1])
        }
        matchSets.push(ids)
      }

      // Intersect all sets
      let resultIds = matchSets[0] ?? new Set<string>()
      for (let i = 1; i < matchSets.length; i++) {
        resultIds = new Set([...resultIds].filter(id => matchSets[i].has(id)))
      }

      // Fetch matching contacts
      const contacts: Contact[] = []
      for (const id of resultIds) {
        const contact = await this.ctx.storage.get<Contact>(`contact:${id}`)
        if (contact) contacts.push(contact)
      }

      return Response.json({ contacts })
    })

    // --- Create contact ---
    this.router.post('/contacts', async (req) => {
      const body = await req.json() as CreateContactBody
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      const contact: Contact = {
        id,
        hubId: body.hubId ?? '',
        identifierHashes: body.identifierHashes,
        nameHash: body.nameHash,
        trigramTokens: body.trigramTokens,
        encryptedSummary: body.encryptedSummary,
        summaryEnvelopes: body.summaryEnvelopes,
        encryptedPII: body.encryptedPII,
        piiEnvelopes: body.piiEnvelopes,
        contactTypeHash: body.contactTypeHash,
        tagHashes: body.tagHashes ?? [],
        statusHash: body.statusHash,
        blindIndexes: body.blindIndexes ?? {},
        createdAt: now,
        updatedAt: now,
        lastInteractionAt: now,
        caseCount: 0,
        noteCount: 0,
        interactionCount: 0,
      }

      // Store contact and all indexes atomically
      const puts = new Map<string, unknown>()
      puts.set(`contact:${id}`, contact)

      for (const hash of body.identifierHashes) {
        puts.set(`idx:id:${hash}`, id)
      }
      if (body.nameHash) {
        puts.set(`idx:name:${body.nameHash}`, id)
      }
      for (const token of body.trigramTokens ?? []) {
        puts.set(`idx:trigram:${token}:${id}`, true)
      }
      for (const tagHash of body.tagHashes ?? []) {
        puts.set(`idx:tag:${tagHash}:${id}`, true)
      }

      await this.ctx.storage.put(Object.fromEntries(puts))

      return Response.json(contact, { status: 201 })
    })

    // --- Update contact ---
    this.router.patch('/contacts/:id', async (req, { id }) => {
      const existing = await this.ctx.storage.get<Contact>(`contact:${id}`)
      if (!existing) return Response.json({ error: 'Contact not found' }, { status: 404 })

      const body = await req.json() as Partial<CreateContactBody>

      const updated: Contact = {
        ...existing,
        ...body,
        id, // Prevent ID override
        hubId: existing.hubId, // Prevent hubId override
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: new Date().toISOString(),
        // Preserve counters
        caseCount: existing.caseCount,
        noteCount: existing.noteCount,
        interactionCount: existing.interactionCount,
        // Ensure required arrays exist
        tagHashes: body.tagHashes ?? existing.tagHashes,
        blindIndexes: body.blindIndexes ?? existing.blindIndexes,
      }

      const puts = new Map<string, unknown>()
      const deletes: string[] = []

      // Update identifier indexes if changed
      if (body.identifierHashes) {
        for (const hash of existing.identifierHashes) {
          deletes.push(`idx:id:${hash}`)
        }
        for (const hash of body.identifierHashes) {
          puts.set(`idx:id:${hash}`, id)
        }
      }

      // Update name index if changed
      if (body.nameHash !== undefined) {
        if (existing.nameHash) {
          deletes.push(`idx:name:${existing.nameHash}`)
        }
        if (body.nameHash) {
          puts.set(`idx:name:${body.nameHash}`, id)
        }
      }

      // Update trigram indexes if changed
      if (body.trigramTokens) {
        const oldTrigrams = await this.ctx.storage.list({ prefix: 'idx:trigram:' })
        for (const [key] of oldTrigrams) {
          if (key.endsWith(`:${id}`)) deletes.push(key)
        }
        for (const token of body.trigramTokens) {
          puts.set(`idx:trigram:${token}:${id}`, true)
        }
      }

      // Update tag indexes if changed
      if (body.tagHashes) {
        const oldTags = await this.ctx.storage.list({ prefix: 'idx:tag:' })
        for (const [key] of oldTags) {
          if (key.endsWith(`:${id}`)) deletes.push(key)
        }
        for (const tagHash of body.tagHashes) {
          puts.set(`idx:tag:${tagHash}:${id}`, true)
        }
      }

      puts.set(`contact:${id}`, updated)

      // Apply deletes and puts
      if (deletes.length > 0) {
        await this.ctx.storage.delete(deletes)
      }
      await this.ctx.storage.put(Object.fromEntries(puts))

      return Response.json(updated)
    })

    // --- Delete contact ---
    this.router.delete('/contacts/:id', async (_req, { id }) => {
      const existing = await this.ctx.storage.get<Contact>(`contact:${id}`)
      if (!existing) return Response.json({ error: 'Contact not found' }, { status: 404 })

      const deletes: string[] = [`contact:${id}`]

      // Remove identifier indexes
      for (const hash of existing.identifierHashes) {
        deletes.push(`idx:id:${hash}`)
      }

      // Remove name index
      if (existing.nameHash) {
        deletes.push(`idx:name:${existing.nameHash}`)
      }

      // Remove trigram indexes
      const trigrams = await this.ctx.storage.list({ prefix: 'idx:trigram:' })
      for (const [key] of trigrams) {
        if (key.endsWith(`:${id}`)) deletes.push(key)
      }

      // Remove tag indexes
      const tags = await this.ctx.storage.list({ prefix: 'idx:tag:' })
      for (const [key] of tags) {
        if (key.endsWith(`:${id}`)) deletes.push(key)
      }

      await this.ctx.storage.delete(deletes)

      return Response.json({ deleted: true })
    })

    // --- Increment interaction count ---
    this.router.post('/contacts/:id/interaction', async (_req, { id }) => {
      const contact = await this.ctx.storage.get<Contact>(`contact:${id}`)
      if (!contact) return Response.json({ error: 'Not found' }, { status: 404 })

      contact.interactionCount++
      contact.lastInteractionAt = new Date().toISOString()
      contact.updatedAt = contact.lastInteractionAt
      await this.ctx.storage.put(`contact:${id}`, contact)

      return Response.json({ interactionCount: contact.interactionCount })
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

  async fetch(request: Request): Promise<Response> {
    return this.router.handle(request)
  }
}
