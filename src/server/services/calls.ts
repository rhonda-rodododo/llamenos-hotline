import { and, eq } from 'drizzle-orm'
import type { Database } from '../db'
import { activeCalls, callLegs, callTokens } from '../db/schema'
import { AppError } from '../lib/errors'
import type {
  ActiveCall,
  CallLeg,
  CallTokenPayload,
  CreateActiveCallData,
  CreateCallLegData,
  CreateCallTokenData,
} from '../types'

export class CallService {
  constructor(protected readonly db: Database) {}

  // ------------------------------------------------------------------ Active Calls

  async getActiveCalls(hubId?: string): Promise<ActiveCall[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(activeCalls).where(eq(activeCalls.hubId, hId))
    return rows.map((r) => this.#rowToActiveCall(r))
  }

  async getActiveCall(callSid: string, hubId?: string): Promise<ActiveCall | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(activeCalls)
      .where(and(eq(activeCalls.callSid, callSid), eq(activeCalls.hubId, hId)))
      .limit(1)
    return rows[0] ? this.#rowToActiveCall(rows[0]) : null
  }

  async createActiveCall(data: CreateActiveCallData): Promise<ActiveCall> {
    const [row] = await this.db
      .insert(activeCalls)
      .values({
        callSid: data.callSid,
        hubId: data.hubId ?? 'global',
        callerNumber: data.callerNumber,
        status: data.status ?? 'ringing',
        assignedPubkey: data.assignedPubkey ?? null,
        startedAt: new Date(),
        metadata: {},
      })
      .returning()
    return this.#rowToActiveCall(row)
  }

  async updateActiveCall(
    callSid: string,
    data: Partial<{
      status: string
      assignedPubkey: string | null
      metadata: Record<string, unknown>
    }>,
    hubId?: string
  ): Promise<ActiveCall> {
    const hId = hubId ?? 'global'
    const existing = await this.getActiveCall(callSid, hId)
    if (!existing) throw new AppError(404, 'Active call not found')

    const [row] = await this.db
      .update(activeCalls)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedPubkey !== undefined ? { assignedPubkey: data.assignedPubkey } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      })
      .where(and(eq(activeCalls.callSid, callSid), eq(activeCalls.hubId, hId)))
      .returning()
    return this.#rowToActiveCall(row)
  }

  async deleteActiveCall(callSid: string, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db
      .delete(activeCalls)
      .where(and(eq(activeCalls.callSid, callSid), eq(activeCalls.hubId, hId)))
  }

  // ------------------------------------------------------------------ Call Legs

  async getCallLegs(callSid: string, hubId?: string): Promise<CallLeg[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callLegs)
      .where(and(eq(callLegs.callSid, callSid), eq(callLegs.hubId, hId)))
    return rows.map((r) => this.#rowToCallLeg(r))
  }

  async createCallLeg(data: CreateCallLegData): Promise<CallLeg> {
    const [row] = await this.db
      .insert(callLegs)
      .values({
        legSid: data.legSid,
        callSid: data.callSid,
        hubId: data.hubId ?? 'global',
        volunteerPubkey: data.volunteerPubkey,
        phone: data.phone ?? null,
        status: data.status ?? 'ringing',
      })
      .returning()
    return this.#rowToCallLeg(row)
  }

  async updateCallLeg(legSid: string, status: string): Promise<CallLeg> {
    const [row] = await this.db
      .update(callLegs)
      .set({ status })
      .where(eq(callLegs.legSid, legSid))
      .returning()
    if (!row) throw new AppError(404, 'Call leg not found')
    return this.#rowToCallLeg(row)
  }

  async deleteCallLeg(legSid: string): Promise<void> {
    await this.db.delete(callLegs).where(eq(callLegs.legSid, legSid))
  }

  // ------------------------------------------------------------------ Call Tokens

  async createCallToken(data: CreateCallTokenData): Promise<string> {
    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const ttl = data.ttlSeconds ?? 3600
    const expiresAt = new Date(Date.now() + ttl * 1000)
    await this.db.insert(callTokens).values({
      token,
      callSid: data.callSid,
      hubId: data.hubId ?? 'global',
      pubkey: data.pubkey,
      expiresAt,
    })
    return token
  }

  async validateCallToken(token: string): Promise<CallTokenPayload> {
    const rows = await this.db.select().from(callTokens).where(eq(callTokens.token, token)).limit(1)
    const row = rows[0]
    if (!row) throw new AppError(401, 'Invalid call token')
    if (row.expiresAt < new Date()) {
      await this.db.delete(callTokens).where(eq(callTokens.token, token))
      throw new AppError(401, 'Call token expired')
    }
    return {
      token: row.token,
      callSid: row.callSid,
      hubId: row.hubId,
      pubkey: row.pubkey,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }
  }

  async deleteCallToken(token: string): Promise<void> {
    await this.db.delete(callTokens).where(eq(callTokens.token, token))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToActiveCall(r: typeof activeCalls.$inferSelect): ActiveCall {
    return {
      callSid: r.callSid,
      hubId: r.hubId,
      callerNumber: r.callerNumber,
      status: r.status,
      assignedPubkey: r.assignedPubkey,
      startedAt: r.startedAt,
      metadata: r.metadata as Record<string, unknown>,
    }
  }

  #rowToCallLeg(r: typeof callLegs.$inferSelect): CallLeg {
    return {
      legSid: r.legSid,
      callSid: r.callSid,
      hubId: r.hubId,
      volunteerPubkey: r.volunteerPubkey,
      phone: r.phone,
      status: r.status,
      createdAt: r.createdAt,
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(activeCalls)
    await this.db.delete(callLegs)
    await this.db.delete(callTokens)
  }
}
