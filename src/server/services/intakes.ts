import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../db'
import { contactIntakes } from '../db/schema/intakes'
import type { CryptoService } from '../lib/crypto-service'

export type IntakeRow = typeof contactIntakes.$inferSelect

export class IntakesService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  async submitIntake(data: {
    hubId: string
    contactId?: string
    callId?: string
    encryptedPayload: Ciphertext
    payloadEnvelopes: RecipientEnvelope[]
    submittedBy: string
  }): Promise<IntakeRow> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(contactIntakes)
      .values({
        id,
        hubId: data.hubId,
        contactId: data.contactId ?? null,
        callId: data.callId ?? null,
        encryptedPayload: data.encryptedPayload,
        payloadEnvelopes: data.payloadEnvelopes as RecipientEnvelope[],
        status: 'pending',
        submittedBy: data.submittedBy,
        createdAt: new Date(),
      })
      .returning()
    return row
  }

  async listIntakes(
    hubId: string,
    filters?: { status?: string; contactId?: string }
  ): Promise<IntakeRow[]> {
    const conditions = [eq(contactIntakes.hubId, hubId)]
    if (filters?.status) conditions.push(eq(contactIntakes.status, filters.status))
    if (filters?.contactId) conditions.push(eq(contactIntakes.contactId, filters.contactId))
    return this.db
      .select()
      .from(contactIntakes)
      .where(and(...conditions))
      .orderBy(desc(contactIntakes.createdAt))
  }

  async getIntake(id: string, hubId: string): Promise<IntakeRow | null> {
    const rows = await this.db
      .select()
      .from(contactIntakes)
      .where(and(eq(contactIntakes.id, id), eq(contactIntakes.hubId, hubId)))
      .limit(1)
    return rows[0] ?? null
  }

  async updateIntakeStatus(
    id: string,
    hubId: string,
    status: string,
    reviewedBy: string
  ): Promise<IntakeRow | null> {
    const [row] = await this.db
      .update(contactIntakes)
      .set({ status, reviewedBy, reviewedAt: new Date() })
      .where(and(eq(contactIntakes.id, id), eq(contactIntakes.hubId, hubId)))
      .returning()
    return row ?? null
  }

  async resetForTest(hubId: string): Promise<void> {
    await this.db.delete(contactIntakes).where(eq(contactIntakes.hubId, hubId))
  }
}
