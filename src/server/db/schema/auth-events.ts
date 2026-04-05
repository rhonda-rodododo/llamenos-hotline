import type { RecipientEnvelope } from '@shared/types'
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const userAuthEvents = pgTable(
  'user_auth_events',
  {
    id: text('id').primaryKey(),
    userPubkey: text('user_pubkey').notNull(),
    eventType: text('event_type').notNull(),
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelope: jsonb<RecipientEnvelope[]>()('payload_envelope').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reportedSuspiciousAt: timestamp('reported_suspicious_at', { withTimezone: true }),
  },
  (table) => [
    index('user_auth_events_user_created_idx').on(table.userPubkey, table.createdAt),
    index('user_auth_events_created_at_idx').on(table.createdAt),
  ]
)

export type UserAuthEventRow = typeof userAuthEvents.$inferSelect
export type InsertUserAuthEvent = typeof userAuthEvents.$inferInsert
