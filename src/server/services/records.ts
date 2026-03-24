import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { RecipientEnvelope } from '../../shared/types'
import type { Database } from '../db'
import { auditLog, bans, callRecords, noteEnvelopes } from '../db/schema'
import { AppError } from '../lib/errors'
import type {
  AuditFilters,
  AuditLogEntry,
  BanEntry,
  BulkBanData,
  CallHourBucket,
  CallRecordFilters,
  CallVolumeDay,
  CreateBanData,
  CreateCallRecordData,
  CreateNoteData,
  EncryptedCallRecord,
  EncryptedNote,
  NoteFilters,
  UpdateNoteData,
} from '../types'

export class RecordsService {
  constructor(protected readonly db: Database) {}

  // ------------------------------------------------------------------ Bans

  async getBans(hubId?: string): Promise<BanEntry[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(bans).where(eq(bans.hubId, hId))
    return rows.map((r) => ({
      phone: r.phone,
      reason: r.reason,
      bannedBy: r.bannedBy,
      bannedAt: r.createdAt.toISOString(),
    }))
  }

  async addBan(data: CreateBanData): Promise<BanEntry> {
    const hId = data.hubId ?? 'global'
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(bans)
      .values({ id, hubId: hId, phone: data.phone, reason: data.reason, bannedBy: data.bannedBy })
      .returning()
    return {
      phone: row.phone,
      reason: row.reason,
      bannedBy: row.bannedBy,
      bannedAt: row.createdAt.toISOString(),
    }
  }

  async bulkAddBans(data: BulkBanData): Promise<number> {
    const hId = data.hubId ?? 'global'
    const existing = await this.getBans(hId)
    const existingPhones = new Set(existing.map((b) => b.phone))
    const newPhones = data.phones.filter((p) => !existingPhones.has(p))
    if (newPhones.length === 0) return 0
    await this.db.insert(bans).values(
      newPhones.map((phone) => ({
        id: crypto.randomUUID(),
        hubId: hId,
        phone,
        reason: data.reason,
        bannedBy: data.bannedBy,
      }))
    )
    return newPhones.length
  }

  async removeBan(phone: string, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db.delete(bans).where(and(eq(bans.hubId, hId), eq(bans.phone, phone)))
  }

