import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { reportTypes } from './report-types'
import { hubs } from './settings'

export const firehoseConnectionStatusEnum = pgEnum('firehose_connection_status', [
  'pending',
  'active',
  'paused',
  'disabled',
])

export const firehoseConnections = pgTable(
  'firehose_connections',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id')
      .notNull()
      .references(() => hubs.id),
    signalGroupId: text('signal_group_id'),
    displayName: text('display_name').notNull().default(''),
    encryptedDisplayName: ciphertext('encrypted_display_name'),
    reportTypeId: text('report_type_id')
      .notNull()
      .references(() => reportTypes.id),
    agentPubkey: text('agent_pubkey').notNull(),
    encryptedAgentNsec: text('encrypted_agent_nsec').notNull(),
    geoContext: text('geo_context'),
    geoContextCountryCodes: text('geo_context_country_codes').array(),
    inferenceEndpoint: text('inference_endpoint'),
    extractionIntervalSec: integer('extraction_interval_sec').notNull().default(60),
    systemPromptSuffix: text('system_prompt_suffix'),
    bufferTtlDays: integer('buffer_ttl_days').notNull().default(7),
    notifyViaSignal: boolean('notify_via_signal').notNull().default(true),
    status: firehoseConnectionStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('firehose_connections_hub_idx').on(table.hubId),
    index('firehose_connections_signal_group_idx').on(table.signalGroupId),
  ]
)

export const firehoseMessageBuffer = pgTable(
  'firehose_message_buffer',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => firehoseConnections.id, { onDelete: 'cascade' }),
    signalTimestamp: timestamp('signal_timestamp', { withTimezone: true }).notNull(),
    encryptedContent: text('encrypted_content').notNull(),
    encryptedSenderInfo: text('encrypted_sender_info').notNull(),
    clusterId: text('cluster_id'),
    extractedReportId: text('extracted_report_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('firehose_buffer_connection_idx').on(table.connectionId),
    index('firehose_buffer_expires_idx').on(table.expiresAt),
  ]
)

export const firehoseNotificationOptouts = pgTable(
  'firehose_notification_optouts',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => firehoseConnections.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('firehose_optout_unique').on(table.connectionId, table.userId)]
)
