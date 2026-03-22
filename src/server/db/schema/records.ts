import { pgTable, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import type { RecipientEnvelope } from '../../../shared/types'

export const bans = pgTable('bans', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  phone: text('phone').notNull(),
  reason: text('reason').notNull().default(''),
  bannedBy: text('banned_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  event: text('event').notNull(),
  actorPubkey: text('actor_pubkey').notNull(),
  details: jsonb<Record<string, unknown>>()('details').notNull().default({}),
  previousEntryHash: text('previous_entry_hash'),
  entryHash: text('entry_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const callRecords = pgTable('call_records', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  callerLast4: text('caller_last4'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  duration: integer('duration'),
  status: text('status').notNull().default('completed'),
  hasTranscription: boolean('has_transcription').notNull().default(false),
  hasVoicemail: boolean('has_voicemail').notNull().default(false),
  hasRecording: boolean('has_recording').notNull().default(false),
  recordingSid: text('recording_sid'),
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
  authorEnvelope: jsonb<Record<string, unknown>>()('author_envelope'),
  adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').notNull().default([]),
  replyCount: integer('reply_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
