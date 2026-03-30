import type { RecipientEnvelope } from '@shared/types'
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const contactIntakes = pgTable(
  'contact_intakes',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    contactId: text('contact_id'),
    callId: text('call_id'),
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelopes: jsonb<RecipientEnvelope[]>()('payload_envelopes').notNull().default([]),
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    submittedBy: text('submitted_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_intakes_hub_idx').on(table.hubId),
    index('contact_intakes_status_idx').on(table.hubId, table.status),
    index('contact_intakes_contact_idx').on(table.contactId),
  ]
)
