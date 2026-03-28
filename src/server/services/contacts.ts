import type { HmacHash } from '@shared/crypto-types'
import type { Ciphertext } from '@shared/crypto-types'
import { and, desc, eq } from 'drizzle-orm'
import type { RecipientEnvelope } from '../../shared/types'
import type { Database } from '../db'
import {
  contactCallLinks,
  contactConversationLinks,
  contactRelationships,
  contacts,
} from '../db/schema/contacts'
import type { CryptoService } from '../lib/crypto-service'

// ------------------------------------------------------------------ Input/Output types

export interface CreateContactInput {
  hubId: string
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash?: HmacHash
  encryptedDisplayName: Ciphertext
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes?: Ciphertext
  notesEnvelopes?: RecipientEnvelope[]
  encryptedFullName?: Ciphertext
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedPII?: Ciphertext
  piiEnvelopes?: RecipientEnvelope[]
  createdBy: string
}

export interface UpdateContactInput {
  contactType?: string
  riskLevel?: string
  tags?: string[]
  identifierHash?: HmacHash
  encryptedDisplayName?: Ciphertext
  displayNameEnvelopes?: RecipientEnvelope[]
  encryptedNotes?: Ciphertext
  notesEnvelopes?: RecipientEnvelope[]
  encryptedFullName?: Ciphertext
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedPII?: Ciphertext
  piiEnvelopes?: RecipientEnvelope[]
}

export interface ListContactsFilters {
  hubId: string
  contactType?: string
  riskLevel?: string
  tag?: string
}

export interface CreateRelationshipInput {
  hubId: string
  encryptedPayload: Ciphertext
  payloadEnvelopes: RecipientEnvelope[]
  createdBy: string
}

export type ContactRow = typeof contacts.$inferSelect
export type ContactRelationshipRow = typeof contactRelationships.$inferSelect
export type ContactCallLinkRow = typeof contactCallLinks.$inferSelect
export type ContactConversationLinkRow = typeof contactConversationLinks.$inferSelect

// ------------------------------------------------------------------ Service

