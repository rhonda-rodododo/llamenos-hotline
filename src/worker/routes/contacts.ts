import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const contacts = new Hono<AppEnv>()
contacts.use('*', requirePermission('contacts:view'))

// GET /contacts — list contacts with note counts
contacts.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  // Get contact data from RecordsService (notes with contactHash)
  const { contacts: noteContacts, total } = await services.records.getContacts(
    page,
    limit,
    hubId ?? undefined
  )

  // Enrich with conversation data (get all conversations and group by contactIdentifierHash)
  const { conversations: allConvs } = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    limit: 1000,
  })

  const convByHash = new Map<
    string,
    {
      last4?: string
      conversationCount: number
      reportCount: number
      firstSeen: string
      lastSeen: string
    }
  >()

  for (const conv of allConvs) {
    const hash = conv.contactIdentifierHash
    const isReport = (conv.metadata as Record<string, unknown>)?.type === 'report'
    const existing = convByHash.get(hash)
    if (existing) {
      existing.conversationCount += isReport ? 0 : 1
      existing.reportCount += isReport ? 1 : 0
      const convTime = conv.lastMessageAt.toISOString()
      if (convTime > existing.lastSeen) existing.lastSeen = convTime
      if (conv.createdAt.toISOString() < existing.firstSeen)
        existing.firstSeen = conv.createdAt.toISOString()
      if (conv.contactLast4 && !existing.last4) existing.last4 = conv.contactLast4 ?? undefined
    } else {
      convByHash.set(hash, {
        last4: conv.contactLast4 ?? undefined,
        conversationCount: isReport ? 0 : 1,
        reportCount: isReport ? 1 : 0,
        firstSeen: conv.createdAt.toISOString(),
        lastSeen: conv.lastMessageAt.toISOString(),
      })
    }
  }

  // Merge data
  const merged = new Map<
    string,
    {
      contactHash: string
      last4?: string
      firstSeen: string
      lastSeen: string
      callCount: number
      conversationCount: number
      noteCount: number
      reportCount: number
    }
  >()

  for (const nc of noteContacts) {
    merged.set(nc.contactHash, {
      contactHash: nc.contactHash,
      firstSeen: nc.firstSeen,
      lastSeen: nc.lastSeen,
      callCount: 0,
      conversationCount: 0,
      noteCount: nc.noteCount,
      reportCount: 0,
    })
  }

  for (const [hash, cd] of convByHash.entries()) {
    const existing = merged.get(hash)
    if (existing) {
      existing.last4 = cd.last4
      existing.conversationCount = cd.conversationCount
      existing.reportCount = cd.reportCount
      if (cd.firstSeen < existing.firstSeen) existing.firstSeen = cd.firstSeen
      if (cd.lastSeen > existing.lastSeen) existing.lastSeen = cd.lastSeen
    } else {
      merged.set(hash, {
        contactHash: hash,
        last4: cd.last4,
        firstSeen: cd.firstSeen,
        lastSeen: cd.lastSeen,
        callCount: 0,
        conversationCount: cd.conversationCount,
        noteCount: 0,
        reportCount: cd.reportCount,
      })
    }
  }

  const contactsList = Array.from(merged.values()).sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  )

  return c.json({ contacts: contactsList, total: Math.max(total, contactsList.length) })
})

// GET /contacts/:hash — unified timeline for a contact
contacts.get('/:hash', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const hash = c.req.param('hash')

  // Parallel fetch from RecordsService (notes) and ConversationService (conversations by hash)
  const [contactNotes, allConvs] = await Promise.all([
    services.records.getContactNotes(hash, hubId ?? undefined),
    services.conversations.listConversations({
      hubId: hubId ?? 'global',
      limit: 1000,
    }),
  ])

  // Filter conversations by contactIdentifierHash
  const conversations = allConvs.conversations.filter(
    (conv) => conv.contactIdentifierHash === hash
  )

  return c.json({ notes: contactNotes, conversations })
})

export default contacts
