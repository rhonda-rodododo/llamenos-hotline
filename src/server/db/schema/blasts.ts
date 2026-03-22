import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'

export const blasts = pgTable('blasts', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  name: text('name').notNull(),
  channel: text('channel').notNull(), // 'sms' | 'whatsapp' | 'signal'
  content: text('content').notNull().default(''),
  status: text('status').notNull().default('draft'), // 'draft' | 'sending' | 'sent' | 'failed'
  totalCount: integer('total_count').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
})

export const subscribers = pgTable('subscribers', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  phoneNumber: text('phone_number').notNull(),
  channel: text('channel').notNull(),
  active: boolean('active').notNull().default(true),
  token: text('token'), // for preference management links
  metadata: jsonb<Record<string, unknown>>()('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const blastDeliveries = pgTable('blast_deliveries', {
  id: text('id').primaryKey(),
  blastId: text('blast_id').notNull(),
  subscriberId: text('subscriber_id').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'failed'
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
})
