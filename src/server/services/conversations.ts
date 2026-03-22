import { and, desc, eq, sql } from 'drizzle-orm'
import type { RecipientEnvelope } from '../../shared/types'
import { conversations, messageEnvelopes } from '../db/schema'
import type { Database } from '../db'
import { AppError } from '../lib/errors'
import type {
  Conversation,
  ConversationFilters,
  CreateConversationData,
  CreateMessageData,
  EncryptedMessage,
} from '../types'

export class ConversationService {
  constructor(protected readonly db: Database) {}

  // ------------------------------------------------------------------ Conversations

  async listConversations(filters: ConversationFilters): Promise<{ conversations: Conversation[]; total: number }> {
    const hId = filters.hubId ?? 'global'
    const conditions: ReturnType<typeof eq>[] = [eq(conversations.hubId, hId)]

    if (filters.status) {
      conditions.push(eq(conversations.status, filters.status))
    }
    if (filters.assignedTo) {
      conditions.push(eq(conversations.assignedTo, filters.assignedTo))
    }
    if (filters.channelType) {
      conditions.push(eq(conversations.channelType, filters.channelType))
    }

    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt))

    const all = rows.map((r) => this.#rowToConversation(r))
    const total = all.length
    const page = filters.page ?? 1
    const limit = filters.limit ?? 50
    const start = (page - 1) * limit
    return { conversations: all.slice(start, start + limit), total }
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1)
    return rows[0] ? this.#rowToConversation(rows[0]) : null
  }

  async createConversation(data: CreateConversationData): Promise<Conversation> {
    const id = crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(conversations)
      .values({
        id,
        hubId: data.hubId ?? 'global',
        channelType: data.channelType,
        contactIdentifierHash: data.contactIdentifierHash,
        contactLast4: data.contactLast4 ?? null,
        externalId: data.externalId ?? null,
        assignedTo: data.assignedTo ?? null,
        status: data.status ?? 'waiting',
        metadata: data.metadata ?? {},
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
      })
      .onConflictDoUpdate({
        target: [conversations.hubId, conversations.channelType, conversations.contactIdentifierHash],
        set: {
          updatedAt: now,
          ...(data.externalId ? { externalId: data.externalId } : {}),
          ...(data.status ? { status: data.status } : {}),
        },
      })
      .returning()
    return this.#rowToConversation(row)
  }

  async updateConversation(
    id: string,
    data: Partial<{
      status: string
      assignedTo: string | null
      metadata: Record<string, unknown>
    }>,
  ): Promise<Conversation> {
    const existing = await this.getConversation(id)
    if (!existing) throw new AppError(404, 'Conversation not found')

    const [row] = await this.db
      .update(conversations)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id))
      .returning()
    return this.#rowToConversation(row)
  }

  async findByExternalId(hubId: string, channelType: string, externalId: string): Promise<Conversation | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.hubId, hubId),
          eq(conversations.channelType, channelType),
          eq(conversations.externalId, externalId),
        ),
      )
      .limit(1)
    return rows[0] ? this.#rowToConversation(rows[0]) : null
  }

  async getConversationStats(hubId?: string): Promise<{ total: number; waiting: number; active: number; closed: number }> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.hubId, hId))
    const total = rows.length
    const waiting = rows.filter((r) => r.status === 'waiting').length
    const active = rows.filter((r) => r.status === 'active').length
    const closed = rows.filter((r) => r.status === 'closed').length
    return { total, waiting, active, closed }
  }

  // ------------------------------------------------------------------ Messages

  async getMessages(
    conversationId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{ messages: EncryptedMessage[]; total: number }> {
    const rows = await this.db
      .select()
      .from(messageEnvelopes)
      .where(eq(messageEnvelopes.conversationId, conversationId))
      .orderBy(desc(messageEnvelopes.createdAt))
    const messages = rows.map((r) => this.#rowToMessage(r))
    const total = messages.length
    const start = (page - 1) * limit
    return { messages: messages.slice(start, start + limit), total }
  }

  async addMessage(data: CreateMessageData): Promise<EncryptedMessage> {
    const id = crypto.randomUUID()
    const now = new Date()

    const [row] = await this.db
      .insert(messageEnvelopes)
      .values({
        id,
        conversationId: data.conversationId,
        direction: data.direction,
        authorPubkey: data.authorPubkey,
        encryptedContent: data.encryptedContent,
        readerEnvelopes: (data.readerEnvelopes ?? []) as RecipientEnvelope[],
        hasAttachments: data.hasAttachments ?? false,
        attachmentIds: data.attachmentIds ?? [],
        externalId: data.externalId ?? null,
        status: data.status ?? 'pending',
        createdAt: now,
      })
      .returning()

    // Atomically increment conversation message count to avoid race condition
    await this.db
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, data.conversationId))

    return this.#rowToMessage(row)
  }

  async updateMessageStatus(
    id: string,
    data: { status: string; deliveredAt?: Date; readAt?: Date; failureReason?: string },
  ): Promise<void> {
    await this.db
      .update(messageEnvelopes)
      .set({
        status: data.status,
        ...(data.deliveredAt ? { deliveredAt: data.deliveredAt } : {}),
        ...(data.readAt ? { readAt: data.readAt } : {}),
        ...(data.failureReason ? { failureReason: data.failureReason } : {}),
      })
      .where(eq(messageEnvelopes.id, id))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToConversation(r: typeof conversations.$inferSelect): Conversation {
    return {
      id: r.id,
      hubId: r.hubId,
      channelType: r.channelType,
      contactIdentifierHash: r.contactIdentifierHash,
      contactLast4: r.contactLast4,
      externalId: r.externalId,
      assignedTo: r.assignedTo,
      status: r.status,
      metadata: r.metadata as Record<string, unknown>,
      messageCount: r.messageCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastMessageAt: r.lastMessageAt,
    }
  }

  #rowToMessage(r: typeof messageEnvelopes.$inferSelect): EncryptedMessage {
    return {
      id: r.id,
      conversationId: r.conversationId,
      direction: r.direction,
      authorPubkey: r.authorPubkey,
      encryptedContent: r.encryptedContent,
      readerEnvelopes: (r.readerEnvelopes as RecipientEnvelope[]) ?? [],
      hasAttachments: r.hasAttachments,
      attachmentIds: r.attachmentIds as string[],
      externalId: r.externalId,
      status: r.status,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      failureReason: r.failureReason,
      retryCount: r.retryCount,
      createdAt: r.createdAt,
    }
  }
}
