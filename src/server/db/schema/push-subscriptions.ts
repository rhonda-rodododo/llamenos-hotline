import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pubkey: text('pubkey').notNull(),
    endpointHash: hmacHashed('endpoint_hash').notNull(),
    encryptedEndpoint: ciphertext('encrypted_endpoint').notNull(),
    encryptedAuthKey: ciphertext('encrypted_auth_key').notNull(),
    encryptedP256dhKey: ciphertext('encrypted_p256dh_key').notNull(),
    encryptedDeviceLabel: ciphertext('encrypted_device_label'),
    deviceLabelEnvelopes: jsonb<RecipientEnvelope[]>()('device_label_envelopes')
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('push_subscriptions_endpoint_hash_unique').on(table.endpointHash)]
)