export class ContactService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ CRUD

  async createContact(input: CreateContactInput): Promise<ContactRow> {
    const id = crypto.randomUUID()
    const now = new Date()
    const [row] = await this.db
      .insert(contacts)
      .values({
        id,
        hubId: input.hubId,
        contactType: input.contactType,
        riskLevel: input.riskLevel,
        tags: input.tags,
        identifierHash: input.identifierHash ?? null,
        encryptedDisplayName: input.encryptedDisplayName,
        displayNameEnvelopes: input.displayNameEnvelopes as RecipientEnvelope[],
        encryptedNotes: input.encryptedNotes ?? null,
        notesEnvelopes: (input.notesEnvelopes ?? []) as RecipientEnvelope[],
        encryptedFullName: input.encryptedFullName ?? null,
        fullNameEnvelopes: (input.fullNameEnvelopes ?? []) as RecipientEnvelope[],
        encryptedPhone: input.encryptedPhone ?? null,
        phoneEnvelopes: (input.phoneEnvelopes ?? []) as RecipientEnvelope[],
        encryptedPII: input.encryptedPII ?? null,
        piiEnvelopes: (input.piiEnvelopes ?? []) as RecipientEnvelope[],
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        lastInteractionAt: null,
      })
      .returning()
    return row
  }

  async getContact(id: string, hubId: string): Promise<ContactRow | null> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.hubId, hubId)))
      .limit(1)
    return rows[0] ?? null
  }

  async listContacts(filters: ListContactsFilters): Promise<ContactRow[]> {
    const conditions = [eq(contacts.hubId, filters.hubId)]

    if (filters.contactType) {
      conditions.push(eq(contacts.contactType, filters.contactType))
    }
    if (filters.riskLevel) {
      conditions.push(eq(contacts.riskLevel, filters.riskLevel))
    }

    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.createdAt))

    // Tag filter in-memory (jsonb array contains check)
    if (filters.tag) {
      const tag = filters.tag
      return rows.filter((r) => (r.tags as string[]).includes(tag))
    }

    return rows
  }

  async updateContact(id: string, hubId: string, input: UpdateContactInput): Promise<ContactRow> {
    const [row] = await this.db
      .update(contacts)
      .set({
        ...(input.contactType !== undefined ? { contactType: input.contactType } : {}),
        ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.identifierHash !== undefined ? { identifierHash: input.identifierHash } : {}),
        ...(input.encryptedDisplayName !== undefined
          ? { encryptedDisplayName: input.encryptedDisplayName }
          : {}),
        ...(input.displayNameEnvelopes !== undefined
          ? { displayNameEnvelopes: input.displayNameEnvelopes as RecipientEnvelope[] }
          : {}),
        ...(input.encryptedNotes !== undefined ? { encryptedNotes: input.encryptedNotes } : {}),
        ...(input.notesEnvelopes !== undefined
          ? { notesEnvelopes: input.notesEnvelopes as RecipientEnvelope[] }
          : {}),
        ...(input.encryptedFullName !== undefined
          ? { encryptedFullName: input.encryptedFullName }
          : {}),
        ...(input.fullNameEnvelopes !== undefined
          ? { fullNameEnvelopes: input.fullNameEnvelopes as RecipientEnvelope[] }
          : {}),
        ...(input.encryptedPhone !== undefined ? { encryptedPhone: input.encryptedPhone } : {}),
        ...(input.phoneEnvelopes !== undefined
          ? { phoneEnvelopes: input.phoneEnvelopes as RecipientEnvelope[] }
          : {}),
        ...(input.encryptedPII !== undefined ? { encryptedPII: input.encryptedPII } : {}),
        ...(input.piiEnvelopes !== undefined
          ? { piiEnvelopes: input.piiEnvelopes as RecipientEnvelope[] }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, id), eq(contacts.hubId, hubId)))
      .returning()
    return row
  }

  async deleteContact(id: string, hubId: string): Promise<void> {
    // Delete linked records first
    await this.db.delete(contactCallLinks).where(eq(contactCallLinks.contactId, id))
    await this.db.delete(contactConversationLinks).where(eq(contactConversationLinks.contactId, id))
    await this.db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.hubId, hubId)))
  }

  // ------------------------------------------------------------------ Dedup

  async checkDuplicate(identifierHash: HmacHash, hubId: string): Promise<ContactRow | null> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.identifierHash, identifierHash), eq(contacts.hubId, hubId)))
      .limit(1)
    return rows[0] ?? null
  }

  async findByIdentifierHash(identifierHash: HmacHash, hubId: string): Promise<ContactRow | null> {
    return this.checkDuplicate(identifierHash, hubId)
  }

  // ------------------------------------------------------------------ Auto-linking

  async linkCall(
    contactId: string,
    callId: string,
    hubId: string,
    linkedBy: string
  ): Promise<ContactCallLinkRow> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(contactCallLinks)
      .values({
        id,
        hubId,
        contactId,
        callId,
        linkedBy,
        createdAt: new Date(),
      })
      .returning()

    // Update lastInteractionAt on the contact
    await this.db
      .update(contacts)
      .set({ lastInteractionAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contacts.id, contactId), eq(contacts.hubId, hubId)))

    return row
  }

  async unlinkCall(contactId: string, callId: string): Promise<void> {
    await this.db
      .delete(contactCallLinks)
      .where(and(eq(contactCallLinks.contactId, contactId), eq(contactCallLinks.callId, callId)))
  }

  async linkConversation(
    contactId: string,
    conversationId: string,
    hubId: string,
    linkedBy: string
  ): Promise<ContactConversationLinkRow> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(contactConversationLinks)
      .values({
        id,
        hubId,
        contactId,
        conversationId,
        linkedBy,
        createdAt: new Date(),
      })
      .returning()

    // Update lastInteractionAt on the contact
    await this.db
      .update(contacts)
      .set({ lastInteractionAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contacts.id, contactId), eq(contacts.hubId, hubId)))

    return row
  }

  async unlinkConversation(contactId: string, conversationId: string): Promise<void> {
    await this.db
      .delete(contactConversationLinks)
      .where(
        and(
          eq(contactConversationLinks.contactId, contactId),
          eq(contactConversationLinks.conversationId, conversationId)
        )
      )
  }

  // ------------------------------------------------------------------ Timeline helpers

  async getLinkedCallIds(contactId: string): Promise<string[]> {
    const rows = await this.db
      .select({ callId: contactCallLinks.callId })
      .from(contactCallLinks)
      .where(eq(contactCallLinks.contactId, contactId))
      .orderBy(desc(contactCallLinks.createdAt))
    return rows.map((r) => r.callId)
  }

  async getLinkedConversationIds(contactId: string): Promise<string[]> {
    const rows = await this.db
      .select({ conversationId: contactConversationLinks.conversationId })
      .from(contactConversationLinks)
      .where(eq(contactConversationLinks.contactId, contactId))
      .orderBy(desc(contactConversationLinks.createdAt))
    return rows.map((r) => r.conversationId)
  }

  // ------------------------------------------------------------------ Relationships

  async createRelationship(input: CreateRelationshipInput): Promise<ContactRelationshipRow> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(contactRelationships)
      .values({
        id,
        hubId: input.hubId,
        encryptedPayload: input.encryptedPayload,
        payloadEnvelopes: input.payloadEnvelopes as RecipientEnvelope[],
        createdBy: input.createdBy,
        createdAt: new Date(),
      })
      .returning()
    return row
  }

  async listRelationships(hubId: string): Promise<ContactRelationshipRow[]> {
    return this.db
      .select()
      .from(contactRelationships)
      .where(eq(contactRelationships.hubId, hubId))
      .orderBy(desc(contactRelationships.createdAt))
  }

  async deleteRelationship(id: string, hubId: string): Promise<void> {
    await this.db
      .delete(contactRelationships)
      .where(and(eq(contactRelationships.id, id), eq(contactRelationships.hubId, hubId)))
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(hubId: string): Promise<void> {
    // Delete in dependency order
    await this.db.delete(contactCallLinks).where(eq(contactCallLinks.hubId, hubId))
    await this.db.delete(contactConversationLinks).where(eq(contactConversationLinks.hubId, hubId))
    await this.db.delete(contactRelationships).where(eq(contactRelationships.hubId, hubId))
    await this.db.delete(contacts).where(eq(contacts.hubId, hubId))
  }
}
