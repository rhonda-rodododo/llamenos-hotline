import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'

export const hubs = pgTable('hubs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().default(''),
  description: text('description'),
  status: text('status').notNull().default('active'),
  phoneNumber: text('phone_number'),
  createdBy: text('created_by').notNull().default(''),
  /** Allow super-admin visibility into this hub's data (zero-trust opt-in per hub) */
  allowSuperAdminAccess: boolean('allow_super_admin_access').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const hubKeys = pgTable(
  'hub_keys',
  {
    hubId: text('hub_id').notNull(),
    pubkey: text('pubkey').notNull(),
    /** ECIES-wrapped hub key for this member */
    encryptedKey: text('encrypted_key').notNull(),
    /** Ephemeral pubkey used in ECIES encryption (x-only, hex) */
    ephemeralPubkey: text('ephemeral_pubkey'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.hubId, table.pubkey] })]
)

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  hubId: text('hub_id'), // null = global role
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  permissions: jsonb<string[]>()('permissions').notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: text('id').primaryKey(),
  hubId: text('hub_id'), // null = global
  fieldName: text('field_name').notNull(),
  label: text('label').notNull(),
  fieldType: text('field_type').notNull(), // 'text' | 'select' | 'multiselect' | 'checkbox' | 'date'
  options: jsonb<string[]>()('options').notNull().default([]),
  required: boolean('required').notNull().default(false),
  showInVolunteerView: boolean('show_in_volunteer_view').notNull().default(false),
  /** Context distinguishes where this field appears */
  context: text('context').notNull().default('notes'), // 'notes' | 'conversations' | 'reports' | 'all'
  /** IDs of report types that show this field. Empty array = shown for all types (when context includes 'reports'). */
  reportTypeIds: jsonb<string[]>()('report_type_ids').notNull().default([]),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const telephonyConfig = pgTable('telephony_config', {
  hubId: text('hub_id').primaryKey().default('global'),
  config: jsonb<Record<string, unknown>>()('config').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const messagingConfig = pgTable('messaging_config', {
  hubId: text('hub_id').primaryKey().default('global'),
  config: jsonb<Record<string, unknown>>()('config').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const spamSettings = pgTable('spam_settings', {
  hubId: text('hub_id').primaryKey().default('global'),
  voiceCaptchaEnabled: boolean('voice_captcha_enabled').notNull().default(false),
  rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
  maxCallsPerMinute: integer('max_calls_per_minute').notNull().default(5),
  blockDurationMinutes: integer('block_duration_minutes').notNull().default(60),
})

export const callSettings = pgTable('call_settings', {
  hubId: text('hub_id').primaryKey().default('global'),
  queueTimeoutSeconds: integer('queue_timeout_seconds').notNull().default(90),
  voicemailMaxSeconds: integer('voicemail_max_seconds').notNull().default(120),
})

export const transcriptionSettings = pgTable('transcription_settings', {
  hubId: text('hub_id').primaryKey().default('global'),
  globalEnabled: boolean('global_enabled').notNull().default(false),
  allowVolunteerOptOut: boolean('allow_volunteer_opt_out').notNull().default(true),
})

export const ivrLanguages = pgTable('ivr_languages', {
  hubId: text('hub_id').primaryKey().default('global'),
  languages: jsonb<string[]>()('languages').notNull().default(['en']),
})

export const fallbackGroup = pgTable('fallback_group', {
  hubId: text('hub_id').primaryKey().default('global'),
  volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
})

export const rateLimitCounters = pgTable('rate_limit_counters', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
})

export const ivrAudio = pgTable(
  'ivr_audio',
  {
    hubId: text('hub_id').notNull().default('global'),
    promptType: text('prompt_type').notNull(),
    language: text('language').notNull(),
    audioData: text('audio_data').notNull(), // base64-encoded audio
    mimeType: text('mime_type').notNull().default('audio/mpeg'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.hubId, table.promptType, table.language] })]
)

export const setupState = pgTable('setup_state', {
  hubId: text('hub_id').primaryKey().default('global'),
  state: jsonb<Record<string, unknown>>()('state').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const captchaState = pgTable('captcha_state', {
  callSid: text('call_sid').primaryKey(),
  expectedDigits: text('expected_digits').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const reportCategories = pgTable('report_categories', {
  hubId: text('hub_id').primaryKey().default('global'),
  categories: jsonb<string[]>()('categories').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** GDPR consent records — one row per volunteer per consent version */
export const gdprConsents = pgTable('gdpr_consents', {
  pubkey: text('pubkey').notNull(),
  consentVersion: text('consent_version').notNull().default('1.0'),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
})

/** GDPR erasure requests — scheduled right-to-erasure execution */
export const gdprErasureRequests = pgTable('gdpr_erasure_requests', {
  pubkey: text('pubkey').primaryKey(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  /** Scheduled execution time (typically 30 days from request) */
  executeAt: timestamp('execute_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'executed' | 'cancelled'
})

/** Per-hub GDPR retention settings */
export const retentionSettings = pgTable('retention_settings', {
  hubId: text('hub_id').primaryKey().default('global'),
  /** Retention config as JSONB (callRetentionDays, noteRetentionDays, etc.) */
  settings: jsonb<Record<string, number>>()('settings').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Geocoding configuration (global) */
export const geocodingConfig = pgTable('geocoding_config', {
  id: text('id').primaryKey().default('global'),
  provider: text('provider'), // 'opencage' | 'geoapify' | null
  apiKey: text('api_key').notNull().default(''),
  countries: jsonb<string[]>()('countries').notNull().default([]),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** OAuth state for provider auto-config (TTL-enforced) */
export const oauthState = pgTable('oauth_state', {
  provider: text('provider').primaryKey(), // 'twilio' | 'telnyx'
  state: text('state').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Provider configuration and encrypted credentials */
export const providerConfig = pgTable('provider_config', {
  id: text('id').primaryKey().default('global'),
  provider: text('provider').notNull(),
  connected: boolean('connected').notNull().default(false),
  phoneNumber: text('phone_number'),
  webhooksConfigured: boolean('webhooks_configured').notNull().default(false),
  sipConfigured: boolean('sip_configured').notNull().default(false),
  a2pStatus: text('a2p_status').default('not_started'),
  brandSid: text('brand_sid'),
  campaignSid: text('campaign_sid'),
  messagingServiceSid: text('messaging_service_sid'),
  encryptedCredentials: text('encrypted_credentials'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Signal registration pending state (TTL-enforced) */
export const signalRegistrationPending = pgTable('signal_registration_pending', {
  id: text('id').primaryKey().default('global'),
  number: text('number').notNull(),
  bridgeUrl: text('bridge_url').notNull(),
  method: text('method').notNull(), // 'sms' | 'voice'
  status: text('status').notNull().default('pending'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
