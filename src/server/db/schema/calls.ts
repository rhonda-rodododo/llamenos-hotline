import { boolean, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const callLegTypeEnum = pgEnum('call_leg_type', ['phone', 'browser'])

export const activeCalls = pgTable('active_calls', {
  callSid: text('call_sid').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  callerNumber: text('caller_number').notNull(),
  encryptedCallerNumber: ciphertext('encrypted_caller_number'),
  status: text('status').notNull().default('ringing'), // 'ringing' | 'in-progress' | 'completed'
  assignedPubkey: text('assigned_pubkey'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb<Record<string, unknown>>()('metadata').notNull().default({}),
})

export const callLegs = pgTable('call_legs', {
  legSid: text('leg_sid').primaryKey(),
  callSid: text('call_sid').notNull(),
  hubId: text('hub_id').notNull().default('global'),
  volunteerPubkey: text('volunteer_pubkey').notNull(),
  phone: text('phone'),
  encryptedPhone: ciphertext('encrypted_phone'),
  type: callLegTypeEnum('type').notNull().default('phone'),
  status: text('status').notNull().default('ringing'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const callTokens = pgTable('call_tokens', {
  token: text('token').primaryKey(),
  callSid: text('call_sid').notNull(),
  hubId: text('hub_id').notNull().default('global'),
  pubkey: text('pubkey').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
