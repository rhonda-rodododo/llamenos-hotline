import { and, eq } from 'drizzle-orm'
import { blastDeliveries, blasts, subscribers } from '../db/schema'
import type { Database } from '../db'
import { AppError } from '../lib/errors'
import type {
  Blast,
  BlastDelivery,
  CreateBlastData,
  CreateDeliveryData,
  CreateSubscriberData,
  Subscriber,
} from '../types'

export class BlastService {
  constructor(protected readonly db: Database) {}

  // ------------------------------------------------------------------ Blasts

  async listBlasts(hubId?: string): Promise<Blast[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(blasts).where(eq(blasts.hubId, hId))
    return rows.map((r) => this.#rowToBlast(r))
  }

  async getBlast(id: string): Promise<Blast | null> {
    const rows = await this.db.select().from(blasts).where(eq(blasts.id, id)).limit(1)
    return rows[0] ? this.#rowToBlast(rows[0]) : null
  }

  async createBlast(data: CreateBlastData): Promise<Blast> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(blasts)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        name: data.name,
        channel: data.channel,
        content: data.content ?? '',
        status: data.status ?? 'draft',
        totalCount: 0,
        sentCount: 0,
        failedCount: 0,
      })
      .returning()
    return this.#rowToBlast(row)
  }

  async updateBlast(id: string, data: Partial<CreateBlastData & { totalCount: number; sentCount: number; failedCount: number; sentAt: Date }>): Promise<Blast> {
    const existing = await this.getBlast(id)
    if (!existing) throw new AppError(404, 'Blast not found')

    const [row] = await this.db
      .update(blasts)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.totalCount !== undefined ? { totalCount: data.totalCount } : {}),
        ...(data.sentCount !== undefined ? { sentCount: data.sentCount } : {}),
        ...(data.failedCount !== undefined ? { failedCount: data.failedCount } : {}),
        ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
      })
      .where(eq(blasts.id, id))
      .returning()
    return this.#rowToBlast(row)
  }

  async deleteBlast(id: string): Promise<void> {
    await this.db.delete(blasts).where(eq(blasts.id, id))
  }

  // ------------------------------------------------------------------ Subscribers

  async listSubscribers(hubId?: string): Promise<Subscriber[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(subscribers).where(eq(subscribers.hubId, hId))
    return rows.map((r) => this.#rowToSubscriber(r))
  }

  async getSubscriber(id: string): Promise<Subscriber | null> {
    const rows = await this.db.select().from(subscribers).where(eq(subscribers.id, id)).limit(1)
    return rows[0] ? this.#rowToSubscriber(rows[0]) : null
  }

  async findSubscriberByPhone(phone: string, channel: string, hubId?: string): Promise<Subscriber | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(subscribers)
      .where(
        and(
          eq(subscribers.hubId, hId),
          eq(subscribers.channel, channel),
          eq(subscribers.phoneNumber, phone),
        ),
      )
      .limit(1)
    return rows[0] ? this.#rowToSubscriber(rows[0]) : null
  }

  async createSubscriber(data: CreateSubscriberData): Promise<Subscriber> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(subscribers)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        phoneNumber: data.phoneNumber,
        channel: data.channel,
        active: data.active ?? true,
        token: data.token ?? null,
        metadata: data.metadata ?? {},
      })
      .onConflictDoUpdate({
        target: [subscribers.hubId, subscribers.channel, subscribers.phoneNumber],
        set: {
          active: data.active ?? true,
          ...(data.token ? { token: data.token } : {}),
          ...(data.metadata ? { metadata: data.metadata } : {}),
        },
      })
      .returning()
    return this.#rowToSubscriber(row)
  }

  async updateSubscriber(id: string, data: Partial<CreateSubscriberData>): Promise<Subscriber> {
    const existing = await this.getSubscriber(id)
    if (!existing) throw new AppError(404, 'Subscriber not found')

    const [row] = await this.db
      .update(subscribers)
      .set({
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.token !== undefined ? { token: data.token } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      })
      .where(eq(subscribers.id, id))
      .returning()
    return this.#rowToSubscriber(row)
  }

  async deleteSubscriber(id: string): Promise<void> {
    await this.db.delete(subscribers).where(eq(subscribers.id, id))
  }

  async getSubscriberStats(hubId?: string): Promise<{ total: number; active: number; inactive: number }> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select({ active: subscribers.active })
      .from(subscribers)
      .where(eq(subscribers.hubId, hId))
    const total = rows.length
    const active = rows.filter((r) => r.active).length
    return { total, active, inactive: total - active }
  }

  // ------------------------------------------------------------------ Deliveries

  async createDelivery(data: CreateDeliveryData): Promise<BlastDelivery> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(blastDeliveries)
      .values({
        id,
        blastId: data.blastId,
        subscriberId: data.subscriberId,
        status: data.status ?? 'pending',
      })
      .returning()
    return this.#rowToDelivery(row)
  }

  async updateDelivery(
    id: string,
    data: { status: string; error?: string; sentAt?: Date },
  ): Promise<BlastDelivery> {
    const [row] = await this.db
      .update(blastDeliveries)
      .set({
        status: data.status,
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
      })
      .where(eq(blastDeliveries.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Delivery not found')
    return this.#rowToDelivery(row)
  }

  async getDeliveriesForBlast(blastId: string): Promise<BlastDelivery[]> {
    const rows = await this.db
      .select()
      .from(blastDeliveries)
      .where(eq(blastDeliveries.blastId, blastId))
    return rows.map((r) => this.#rowToDelivery(r))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToBlast(r: typeof blasts.$inferSelect): Blast {
    return {
      id: r.id,
      hubId: r.hubId,
      name: r.name,
      channel: r.channel,
      content: r.content,
      status: r.status,
      totalCount: r.totalCount,
      sentCount: r.sentCount,
      failedCount: r.failedCount,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
    }
  }

  #rowToSubscriber(r: typeof subscribers.$inferSelect): Subscriber {
    return {
      id: r.id,
      hubId: r.hubId,
      phoneNumber: r.phoneNumber,
      channel: r.channel,
      active: r.active,
      token: r.token,
      metadata: r.metadata as Record<string, unknown>,
      createdAt: r.createdAt,
    }
  }

  #rowToDelivery(r: typeof blastDeliveries.$inferSelect): BlastDelivery {
    return {
      id: r.id,
      blastId: r.blastId,
      subscriberId: r.subscriberId,
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
    }
  }
}