  async isBanned(phone: string, hubId?: string): Promise<boolean> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select({ id: bans.id })
      .from(bans)
      .where(and(eq(bans.hubId, hId), eq(bans.phone, phone)))
      .limit(1)
    return rows.length > 0
  }

  // ------------------------------------------------------------------ Call Records

  async createCallRecord(data: CreateCallRecordData): Promise<EncryptedCallRecord> {
    const [row] = await this.db
      .insert(callRecords)
      .values({
        id: data.id,
        hubId: data.hubId ?? 'global',
        callerLast4: data.callerLast4 ?? null,
        startedAt: data.startedAt,
        endedAt: data.endedAt ?? null,
        duration: data.duration ?? null,
        status: data.status,
        hasTranscription: data.hasTranscription ?? false,
        hasVoicemail: data.hasVoicemail ?? false,
        hasRecording: data.hasRecording ?? false,
        recordingSid: data.recordingSid ?? null,
        encryptedContent: data.encryptedContent ?? null,
        adminEnvelopes: (data.adminEnvelopes ?? []) as RecipientEnvelope[],
      })
      .returning()
    return this.#rowToCallRecord(row)
  }

  async getCallRecord(id: string, hubId?: string): Promise<EncryptedCallRecord | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callRecords)
      .where(and(eq(callRecords.id, id), eq(callRecords.hubId, hId)))
      .limit(1)
    return rows[0] ? this.#rowToCallRecord(rows[0]) : null
  }

  async updateCallRecord(
    id: string,
    hubId: string,
    data: Partial<CreateCallRecordData>
  ): Promise<EncryptedCallRecord> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callRecords)
      .where(and(eq(callRecords.id, id), eq(callRecords.hubId, hId)))
      .limit(1)
    if (!rows[0]) throw new AppError(404, 'Call record not found')
    const [row] = await this.db
      .update(callRecords)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.hasTranscription !== undefined ? { hasTranscription: data.hasTranscription } : {}),
        ...(data.hasVoicemail !== undefined ? { hasVoicemail: data.hasVoicemail } : {}),
        ...(data.hasRecording !== undefined ? { hasRecording: data.hasRecording } : {}),
        ...(data.recordingSid !== undefined ? { recordingSid: data.recordingSid } : {}),
        ...(data.encryptedContent !== undefined ? { encryptedContent: data.encryptedContent } : {}),
        ...(data.adminEnvelopes !== undefined
          ? { adminEnvelopes: data.adminEnvelopes as RecipientEnvelope[] }
          : {}),
      })
      .where(and(eq(callRecords.id, id), eq(callRecords.hubId, hId)))
      .returning()
    return this.#rowToCallRecord(row)
  }

  async getCallHistory(
    page: number,
    limit: number,
    hubId?: string,
    filters?: CallRecordFilters
  ): Promise<{ calls: EncryptedCallRecord[]; total: number }> {
    const hId = hubId ?? 'global'

    // Build query conditions
    const conditions = [eq(callRecords.hubId, hId)]
    if (filters?.dateFrom) {
      conditions.push(gte(callRecords.startedAt, new Date(filters.dateFrom)))
    }
    if (filters?.dateTo) {
      const toDate = new Date(filters.dateTo)
      toDate.setUTCHours(23, 59, 59, 999)
      conditions.push(lte(callRecords.startedAt, toDate))
    }

    const allRows = await this.db
      .select()
      .from(callRecords)
      .where(and(...conditions))
      .orderBy(desc(callRecords.startedAt))

    let filtered = allRows.map((r) => this.#rowToCallRecord(r))

    if (filters?.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter(
        (c) => c.callerLast4?.includes(q) || c.id.toLowerCase().includes(q)
      )
    }

    const total = filtered.length
    const start = (page - 1) * limit
    return { calls: filtered.slice(start, start + limit), total }
  }

  async getCallsTodayCount(hubId?: string): Promise<number> {
    const hId = hubId ?? 'global'
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const rows = await this.db
      .select({ id: callRecords.id })
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, todayStart)))
    return rows.length
  }

  // ------------------------------------------------------------------ Notes

  async createNote(data: CreateNoteData): Promise<EncryptedNote> {
    const id = data.id ?? crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(noteEnvelopes)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        callId: data.callId ?? null,
        conversationId: data.conversationId ?? null,
        contactHash: data.contactHash ?? null,
        authorPubkey: data.authorPubkey,
        encryptedContent: data.encryptedContent,
        ephemeralPubkey: data.ephemeralPubkey ?? null,
        authorEnvelope: (data.authorEnvelope ?? null) as RecipientEnvelope | null,
        adminEnvelopes: (data.adminEnvelopes ?? []) as RecipientEnvelope[],
        replyCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return this.#rowToNote(row)
  }

  async updateNote(id: string, data: UpdateNoteData): Promise<EncryptedNote> {
    const rows = await this.db.select().from(noteEnvelopes).where(eq(noteEnvelopes.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Note not found')
    if (rows[0].authorPubkey !== data.authorPubkey) throw new AppError(403, 'Forbidden')

    const [row] = await this.db
      .update(noteEnvelopes)
      .set({
        encryptedContent: data.encryptedContent,
        ...(data.authorEnvelope !== undefined
          ? { authorEnvelope: data.authorEnvelope as RecipientEnvelope }
          : {}),
        ...(data.adminEnvelopes !== undefined
          ? { adminEnvelopes: data.adminEnvelopes as RecipientEnvelope[] }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(noteEnvelopes.id, id))
      .returning()
    return this.#rowToNote(row)
  }

  async getNotes(filters: NoteFilters): Promise<{ notes: EncryptedNote[]; total: number }> {
    const hId = filters.hubId ?? 'global'
    const conditions: ReturnType<typeof eq>[] = [eq(noteEnvelopes.hubId, hId)]

    if (filters.authorPubkey) {
      conditions.push(eq(noteEnvelopes.authorPubkey, filters.authorPubkey))
    }
    if (filters.callId) {
      conditions.push(eq(noteEnvelopes.callId, filters.callId))
    }
    if (filters.conversationId) {
      conditions.push(eq(noteEnvelopes.conversationId, filters.conversationId))
    }
    if (filters.contactHash) {
      conditions.push(eq(noteEnvelopes.contactHash, filters.contactHash))
    }

    const rows = await this.db
      .select()
      .from(noteEnvelopes)
      .where(and(...conditions))
      .orderBy(desc(noteEnvelopes.createdAt))

    const notes = rows.map((r) => this.#rowToNote(r))
    const total = notes.length

    if (filters.page && filters.limit) {
      const start = (filters.page - 1) * filters.limit
      return { notes: notes.slice(start, start + filters.limit), total }
    }
    return { notes, total }
  }

  async getNote(id: string): Promise<EncryptedNote | null> {
    const rows = await this.db.select().from(noteEnvelopes).where(eq(noteEnvelopes.id, id)).limit(1)
    return rows[0] ? this.#rowToNote(rows[0]) : null
  }

  async getContacts(
    page: number,
    limit: number,
    hubId?: string
  ): Promise<{
    contacts: Array<{ contactHash: string; firstSeen: string; lastSeen: string; noteCount: number }>
    total: number
  }> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(noteEnvelopes)
      .where(and(eq(noteEnvelopes.hubId, hId), sql`${noteEnvelopes.contactHash} IS NOT NULL`))
      .orderBy(asc(noteEnvelopes.createdAt))

    const contactMap = new Map<
      string,
      { contactHash: string; firstSeen: string; lastSeen: string; noteCount: number }
    >()
    for (const row of rows) {
      if (!row.contactHash) continue
      const createdAt = row.createdAt.toISOString()
      const existing = contactMap.get(row.contactHash)
      if (existing) {
        existing.noteCount++
        if (createdAt < existing.firstSeen) existing.firstSeen = createdAt
        if (createdAt > existing.lastSeen) existing.lastSeen = createdAt
      } else {
        contactMap.set(row.contactHash, {
          contactHash: row.contactHash,
          firstSeen: createdAt,
          lastSeen: createdAt,
          noteCount: 1,
        })
      }
    }

    const contacts = Array.from(contactMap.values()).sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    )
    const total = contacts.length
    const start = (page - 1) * limit
    return { contacts: contacts.slice(start, start + limit), total }
  }

  async getContactNotes(contactHash: string, hubId?: string): Promise<EncryptedNote[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(noteEnvelopes)
      .where(and(eq(noteEnvelopes.hubId, hId), eq(noteEnvelopes.contactHash, contactHash)))
      .orderBy(desc(noteEnvelopes.createdAt))
    return rows.map((r) => this.#rowToNote(r))
  }

  // ------------------------------------------------------------------ Audit Log

  async addAuditEntry(
    hubId: string,
    event: string,
    actorPubkey: string,
    details?: Record<string, unknown>
  ): Promise<AuditLogEntry> {
    const hId = hubId ?? 'global'
    const now = new Date()

    // Get last entry hash for chain
    const lastRows = await this.db
      .select({ entryHash: auditLog.entryHash })
      .from(auditLog)
      .where(eq(auditLog.hubId, hId))
      .orderBy(desc(auditLog.createdAt))
      .limit(1)
    const previousEntryHash = lastRows[0]?.entryHash ?? null

    // Compute hash chain
    const payload = `${event}${actorPubkey}${JSON.stringify(details ?? {})}${previousEntryHash ?? ''}${now.toISOString()}`
    const entryHash = bytesToHex(sha256(utf8ToBytes(payload)))

    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(auditLog)
      .values({
        id,
        hubId: hId,
        event,
        actorPubkey,
        details: details ?? {},
        previousEntryHash,
        entryHash,
        createdAt: now,
      })
      .returning()

    return {
      id: row.id,
      event: row.event,
      actorPubkey: row.actorPubkey,
      details: row.details as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      previousEntryHash: row.previousEntryHash ?? undefined,
      entryHash: row.entryHash ?? undefined,
    }
  }

  async getAuditLog(filters: AuditFilters): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const hId = filters.hubId ?? 'global'
    const page = filters.page ?? 1
    const limit = filters.limit ?? 50

    const conditions: ReturnType<typeof eq>[] = [eq(auditLog.hubId, hId)]
    if (filters.actorPubkey) {
      conditions.push(eq(auditLog.actorPubkey, filters.actorPubkey))
    }
    if (filters.dateFrom) {
      conditions.push(gte(auditLog.createdAt, new Date(filters.dateFrom)))
    }
    if (filters.dateTo) {
      const toDate = new Date(`${filters.dateTo}T23:59:59.999Z`)
      conditions.push(lte(auditLog.createdAt, toDate))
    }

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))

    // Event type category filtering (in-memory)
    const eventCategories: Record<string, string[]> = {
      authentication: [
        'login',
        'logout',
        'sessionCreated',
        'sessionExpired',
        'passkeyRegistered',
        'deviceLinked',
      ],
      volunteers: [
        'volunteerAdded',
        'volunteerRemoved',
        'volunteerRoleChanged',
        'volunteerActivated',
        'volunteerDeactivated',
        'volunteerOnBreak',
        'volunteerOffBreak',
        'inviteCreated',
        'inviteRedeemed',
      ],
      calls: ['callAnswered', 'callEnded', 'callMissed', 'spamReported', 'voicemailReceived'],
      settings: [
        'settingsUpdated',
        'telephonyConfigured',
        'transcriptionToggled',
        'ivrUpdated',
        'customFieldsUpdated',
        'spamSettingsUpdated',
        'callSettingsUpdated',
      ],
      shifts: ['shiftCreated', 'shiftUpdated', 'shiftDeleted'],
      notes: ['noteCreated', 'noteUpdated'],
      messaging: [
        'messageSent',
        'conversationClaimed',
        'conversationClosed',
        'conversationUpdated',
        'reportCreated',
        'reportAssigned',
        'reportUpdated',
      ],
    }

    let entries = rows.map((r) => ({
      id: r.id,
      event: r.event,
      actorPubkey: r.actorPubkey,
      details: r.details as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
      previousEntryHash: r.previousEntryHash ?? undefined,
      entryHash: r.entryHash ?? undefined,
    }))

    if (filters.eventType && eventCategories[filters.eventType]) {
      const allowed = eventCategories[filters.eventType]
      entries = entries.filter((e) => allowed.includes(e.event))
    }
    if (filters.search) {
      const lower = filters.search.toLowerCase()
      entries = entries.filter(
        (e) =>
          e.event.toLowerCase().includes(lower) ||
          e.actorPubkey.toLowerCase().includes(lower) ||
          JSON.stringify(e.details).toLowerCase().includes(lower)
      )
    }

    const total = entries.length
    const start = (page - 1) * limit
    return { entries: entries.slice(start, start + limit), total }
  }

  // ------------------------------------------------------------------ Analytics

  async getCallVolumeByDay(hubId: string | undefined, days: 7 | 30): Promise<CallVolumeDay[]> {
    const hId = hubId ?? 'global'
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    const rows = await this.db
      .select({
        date: sql<string>`DATE(${callRecords.startedAt})`.as('date'),
        count: sql<number>`COUNT(*)::int`.as('count'),
        answered:
          sql<number>`SUM(CASE WHEN ${callRecords.status} = 'completed' AND NOT ${callRecords.hasVoicemail} THEN 1 ELSE 0 END)::int`.as(
            'answered'
          ),
        voicemail:
          sql<number>`SUM(CASE WHEN ${callRecords.hasVoicemail} THEN 1 ELSE 0 END)::int`.as(
            'voicemail'
          ),
      })
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, since)))
      .groupBy(sql`DATE(${callRecords.startedAt})`)
      .orderBy(sql`DATE(${callRecords.startedAt}) ASC`)

    return rows.map((r) => ({
      date: r.date,
      count: Number(r.count),
      answered: Number(r.answered),
      voicemail: Number(r.voicemail),
    }))
  }

  async getCallHourDistribution(hubId: string | undefined, days: 30): Promise<CallHourBucket[]> {
    const hId = hubId ?? 'global'
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    const rows = await this.db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${callRecords.startedAt})::int`.as('hour'),
        count: sql<number>`COUNT(*)::int`.as('count'),
      })
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, since)))
      .groupBy(sql`EXTRACT(HOUR FROM ${callRecords.startedAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${callRecords.startedAt}) ASC`)

    // Fill all 24 hours, defaulting to 0
    const map = new Map<number, number>()
    for (const r of rows) {
      map.set(Number(r.hour), Number(r.count))
    }
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: map.get(h) ?? 0 }))
  }

  async getVolunteerCallStats(
    hubId: string | undefined,
    days: 30
  ): Promise<Array<{ pubkey: string; callsAnswered: number; avgDuration: number }>> {
    const hId = hubId ?? 'global'
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    // NOTE: answeredBy (volunteer pubkey) is stored inside encrypted content for privacy.
    // We can only do volunteer-level stats from the audit log where callAnswered events record actorPubkey.
    const rows = await this.db
      .select({
        actorPubkey: auditLog.actorPubkey,
        callsAnswered: sql<number>`COUNT(*)::int`.as('calls_answered'),
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.hubId, hId),
          eq(auditLog.event, 'callAnswered'),
          gte(auditLog.createdAt, since)
        )
      )
      .groupBy(auditLog.actorPubkey)
      .orderBy(sql`COUNT(*) DESC`)

    return rows.map((r) => ({
      pubkey: r.actorPubkey,
      callsAnswered: Number(r.callsAnswered),
      avgDuration: 0, // Duration is encrypted; not available without decryption
    }))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToCallRecord(r: typeof callRecords.$inferSelect): EncryptedCallRecord {
    return {
      id: r.id,
      callerLast4: r.callerLast4 ?? undefined,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString(),
      duration: r.duration ?? undefined,
      status: r.status as 'completed' | 'unanswered',
      hasTranscription: r.hasTranscription,
      hasVoicemail: r.hasVoicemail,
      hasRecording: r.hasRecording ?? undefined,
      recordingSid: r.recordingSid ?? undefined,
      encryptedContent: r.encryptedContent ?? '',
      adminEnvelopes: (r.adminEnvelopes as RecipientEnvelope[]) ?? [],
    }
  }

  #rowToNote(r: typeof noteEnvelopes.$inferSelect): EncryptedNote {
    return {
      id: r.id,
      callId: r.callId ?? undefined,
      conversationId: r.conversationId ?? undefined,
      contactHash: r.contactHash ?? undefined,
      authorPubkey: r.authorPubkey,
      encryptedContent: r.encryptedContent,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      ephemeralPubkey: r.ephemeralPubkey ?? undefined,
      authorEnvelope: r.authorEnvelope as
        | { wrappedKey: string; ephemeralPubkey: string }
        | undefined,
      adminEnvelopes: (r.adminEnvelopes as RecipientEnvelope[]) ?? undefined,
      replyCount: r.replyCount,
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(auditLog)
    await this.db.delete(bans)
    await this.db.delete(callRecords)
    await this.db.delete(noteEnvelopes)
  }
}
