import { boolean, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

interface SubscriberChannel {
  type: 'sms' | 'whatsapp' | 'signal' | 'rcs'
  verified: boolean
}

interface BlastStats {
  totalRecipients: number
  sent: number
  delivered: number
  failed: number
  optedOut: number
}

export const blasts = pgTable('blasts', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  name: text('name').notNull(),
  encryptedName: ciphertext('encrypted_name'),
  encryptedContent: text('encrypted_content').notNull().default(''),
  contentEnvelopes: jsonb<RecipientEnvelope[]>()('content_envelopes').notNull().default([]),
  /** Array of channel types to send to: 'sms' | 'whatsapp' | 'signal' */
  targetChannels: jsonb<string[]>()('target_channels').notNull().default([]),
  /** Filter by subscriber tags (empty = all tags) */
  targetTags: jsonb<string[]>()('target_tags').notNull().default([]),
  /** Filter by subscriber preferred language (empty = all languages) */
  targetLanguages: jsonb<string[]>()('target_languages').notNull().default([]),
  status: text('status').notNull().default('draft'), // 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'
  stats: jsonb<BlastStats>()('stats').notNull().default({
    totalRecipients: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    optedOut: 0,
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  error: text('error'),
})

export const subscribers = pgTable(
  'subscribers',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    /** HMAC-SHA256 hash of subscriber identifier (phone, email, etc.) — never plaintext.
     *  Uses HMAC_SUBSCRIBER label from crypto-labels.ts. */
    identifierHash: text('identifier_hash').notNull(),
    /** XChaCha20-Poly1305 encrypted with hub key — hex(nonce(24) || ciphertext) */
    encryptedIdentifier: text('encrypted_identifier'),
    /** Array of active channels with verification status */
    channels: jsonb<SubscriberChannel[]>()('channels').notNull().default([]),
    /** Subscriber-defined tags for targeting */
    tags: jsonb<string[]>()('tags').notNull().default([]),
    /** Preferred language code (e.g. 'en', 'es') */
    language: text('language'),
    /** Subscription status */
    status: text('status').notNull().default('active'), // 'active' | 'paused' | 'unsubscribed'
    /** Whether double opt-in has been confirmed */
    doubleOptInConfirmed: boolean('double_opt_in_confirmed').notNull().default(false),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Token used in preference management / unsubscribe links */
    preferenceToken: text('preference_token').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.hubId, table.identifierHash)]
)

export const blastDeliveries = pgTable(
  'blast_deliveries',
  {
    id: text('id').primaryKey(),
    blastId: text('blast_id').notNull(),
    subscriberId: text('subscriber_id').notNull(),
    channelType: text('channel_type').notNull().default('sms'),
    status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'delivered' | 'failed' | 'opted_out'
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [unique().on(table.blastId, table.subscriberId)]
)

export const blastSettings = pgTable('blast_settings', {
  hubId: text('hub_id').primaryKey().default('global'),
  optInKeywords: jsonb<string[]>()('opt_in_keywords').notNull().default(['START', 'JOIN', 'YES']),
  optOutKeywords: jsonb<string[]>()('opt_out_keywords')
    .notNull()
    .default(['STOP', 'UNSUBSCRIBE', 'CANCEL']),
  doubleOptInEnabled: boolean('double_opt_in_enabled').notNull().default(false),
  encryptedDoubleOptInMessage: ciphertext('encrypted_double_opt_in_message'),
  encryptedWelcomeMessage: ciphertext('encrypted_welcome_message'),
  encryptedByeMessage: ciphertext('encrypted_bye_message'),
})
