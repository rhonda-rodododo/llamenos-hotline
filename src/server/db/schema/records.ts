import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const bans = pgTable('bans', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  phoneHash: hmacHashed('phone_hash').notNull(),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),
  phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),
  encryptedReason: ciphertext('encrypted_reason').notNull(),
  reasonEnvelopes: jsonb<RecipientEnvelope[]>()('reason_envelopes').notNull().default([]),
  bannedBy: text('banned_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  actorPubkey: text('actor_pubkey').notNull(),
  previousEntryHash: text('previous_entry_hash'),
  entryHash: text('entry_hash'),
  encryptedEvent: ciphertext('encrypted_event').notNull(),
  encryptedDetails: ciphertext('encrypted_details').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const callRecords = pgTable('call_records', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedCallerLast4: ciphertext('encrypted_caller_last4'),
  callerLast4Envelopes: jsonb<RecipientEnvelope[]>()('caller_last4_envelopes')
    .notNull()
    .default([]),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  duration: integer('duration'),
  status: text('status').notNull().default('completed'),
  hasTranscription: boolean('has_transcription').notNull().default(false),
  hasVoicemail: boolean('has_voicemail').notNull().default(false),
  hasRecording: boolean('has_recording').notNull().default(false),
  recordingSid: text('recording_sid'),
  voicemailFileId: text('voicemail_file_id'),
  // Encrypted fields (envelope pattern)
  encryptedContent: text('encrypted_content'),
  adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').notNull().default([]),
})

export const noteEnvelopes = pgTable('note_envelopes', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  callId: text('call_id'),
  conversationId: text('conversation_id'),
  contactHash: text('contact_hash'),
  authorPubkey: text('author_pubkey').notNull(),
  encryptedContent: text('encrypted_content').notNull(),
  ephemeralPubkey: text('ephemeral_pubkey'),
  authorEnvelope: jsonb<RecipientEnvelope>()('author_envelope'),
  adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').notNull().default([]),
  replyCount: integer('reply_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Note replies — Epic 123 placeholder. Schema matches parent note encryption pattern. */
export const noteReplies = pgTable('note_replies', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  parentNoteId: text('parent_note_id').notNull(),
  encryptedContent: text('encrypted_content').notNull(),
  authorEnvelope: text('author_envelope').notNull(),
  adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').notNull().default([]),
  authorPubkey: text('author_pubkey').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
