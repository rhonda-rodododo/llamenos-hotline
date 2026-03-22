import { boolean, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'

export const volunteers = pgTable('volunteers', {
  pubkey: text('pubkey').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  roles: jsonb<string[]>()('roles').notNull().default([]),
  hubRoles: jsonb<Array<{ hubId: string; roleIds: string[] }>>()('hub_roles').notNull().default([]),
  encryptedSecretKey: text('encrypted_secret_key').notNull().default(''),
  active: boolean('active').notNull().default(true),
  transcriptionEnabled: boolean('transcription_enabled').notNull().default(true),
  spokenLanguages: jsonb<string[]>()('spoken_languages').notNull().default([]),
  uiLanguage: text('ui_language').notNull().default('en'),
  profileCompleted: boolean('profile_completed').notNull().default(false),
  onBreak: boolean('on_break').notNull().default(false),
  callPreference: text('call_preference').notNull().default('phone'),
  supportedMessagingChannels: jsonb<string[]>()('supported_messaging_channels'),
  messagingEnabled: boolean('messaging_enabled'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const serverSessions = pgTable('server_sessions', {
  token: text('token').primaryKey(),
  pubkey: text('pubkey').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: text('id').primaryKey(), // base64url credential ID
  pubkey: text('pubkey').notNull(),
  publicKey: text('public_key').notNull(),
  counter: text('counter').notNull().default('0'), // stored as text to avoid bigint issues
  transports: jsonb<string[]>()('transports').notNull().default([]),
  backedUp: boolean('backed_up').notNull().default(false),
  label: text('label').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
})

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: text('id').primaryKey(),
  pubkey: text('pubkey'),
  challenge: text('challenge').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  roleIds: jsonb<string[]>()('role_ids').notNull().default([]),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedBy: text('used_by'),
  recipientPhoneHash: text('recipient_phone_hash'),
  deliveryChannel: varchar('delivery_channel', { length: 16 }),
  deliverySentAt: timestamp('delivery_sent_at', { withTimezone: true }),
})

export const provisionRooms = pgTable('provision_rooms', {
  roomId: text('room_id').primaryKey(),
  ephemeralPubkey: text('ephemeral_pubkey').notNull(),
  token: text('token').notNull(),
  status: text('status').notNull().default('waiting'),
  encryptedNsec: text('encrypted_nsec'),
  primaryPubkey: text('primary_pubkey'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const webauthnSettings = pgTable('webauthn_settings', {
  id: text('id').primaryKey().default('global'),
  requireForAdmins: boolean('require_for_admins').notNull().default(false),
  requireForVolunteers: boolean('require_for_volunteers').notNull().default(false),
})
