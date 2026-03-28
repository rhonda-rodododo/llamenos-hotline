import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),

    // Plaintext (queryable)
    contactType: text('contact_type').notNull().default('caller'),
    riskLevel: text('risk_level').notNull().default('low'),
    tags: jsonb<string[]>()('tags').notNull().default([]),
    identifierHash: hmacHashed('identifier_hash'),

    // Tier 1 — ECIES envelopes (contacts:read-summary recipients)
    encryptedDisplayName: ciphertext('encrypted_display_name').notNull(),
    displayNameEnvelopes: jsonb<RecipientEnvelope[]>()('display_name_envelopes')
      .notNull()
      .default([]),
    encryptedNotes: ciphertext('encrypted_notes'),
    notesEnvelopes: jsonb<RecipientEnvelope[]>()('notes_envelopes').notNull().default([]),

    // Tier 2 — per-field ECIES (contacts:read-pii recipients)
    encryptedFullName: ciphertext('encrypted_full_name'),
    fullNameEnvelopes: jsonb<RecipientEnvelope[]>()('full_name_envelopes').notNull().default([]),
    encryptedPhone: ciphertext('encrypted_phone'),
    phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),

    // Tier 2 — blob ECIES (contacts:read-pii recipients)
    encryptedPII: ciphertext('encrypted_pii'),
    piiEnvelopes: jsonb<RecipientEnvelope[]>()('pii_envelopes').notNull().default([]),

    // Metadata
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('contacts_hub_idx').on(table.hubId),
    index('contacts_identifier_hash_idx').on(table.hubId, table.identifierHash),
  ]
)

export const contactRelationships = pgTable(
  'contact_relationships',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),

    // Fully E2EE — server sees nothing about who is linked
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelopes: jsonb<RecipientEnvelope[]>()('payload_envelopes').notNull().default([]),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contact_relationships_hub_idx').on(table.hubId)]
)

export const contactCallLinks = pgTable(
  'contact_call_links',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    contactId: text('contact_id').notNull(),
    callId: text('call_id').notNull(),
    linkedBy: text('linked_by').notNull(), // pubkey or 'auto'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_call_links_contact_idx').on(table.contactId),
    index('contact_call_links_call_idx').on(table.callId),
  ]
)

export const contactConversationLinks = pgTable(
  'contact_conversation_links',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    contactId: text('contact_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    linkedBy: text('linked_by').notNull(), // pubkey or 'auto'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_conversation_links_contact_idx').on(table.contactId),
    index('contact_conversation_links_conversation_idx').on(table.conversationId),
  ]
)
