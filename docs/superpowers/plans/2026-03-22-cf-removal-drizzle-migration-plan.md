# CF Removal + Drizzle/Zod Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Cloudflare Workers/DOs/Wrangler from the app stack; replace with Drizzle ORM + Bun SQL + service classes + Zod schemas.

**Architecture:** Seven DO classes become seven service classes receiving a Drizzle Database via constructor injection. All state moves from the KV-shim (kv_store table) to proper relational Drizzle schema tables. Route handlers call services directly instead of through DO HTTP fetch indirection. The src/worker/ directory becomes src/server/.

**Tech Stack:** Bun, Drizzle ORM (drizzle-orm/bun-sql), Zod, Hono, PostgreSQL, drizzle-kit

---

## Background

### Current backend (what we're replacing)

The app has 7 Durable Object classes in `src/worker/durable-objects/`:
- `IdentityDO` — volunteers, sessions, WebAuthn, invites, provisioning rooms
- `SettingsDO` — telephony/messaging config, spam settings, custom fields, hubs, roles, IVR
- `RecordsDO` — audit log, call records, note envelopes, bans
- `ShiftManagerDO` — shift schedules, ring groups, active shifts
- `CallRouterDO` — active calls, call legs, ringing queue
- `ConversationDO` — conversations, message envelopes, assignments
- `BlastDO` — blast campaigns, subscribers, deliveries

On Node.js, DOs are shimmed via `src/platform/node/durable-object.ts` using a `kv_store(namespace, key, value JSONB)` table. Route handlers call `getDOs(c.env)` and then `dos.identity.fetch(new Request('http://do/volunteers'))` — every data access goes through an internal HTTP dispatch layer even on Node.

### What we're building

**Service classes** with constructor injection of a `Database` (Drizzle + Bun SQL). Each service exposes typed async methods. Routes call `c.get('services').identity.listVolunteers()` directly — no HTTP indirection.

**Before pattern** (`src/worker/routes/volunteers.ts`):
```typescript
volunteers.get('/', async (c) => {
  const dos = getDOs(c.env)
  return dos.identity.fetch(new Request('http://do/volunteers'))
})
```

**After pattern** (`src/server/routes/volunteers.ts`):
```typescript
volunteers.get('/', async (c) => {
  const { identity } = c.get('services')
  const volunteers = await identity.listVolunteers()
  return c.json(volunteers)
})
```

### Files being deleted

- `src/worker/durable-objects/` — all 7 DO classes
- `src/worker/lib/do-router.ts` — DORouter dispatcher
- `src/worker/lib/do-access.ts` — getDOs/getScopedDOs/getHubDOs factory
- `src/platform/` — entire directory (node shim, DO shim, postgres pool, alarm poller, startup-migrations, CF types)
- `wrangler.jsonc` — entire Wrangler config
- `esbuild.node.mjs` — Node.js bundle script
- `scripts/dev-tunnel.sh` — CF Tunnel dev script
- `src/shared/migrations/` — DO-era migration runner and SQL files

### Files being renamed

| From | To |
|------|----|
| `src/worker/` | `src/server/` |
| `@worker/*` alias | `@server/*` |
| `src/platform/node/server.ts` | `src/server/server.ts` |
| `src/platform/node/env.ts` | `src/server/env.ts` |
| `src/platform/node/blob-storage.ts` | `src/server/lib/blob-storage.ts` |
| `src/platform/node/transcription.ts` | `src/server/lib/transcription.ts` |
| `src/platform/types.ts` | `src/server/types.ts` |

---

## Phase 1: Drizzle Foundation

**Goal:** Install Drizzle, create DB module, write all schema files. Produces passing typecheck (schemas alone don't affect existing code).

### Steps

- [ ] **1.1 Install dependencies**

  ```bash
  cd ~/projects/llamenos-hotline
  bun add drizzle-orm
  bun add -d drizzle-kit
  ```

  Verify: `bun run typecheck` passes.

- [ ] **1.2 Create `src/server/db/bun-jsonb.ts`**

  Custom JSONB column type for Drizzle + Bun SQL. Bun's native SQL driver serializes objects to JSONB natively — do NOT add `toDriver` (would cause double-serialization):

  ```typescript
  import { customType } from 'drizzle-orm/pg-core'

  export const jsonb = <T>() =>
    customType<{ data: T; driverData: T }>({
      dataType() { return 'jsonb' },
      // No toDriver — Bun SQL handles object → JSONB natively
      fromDriver(value: T): T { return value },
    })
  ```

- [ ] **1.3 Create `src/server/db/index.ts`**

  ```typescript
  import { SQL } from 'bun'
  import { drizzle } from 'drizzle-orm/bun-sql'
  import * as schema from './schema'

  let _db: ReturnType<typeof createDatabase> | null = null

  export function createDatabase(url: string) {
    const client = new SQL({
      url,
      max: parseInt(process.env.PG_POOL_SIZE ?? '10'),
      idleTimeout: parseInt(process.env.PG_IDLE_TIMEOUT ?? '30'),
      connectionTimeout: 30,
    })
    return drizzle({ client, schema })
  }

  export function getDb() {
    if (!_db) throw new Error('Database not initialized — call initDb() first')
    return _db
  }

  export function initDb(url: string) {
    _db = createDatabase(url)
    return _db
  }

  export type Database = ReturnType<typeof createDatabase>
  ```

- [ ] **1.4 Create `src/server/db/schema/identity.ts`**

  Tables: `volunteers`, `server_sessions`, `webauthn_credentials`, `webauthn_challenges`, `invite_codes`, `provision_rooms`

  ```typescript
  import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
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
  ```

- [ ] **1.5 Create `src/server/db/schema/settings.ts`**

  Tables: `hubs`, `hub_keys`, `roles`, `custom_field_definitions`, `telephony_config`, `messaging_config`, `spam_settings`, `call_settings`, `transcription_settings`, `ivr_languages`, `fallback_group`, `rate_limit_counters`, `ivr_audio`, `setup_state`, `captcha_state`, `report_categories`, `oauth_state`, `provider_config`, `geocoding_config`, `signal_registration_pending`

  ```typescript
  import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
  import { jsonb } from '../bun-jsonb'

  export const hubs = pgTable('hubs', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    nostrPubkey: text('nostr_pubkey'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const hubKeys = pgTable('hub_keys', {
    hubId: text('hub_id').notNull(),
    pubkey: text('pubkey').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
  })

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
    fieldType: text('field_type').notNull(), // 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'file' | 'location'
    options: jsonb<string[]>()('options').notNull().default([]),
    required: boolean('required').notNull().default(false),
    showInVolunteerView: boolean('show_in_volunteer_view').notNull().default(false),
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
    captchaMaxAttempts: integer('captcha_max_attempts').notNull().default(2),
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

  export const ivrAudio = pgTable('ivr_audio', {
    hubId: text('hub_id').notNull().default('global'),
    promptType: text('prompt_type').notNull(),
    language: text('language').notNull(),
    audioData: text('audio_data').notNull(), // base64-encoded audio
    mimeType: text('mime_type').notNull().default('audio/mpeg'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const setupState = pgTable('setup_state', {
    hubId: text('hub_id').primaryKey().default('global'),
    state: jsonb<Record<string, unknown>>()('state').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const captchaState = pgTable('captcha_state', {
    callSid: text('call_sid').primaryKey(),
    expectedDigits: text('expected_digits').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  })

  export const reportCategories = pgTable('report_categories', {
    hubId: text('hub_id').primaryKey().default('global'),
    categories: jsonb<string[]>()('categories').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  })

  // --- New tables added 2026-03-22 (post-plan audit) ---

  export const oauthState = pgTable('oauth_state', {
    provider: text('provider').primaryKey(), // 'twilio' | 'telnyx'
    state: text('state').notNull(), // 32-byte hex CSRF token
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const providerConfig = pgTable('provider_config', {
    id: text('id').primaryKey().default('global'),
    provider: text('provider').notNull(), // SupportedProvider
    connected: boolean('connected').notNull().default(false),
    phoneNumber: text('phone_number'),
    webhooksConfigured: boolean('webhooks_configured').notNull().default(false),
    sipConfigured: boolean('sip_configured').notNull().default(false),
    a2pStatus: text('a2p_status').default('not_started'),
    brandSid: text('brand_sid'),
    campaignSid: text('campaign_sid'),
    messagingServiceSid: text('messaging_service_sid'),
    encryptedCredentials: text('encrypted_credentials'), // ECIES-encrypted blob
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const geocodingConfig = pgTable('geocoding_config', {
    id: text('id').primaryKey().default('global'),
    provider: text('provider'), // 'opencage' | 'geoapify' | null
    apiKey: text('api_key').notNull().default(''),
    countries: jsonb<string[]>()('countries').notNull().default([]),
    enabled: boolean('enabled').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const signalRegistrationPending = pgTable('signal_registration_pending', {
    id: text('id').primaryKey().default('global'),
    number: text('number').notNull(),
    bridgeUrl: text('bridge_url').notNull(),
    method: text('method').notNull(), // 'sms' | 'voice'
    status: text('status').notNull().default('pending'), // 'pending' | 'complete' | 'failed'
    error: text('error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })
  ```

- [ ] **1.6 Create `src/server/db/schema/records.ts`**

  Tables: `audit_log`, `call_records`, `note_envelopes`, `bans`

  ```typescript
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
  ```

- [ ] **1.7 Create `src/server/db/schema/shifts.ts`**

  Tables: `shift_schedules`, `shift_overrides`, `ring_groups`, `active_shifts`

  ```typescript
  import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core'
  import { jsonb } from '../bun-jsonb'

  export const shiftSchedules = pgTable('shift_schedules', {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(), // HH:MM
    endTime: text('end_time').notNull(),     // HH:MM
    days: jsonb<number[]>()('days').notNull().default([]), // 0=Sun, 6=Sat
    volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
    ringGroupId: text('ring_group_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const shiftOverrides = pgTable('shift_overrides', {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    scheduleId: text('schedule_id'),
    date: text('date').notNull(), // YYYY-MM-DD
    type: text('type').notNull(), // 'cancel' | 'substitute'
    volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const ringGroups = pgTable('ring_groups', {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    name: text('name').notNull(),
    volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const activeShifts = pgTable(
    'active_shifts',
    {
      pubkey: text('pubkey').notNull(),
      hubId: text('hub_id').notNull().default('global'),
      startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
      ringGroupId: text('ring_group_id'),
    },
    (table) => [primaryKey({ columns: [table.pubkey, table.hubId] })],
  )
  ```

- [ ] **1.8 Create `src/server/db/schema/calls.ts`**

  Tables: `active_calls`, `call_legs`, `call_tokens`

  ```typescript
  import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core'
  import { jsonb } from '../bun-jsonb'

  export const activeCalls = pgTable('active_calls', {
    callSid: text('call_sid').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    callerNumber: text('caller_number').notNull(),
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
  ```

- [ ] **1.9 Create `src/server/db/schema/conversations.ts`**

  Tables: `conversations`, `message_envelopes`

  ```typescript
  import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core'
  import { jsonb } from '../bun-jsonb'
  import type { RecipientEnvelope } from '../../../shared/types'

  export const conversations = pgTable('conversations', {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    channelType: text('channel_type').notNull(), // 'sms' | 'whatsapp' | 'signal' | 'rcs' | 'web'
    contactIdentifierHash: text('contact_identifier_hash').notNull(),
    contactLast4: text('contact_last4'),
    externalId: text('external_id'), // provider's thread/contact ID
    assignedTo: text('assigned_to'), // volunteer pubkey
    status: text('status').notNull().default('active'), // 'active' | 'waiting' | 'closed'
    metadata: jsonb<Record<string, unknown>>()('metadata').notNull().default({}),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  })

  export const messageEnvelopes = pgTable('message_envelopes', {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    direction: text('direction').notNull(), // 'inbound' | 'outbound'
    authorPubkey: text('author_pubkey').notNull(),
    encryptedContent: text('encrypted_content').notNull(),
    readerEnvelopes: jsonb<RecipientEnvelope[]>()('reader_envelopes').notNull().default([]),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    attachmentIds: jsonb<string[]>()('attachment_ids').notNull().default([]),
    externalId: text('external_id'),
    status: text('status').notNull().default('pending'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  })
  ```

- [ ] **1.10 Create `src/server/db/schema/blasts.ts`**

  Tables: `blasts`, `subscribers`, `blast_deliveries`

  ```typescript
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
  ```

- [ ] **1.11 Create `src/server/db/schema/index.ts`**

  ```typescript
  export * from './identity'
  export * from './settings'
  export * from './records'
  export * from './shifts'
  export * from './calls'
  export * from './conversations'
  export * from './blasts'
  ```

- [ ] **1.12 Create `drizzle.config.ts` at repo root**

  ```typescript
  import { defineConfig } from 'drizzle-kit'

  export default defineConfig({
    schema: './src/server/db/schema/index.ts',
    out: './drizzle/migrations',
    dialect: 'postgresql',
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  })
  ```

- [ ] **1.13 Verify typecheck passes**

  ```bash
  bun run typecheck
  ```

  Note: typecheck may still reference `@worker/*` paths — that's fine at this phase. Fix only errors directly caused by new Phase 1 files.

- [ ] **1.14 Commit**

  ```bash
  git add src/server/db/ drizzle.config.ts package.json bun.lock
  git commit -m "feat(db): add Drizzle foundation — Bun SQL driver, schema files, custom JSONB"
  ```

---

## Phase 2: Service Classes

**Goal:** Create 7 service classes plus `AppError`. Each service wraps Drizzle queries — no HTTP dispatch, no `DORouter`. Services are the business logic layer; routes will call them directly after Phase 5.

### Steps

- [ ] **2.1 Create `src/server/lib/errors.ts`**

  ```typescript
  export class AppError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message)
      this.name = 'AppError'
    }
  }
  ```

- [ ] **2.2 Create `src/server/services/identity.ts`**

  Replaces `IdentityDO`. Uses Drizzle queries against the `identity` schema tables. Key methods extracted from `IdentityDO`'s private methods, now as public typed async methods:

  ```typescript
  import { and, eq, gt, lt, sql } from 'drizzle-orm'
  import {
    inviteCodes, provisionRooms, serverSessions,
    volunteers, webauthnChallenges, webauthnCredentials, webauthnSettings,
  } from '../db/schema'
  import type { Database } from '../db'
  import { AppError } from '../lib/errors'
  import type { Volunteer } from '../types'

  export class IdentityService {
    constructor(protected db: Database) {}

    // Volunteers
    async listVolunteers(hubId?: string): Promise<Volunteer[]> { ... }
    async getVolunteer(pubkey: string): Promise<Volunteer> { ... }  // throws AppError(404) if not found
    async createVolunteer(data: CreateVolunteerData): Promise<Volunteer> { ... }
    async updateVolunteer(pubkey: string, data: Partial<Volunteer>, isAdmin?: boolean): Promise<Volunteer> { ... }
    async deleteVolunteer(pubkey: string): Promise<void> { ... }
    async hasAdmin(): Promise<boolean> { ... }
    async bootstrapAdmin(pubkey: string): Promise<Volunteer> { ... }  // throws AppError(403) if admin exists

    // Sessions
    async createSession(pubkey: string): Promise<{ token: string; pubkey: string; expiresAt: string }> { ... }
    async validateSession(token: string): Promise<{ token: string; pubkey: string; expiresAt: string }> { ... }  // throws AppError(401) if invalid/expired, extends sliding expiry
    async revokeSession(token: string): Promise<void> { ... }
    async revokeAllSessions(pubkey: string): Promise<number> { ... }  // returns revoked count

    // Invites
    async listInvites(): Promise<InviteCode[]> { ... }  // only unused invites
    async createInvite(data: CreateInviteData): Promise<InviteCode> { ... }
    async validateInvite(code: string): Promise<{ valid: boolean; error?: string; name?: string; roleIds?: string[] }> { ... }
    async redeemInvite(code: string, pubkey: string): Promise<Volunteer> { ... }  // creates volunteer, marks invite used
    async revokeInvite(code: string): Promise<void> { ... }

    // WebAuthn credentials
    async getWebAuthnCredentials(pubkey: string): Promise<WebAuthnCredential[]> { ... }
    async addWebAuthnCredential(pubkey: string, credential: WebAuthnCredential): Promise<void> { ... }
    async deleteWebAuthnCredential(pubkey: string, credId: string): Promise<void> { ... }
    async updateWebAuthnCounter(pubkey: string, credId: string, counter: number, lastUsedAt: string): Promise<void> { ... }
    async getAllWebAuthnCredentials(): Promise<Array<WebAuthnCredential & { ownerPubkey: string }>> { ... }

    // WebAuthn challenges
    async storeWebAuthnChallenge(id: string, challenge: string): Promise<void> { ... }
    async getWebAuthnChallenge(id: string): Promise<string> { ... }  // deletes on read, throws AppError(404/410) if missing/expired

    // WebAuthn settings
    async getWebAuthnSettings(): Promise<{ requireForAdmins: boolean; requireForVolunteers: boolean }> { ... }
    async updateWebAuthnSettings(data: Partial<{ requireForAdmins: boolean; requireForVolunteers: boolean }>): Promise<{ requireForAdmins: boolean; requireForVolunteers: boolean }> { ... }

    // Provisioning rooms
    async createProvisionRoom(ephemeralPubkey: string): Promise<{ roomId: string; token: string }> { ... }
    async getProvisionRoom(id: string, token: string): Promise<ProvisionRoomStatus> { ... }
    async setProvisionPayload(id: string, token: string, encryptedNsec: string, primaryPubkey: string): Promise<void> { ... }

    // Hub roles
    async setHubRole(pubkey: string, hubId: string, roleIds: string[]): Promise<Volunteer> { ... }
    async removeHubRole(pubkey: string, hubId: string): Promise<Volunteer> { ... }

    // Test / demo
    async resetForTest(): Promise<void> { ... }  // only in demo/dev ENVIRONMENT
  }
  ```

  **Important implementation notes from the DO source:**
  - `validateSession` must implement sliding expiry: extend by 8h if less than 7h remain
  - `redeemInvite` atomically marks invite used AND creates volunteer in a single Drizzle transaction (`db.transaction(async tx => { ... })`)
  - `bootstrapAdmin` must use a transaction to prevent race conditions (same as DO implementation)
  - `getWebAuthnChallenge` deletes the challenge on read (one-shot) and checks 5-minute TTL
  - `getProvisionRoom` deletes the room when payload is consumed

- [ ] **2.3 Create `src/server/services/settings.ts`**

  Replaces `SettingsDO`. Key methods:

  ```typescript
  export class SettingsService {
    constructor(protected db: Database) {}

    // Spam settings
    async getSpamSettings(hubId?: string): Promise<SpamSettings> { ... }
    async updateSpamSettings(hubId: string | undefined, data: Partial<SpamSettings>): Promise<SpamSettings> { ... }

    // Transcription settings
    async getTranscriptionSettings(hubId?: string): Promise<TranscriptionSettings> { ... }
    async updateTranscriptionSettings(hubId: string | undefined, data: Partial<TranscriptionSettings>): Promise<TranscriptionSettings> { ... }

    // Call settings
    async getCallSettings(hubId?: string): Promise<CallSettings> { ... }
    async updateCallSettings(hubId: string | undefined, data: Partial<CallSettings>): Promise<CallSettings> { ... }

    // IVR languages
    async getIvrLanguages(hubId?: string): Promise<string[]> { ... }
    async updateIvrLanguages(hubId: string | undefined, languages: string[]): Promise<string[]> { ... }

    // Custom fields
    async getCustomFields(hubId?: string, role?: string): Promise<CustomFieldDefinition[]> { ... }
    async updateCustomFields(hubId: string | undefined, fields: CustomFieldDefinition[]): Promise<CustomFieldDefinition[]> { ... }

    // Telephony provider
    async getTelephonyConfig(hubId?: string): Promise<TelephonyProviderConfig | null> { ... }
    async setTelephonyConfig(hubId: string | undefined, config: TelephonyProviderConfig): Promise<void> { ... }
    async deleteTelephonyConfig(hubId?: string): Promise<void> { ... }

    // Messaging config
    async getMessagingConfig(hubId?: string): Promise<MessagingConfig | null> { ... }
    async setMessagingConfig(hubId: string | undefined, config: MessagingConfig): Promise<void> { ... }

    // IVR audio
    async listIvrAudio(hubId?: string): Promise<IvrAudioEntry[]> { ... }
    async uploadIvrAudio(hubId: string | undefined, promptType: string, language: string, data: ArrayBuffer, mimeType: string): Promise<void> { ... }
    async getIvrAudio(hubId: string | undefined, promptType: string, language: string): Promise<{ data: string; mimeType: string } | null> { ... }
    async deleteIvrAudio(hubId: string | undefined, promptType: string, language: string): Promise<void> { ... }

    // Hubs
    async listHubs(): Promise<Hub[]> { ... }
    async getHub(hubId: string): Promise<Hub | null> { ... }
    async createHub(data: CreateHubData): Promise<Hub> { ... }
    async updateHub(hubId: string, data: Partial<Hub>): Promise<Hub> { ... }
    async deleteHub(hubId: string): Promise<void> { ... }

    // Hub keys
    async getHubKey(hubId: string, pubkey: string): Promise<string | null> { ... }
    async setHubKey(hubId: string, pubkey: string, encryptedKey: string): Promise<void> { ... }
    async listHubKeys(hubId: string): Promise<HubKeyEntry[]> { ... }
    async deleteHubKey(hubId: string, pubkey: string): Promise<void> { ... }

    // Roles
    async listRoles(hubId?: string): Promise<Role[]> { ... }  // global + hub-specific, initializes DEFAULT_ROLES if empty
    async getRole(roleId: string): Promise<Role | null> { ... }
    async createRole(data: CreateRoleData): Promise<Role> { ... }
    async updateRole(roleId: string, data: Partial<Role>): Promise<Role> { ... }
    async deleteRole(roleId: string): Promise<void> { ... }

    // Fallback group
    async getFallbackGroup(hubId?: string): Promise<string[]> { ... }
    async setFallbackGroup(hubId: string | undefined, pubkeys: string[]): Promise<void> { ... }

    // Rate limiting (used in auth routes)
    async checkRateLimit(key: string, maxPerMinute: number): Promise<boolean> { ... }  // returns true if rate limited

    // Setup state
    async getSetupState(hubId?: string): Promise<SetupState> { ... }
    async updateSetupState(hubId: string | undefined, data: Partial<SetupState>): Promise<SetupState> { ... }

    // CAPTCHA (voice bot detection)
    async storeCaptcha(callSid: string, digits: string): Promise<void> { ... }
    async verifyCaptcha(callSid: string, input: string): Promise<boolean> { ... }

    // Enabled channels (computed from messaging config)
    async getEnabledChannels(hubId?: string): Promise<EnabledChannels> { ... }

    // Report categories
    async getReportCategories(hubId?: string): Promise<string[]> { ... }
    async updateReportCategories(hubId: string | undefined, categories: string[]): Promise<void> { ... }

    // Hub by phone (inbound call routing)
    async getHubByPhone(phone: string): Promise<Hub | null> { ... }

    // Per-hub settings (merged config object for hub-scoped settings)
    async getHubSettings(hubId: string): Promise<Record<string, unknown>> { ... }
    async updateHubSettings(hubId: string, data: Record<string, unknown>): Promise<void> { ... }
  }
  ```

  **Important:** `listRoles` must seed `DEFAULT_ROLES` (from `src/shared/permissions.ts`) on first call if the roles table is empty — matches what the DO does in its initializer.

- [ ] **2.4 Create `src/server/services/records.ts`**

  Replaces `RecordsDO`. Also absorbs `src/worker/services/audit.ts`:

  ```typescript
  export class RecordsService {
    constructor(protected db: Database) {}

    // Bans
    async listBans(hubId?: string): Promise<BanEntry[]> { ... }
    async addBan(hubId: string | undefined, data: { phone: string; reason: string; bannedBy: string }): Promise<BanEntry> { ... }
    async removeBan(id: string): Promise<void> { ... }
    async isBanned(hubId: string | undefined, phone: string): Promise<boolean> { ... }

    // Call records
    async listCallRecords(hubId?: string, filters?: CallRecordFilters): Promise<EncryptedCallRecord[]> { ... }
    async createCallRecord(data: CreateCallRecordData): Promise<EncryptedCallRecord> { ... }
    async getCallRecord(id: string): Promise<EncryptedCallRecord | null> { ... }
    async updateCallRecord(id: string, data: Partial<EncryptedCallRecord>): Promise<void> { ... }

    // Notes
    async listNotes(hubId?: string, filters?: NoteFilters): Promise<EncryptedNote[]> { ... }
    async createNote(data: CreateNoteData): Promise<EncryptedNote> { ... }
    async getNote(id: string): Promise<EncryptedNote | null> { ... }
    async updateNote(id: string, data: Partial<EncryptedNote>): Promise<EncryptedNote> { ... }
    async deleteNote(id: string): Promise<void> { ... }

    // Audit log (absorbs audit.ts)
    async addAuditEntry(
      hubId: string | undefined,
      event: string,
      actorPubkey: string,
      details?: Record<string, unknown>
    ): Promise<AuditLogEntry> { ... }  // auto-computes SHA-256 hash chain
    async listAuditLog(hubId?: string, filters?: AuditFilters): Promise<AuditLogEntry[]> { ... }
  }
  ```

  **Important:** `addAuditEntry` must compute the SHA-256 hash chain: fetch the latest entry's `entryHash`, set `previousEntryHash`, then compute `entryHash` as SHA-256 of `(event + actorPubkey + JSON.stringify(details) + previousEntryHash + createdAt)`. Use `@noble/hashes/sha256.js`.

- [ ] **2.5 Create `src/server/services/shifts.ts`**

  Replaces `ShiftManagerDO`:

  ```typescript
  export class ShiftService {
    constructor(protected db: Database) {}

    // Schedules
    async listSchedules(hubId?: string): Promise<ShiftSchedule[]> { ... }
    async createSchedule(data: CreateScheduleData): Promise<ShiftSchedule> { ... }
    async updateSchedule(id: string, data: Partial<ShiftSchedule>): Promise<ShiftSchedule> { ... }
    async deleteSchedule(id: string): Promise<void> { ... }

    // Ring groups
    async listRingGroups(hubId?: string): Promise<RingGroup[]> { ... }
    async getRingGroup(id: string): Promise<RingGroup | null> { ... }
    async createRingGroup(data: CreateRingGroupData): Promise<RingGroup> { ... }
    async updateRingGroup(id: string, data: Partial<RingGroup>): Promise<RingGroup> { ... }
    async deleteRingGroup(id: string): Promise<void> { ... }

    // Active shifts
    async startShift(pubkey: string, hubId: string | undefined, ringGroupId?: string): Promise<void> { ... }
    async endShift(pubkey: string, hubId: string | undefined): Promise<void> { ... }
    async getActiveShifts(hubId?: string): Promise<ActiveShift[]> { ... }
    async isOnShift(pubkey: string, hubId?: string): Promise<boolean> { ... }
    async getCurrentVolunteers(hubId?: string): Promise<string[]> { ... }  // returns pubkeys of on-shift, non-break volunteers

    // Overrides
    async listOverrides(hubId?: string): Promise<ShiftOverride[]> { ... }
    async createOverride(data: CreateOverrideData): Promise<ShiftOverride> { ... }
    async deleteOverride(id: string): Promise<void> { ... }

    // Combined current status (used by ringing)
    async getEffectiveVolunteers(hubId?: string): Promise<string[]> { ... }  // schedules + overrides + active shifts combined
  }
  ```

- [ ] **2.6 Create `src/server/services/calls.ts`**

  Replaces `CallRouterDO`:

  ```typescript
  export class CallService {
    constructor(protected db: Database) {}

    // Active calls
    async listActiveCalls(hubId?: string): Promise<ActiveCall[]> { ... }
    async getActiveCall(callSid: string): Promise<ActiveCall | null> { ... }
    async createActiveCall(data: CreateActiveCallData): Promise<ActiveCall> { ... }
    async updateActiveCall(callSid: string, data: Partial<ActiveCall>): Promise<ActiveCall> { ... }
    async endActiveCall(callSid: string): Promise<void> { ... }

    // Call legs (parallel ringing tracking)
    async createCallLeg(data: CreateCallLegData): Promise<CallLeg> { ... }
    async updateCallLeg(legSid: string, data: Partial<CallLeg>): Promise<void> { ... }
    async getCallLegs(callSid: string): Promise<CallLeg[]> { ... }
    async cleanupLegs(callSid: string): Promise<void> { ... }

    // Call tokens (WebRTC/browser)
    async createCallToken(data: CreateCallTokenData): Promise<string> { ... }  // returns token
    async validateCallToken(token: string): Promise<CallTokenPayload> { ... }  // throws AppError(401) if invalid/expired
    async revokeCallToken(token: string): Promise<void> { ... }

    // Ban checking proxy (delegates to records)
    async isBanned(hubId: string | undefined, phone: string, recordsService: RecordsService): Promise<boolean> { ... }
  }
  ```

- [ ] **2.7 Create `src/server/services/conversations.ts`**

  Replaces `ConversationDO`:

  ```typescript
  export class ConversationService {
    constructor(protected db: Database) {}

    async listConversations(hubId?: string, filters?: ConversationFilters): Promise<Conversation[]> { ... }
    async getConversation(id: string): Promise<Conversation | null> { ... }
    async createConversation(data: CreateConversationData): Promise<Conversation> { ... }
    async updateConversation(id: string, data: Partial<Conversation>): Promise<Conversation> { ... }
    async assignConversation(id: string, pubkey: string): Promise<Conversation> { ... }
    async findByExternalId(hubId: string | undefined, channel: string, externalId: string): Promise<Conversation | null> { ... }

    async listMessages(conversationId: string): Promise<EncryptedMessage[]> { ... }
    async addMessage(data: CreateMessageData): Promise<EncryptedMessage> { ... }
    async updateMessage(id: string, data: Partial<EncryptedMessage>): Promise<void> { ... }
    async getMessageByExternalId(externalId: string): Promise<EncryptedMessage | null> { ... }
  }
  ```

- [ ] **2.8 Create `src/server/services/blasts.ts`**

  Replaces `BlastDO`:

  ```typescript
  export class BlastService {
    constructor(protected db: Database) {}

    async listBlasts(hubId?: string): Promise<Blast[]> { ... }
    async getBlast(id: string): Promise<Blast | null> { ... }
    async createBlast(data: CreateBlastData): Promise<Blast> { ... }
    async updateBlast(id: string, data: Partial<Blast>): Promise<Blast> { ... }

    async listSubscribers(hubId?: string, channel?: string): Promise<Subscriber[]> { ... }
    async getSubscriber(id: string): Promise<Subscriber | null> { ... }
    async addSubscriber(data: CreateSubscriberData): Promise<Subscriber> { ... }
    async removeSubscriber(id: string): Promise<void> { ... }
    async isSubscribed(hubId: string | undefined, phone: string, channel: string): Promise<boolean> { ... }
    async findSubscriberByToken(token: string): Promise<Subscriber | null> { ... }
    async updateSubscriberPreferences(token: string, active: boolean): Promise<void> { ... }

    async recordDelivery(data: CreateDeliveryData): Promise<void> { ... }
    async listDeliveries(blastId: string): Promise<BlastDelivery[]> { ... }
  }
  ```

- [ ] **2.9 Create `src/server/services/index.ts`**

  ```typescript
  import type { Database } from '../db'
  import { IdentityService } from './identity'
  import { SettingsService } from './settings'
  import { RecordsService } from './records'
  import { ShiftService } from './shifts'
  import { CallService } from './calls'
  import { ConversationService } from './conversations'
  import { BlastService } from './blasts'

  export type { IdentityService, SettingsService, RecordsService, ShiftService, CallService, ConversationService, BlastService }

  export interface Services {
    identity: IdentityService
    settings: SettingsService
    records: RecordsService
    shifts: ShiftService
    calls: CallService
    conversations: ConversationService
    blasts: BlastService
  }

  export function createServices(db: Database): Services {
    return {
      identity: new IdentityService(db),
      settings: new SettingsService(db),
      records: new RecordsService(db),
      shifts: new ShiftService(db),
      calls: new CallService(db),
      conversations: new ConversationService(db),
      blasts: new BlastService(db),
    }
  }
  ```

- [ ] **2.10 Verify typecheck passes**

  ```bash
  bun run typecheck
  ```

  Service files will import from `../db/schema` and `../lib/errors` — fix any import path issues. Use `drizzle-orm`'s `eq`, `and`, `desc`, `asc`, `gt`, `lt`, `gte`, `lte`, `isNull`, `isNotNull`, `inArray`, `count`, `sql` as needed.

- [ ] **2.11 Commit**

  ```bash
  git add src/server/services/ src/server/lib/errors.ts
  git commit -m "feat(services): add 7 service classes replacing Durable Objects"
  ```

---

## Phase 3: Zod Schemas

**Goal:** Create shared Zod schemas for all domains. These are used for request validation (via Hono `zValidator`) and as the canonical wire-format types shared between client and server.

### Steps

- [ ] **3.1 Install Zod**

  ```bash
  bun add zod
  ```

- [ ] **3.2 Create `src/shared/schemas/volunteers.ts`**

  ```typescript
  import { z } from 'zod'

  export const VolunteerSchema = z.object({
    pubkey: z.string(),
    name: z.string(),
    phone: z.string().optional(),
    roles: z.array(z.string()),
    hubRoles: z.array(z.object({ hubId: z.string(), roleIds: z.array(z.string()) })).optional(),
    active: z.boolean(),
    transcriptionEnabled: z.boolean(),
    spokenLanguages: z.array(z.string()),
    uiLanguage: z.string(),
    profileCompleted: z.boolean(),
    onBreak: z.boolean(),
    callPreference: z.enum(['phone', 'browser', 'both']),
    supportedMessagingChannels: z.array(z.string()).optional(),
    messagingEnabled: z.boolean().optional(),
    createdAt: z.string().datetime(),
  })
  export type Volunteer = z.infer<typeof VolunteerSchema>

  export const CreateVolunteerSchema = z.object({
    pubkey: z.string().length(64),
    name: z.string().min(1).max(100),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal('')),
    roleIds: z.array(z.string()).default(['role-volunteer']),
    encryptedSecretKey: z.string().optional().default(''),
  })
  export type CreateVolunteerInput = z.infer<typeof CreateVolunteerSchema>

  export const UpdateVolunteerSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal('')),
    roles: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    transcriptionEnabled: z.boolean().optional(),
    spokenLanguages: z.array(z.string()).optional(),
    uiLanguage: z.string().optional(),
    profileCompleted: z.boolean().optional(),
    onBreak: z.boolean().optional(),
    callPreference: z.enum(['phone', 'browser', 'both']).optional(),
    supportedMessagingChannels: z.array(z.string()).optional(),
    messagingEnabled: z.boolean().optional(),
  })
  export type UpdateVolunteerInput = z.infer<typeof UpdateVolunteerSchema>

  export const InviteCodeSchema = z.object({
    code: z.string(),
    name: z.string(),
    phone: z.string(),
    roleIds: z.array(z.string()),
    createdBy: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    usedAt: z.string().datetime().optional(),
    usedBy: z.string().optional(),
  })
  export type InviteCode = z.infer<typeof InviteCodeSchema>

  export const CreateInviteSchema = z.object({
    name: z.string().min(1).max(100),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal('')),
    roleIds: z.array(z.string()).default(['role-volunteer']),
  })
  export type CreateInviteInput = z.infer<typeof CreateInviteSchema>

  export const ServerSessionSchema = z.object({
    token: z.string(),
    pubkey: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  export type ServerSession = z.infer<typeof ServerSessionSchema>
  ```

- [ ] **3.3 Create `src/shared/schemas/settings.ts`**

  Schemas for: `HubSchema`, `RoleSchema`, `CustomFieldDefinitionSchema`, `SpamSettingsSchema`, `CallSettingsSchema`, `TranscriptionSettingsSchema`, input variants for each.

- [ ] **3.4 Create `src/shared/schemas/records.ts`**

  Schemas for: `BanEntrySchema`, `AuditLogEntrySchema`, `EncryptedNoteSchema`, `EncryptedCallRecordSchema`, input variants.

- [ ] **3.5 Create `src/shared/schemas/shifts.ts`**

  Schemas for: `ShiftScheduleSchema`, `RingGroupSchema`, `ActiveShiftSchema`, input variants.

- [ ] **3.6 Create `src/shared/schemas/calls.ts`**

  Schemas for: `ActiveCallSchema`, `CallLegSchema`, input variants.

- [ ] **3.7 Create `src/shared/schemas/conversations.ts`**

  Schemas for: `ConversationSchema`, `EncryptedMessageSchema`, input variants.

- [ ] **3.8 Create `src/shared/schemas/blasts.ts`**

  Schemas for: `BlastSchema`, `SubscriberSchema`, `BlastDeliverySchema`, input variants.

- [ ] **3.9 Create `src/shared/schemas/index.ts`**

  ```typescript
  export * from './volunteers'
  export * from './settings'
  export * from './records'
  export * from './shifts'
  export * from './calls'
  export * from './conversations'
  export * from './blasts'
  ```

- [ ] **3.10 Create `src/server/middleware/error.ts`**

  ```typescript
  import type { Context } from 'hono'
  import { AppError } from '../lib/errors'

  export const errorHandler = (err: Error, c: Context) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 409 | 429 | 500)
    }
    console.error('[server] Unhandled error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
  ```

- [ ] **3.11 Verify typecheck passes**

  ```bash
  bun run typecheck
  ```

- [ ] **3.12 Commit**

  ```bash
  git add src/shared/schemas/ src/server/middleware/error.ts package.json bun.lock
  git commit -m "feat(schemas): add Zod schemas and types for all domains"
  ```

---

## Phase 4: Server Wiring + Adapter Factories

**Goal:** Wire Drizzle DB + services into the Hono app at startup. Create adapter factories that use services instead of DO stubs. Migrate the three existing `src/worker/services/` files.

### Steps

- [ ] **4.1 Create `src/server/lib/adapters.ts`**

  Replaces the adapter factory functions in `src/worker/lib/do-access.ts`. These are the three non-DO factory functions: `getTelephony`, `getMessagingAdapter`, `getNostrPublisher`.

  ```typescript
  import type { MessagingChannelType, TelephonyProviderConfig } from '@shared/types'
  import { createRCSAdapter } from '../messaging/rcs/factory'
  import { createSignalAdapter } from '../messaging/signal/factory'
  import { createSMSAdapter } from '../messaging/sms/factory'
  import { createWhatsAppAdapter } from '../messaging/whatsapp/factory'
  import type { TelephonyAdapter } from '../telephony/adapter'
  import { AsteriskAdapter } from '../telephony/asterisk'
  import { PlivoAdapter } from '../telephony/plivo'
  import { SignalWireAdapter } from '../telephony/signalwire'
  import { TwilioAdapter } from '../telephony/twilio'
  import { VonageAdapter } from '../telephony/vonage'
  import type { SettingsService } from '../services/settings'
  import { createNostrPublisher } from './nostr-publisher'
  import type { NostrPublisher } from './nostr-publisher'

  let cachedPublisher: NostrPublisher | null = null

  export async function getTelephony(
    settings: SettingsService,
    hubId?: string,
    env?: { TWILIO_ACCOUNT_SID?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_PHONE_NUMBER?: string }
  ): Promise<TelephonyAdapter | null> {
    const config = await settings.getTelephonyConfig(hubId)
    if (config) return createAdapterFromConfig(config)
    // Fallback to env vars
    if (env?.TWILIO_ACCOUNT_SID && env?.TWILIO_AUTH_TOKEN && env?.TWILIO_PHONE_NUMBER) {
      return new TwilioAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
    }
    return null
  }

  export async function getMessagingAdapter(
    channel: MessagingChannelType,
    settings: SettingsService,
    hmacSecret: string,
    hubId?: string
  ): Promise<MessagingAdapter> {
    const config = await settings.getMessagingConfig(hubId)
    if (!config || !config.enabledChannels.includes(channel)) {
      throw new Error(`${channel} channel is not enabled`)
    }
    switch (channel) {
      case 'sms': {
        const telConfig = await settings.getTelephonyConfig(hubId)
        if (!telConfig) throw new Error('SMS requires a configured telephony provider')
        return createSMSAdapter(telConfig, config.sms!, hmacSecret)
      }
      case 'whatsapp':
        return createWhatsAppAdapter(config.whatsapp!, hmacSecret)
      case 'signal':
        return createSignalAdapter(config.signal!, hmacSecret)
      case 'rcs':
        return createRCSAdapter(config.rcs!, hmacSecret)
      default:
        throw new Error(`Unknown channel: ${channel}`)
    }
  }

  export function getNostrPublisher(env: { SERVER_NOSTR_SECRET?: string; NOSTR_RELAY_URL?: string }): NostrPublisher {
    if (!cachedPublisher) {
      // CFNostrPublisher is deleted — only NodeNostrPublisher remains
      cachedPublisher = createNostrPublisher(env as any)
    }
    return cachedPublisher
  }

  function createAdapterFromConfig(config: TelephonyProviderConfig): TelephonyAdapter {
    // Same switch as before — copy from do-access.ts
    switch (config.type) { ... }
  }
  ```

- [ ] **4.2 Migrate `src/worker/services/ringing.ts` → `src/server/lib/ringing.ts`**

  Replace all DO fetch calls with direct service method calls. The signature changes from `(callSid, callerNumber, origin, env, dos, hubId?)` to `(callSid, callerNumber, origin, env, services, hubId?)`.

  **Before:**
  ```typescript
  const shiftRes = await dos.shifts.fetch(new Request('http://do/current-volunteers'))
  const { volunteers: onShiftPubkeys } = await shiftRes.json()
  const fallbackRes = await dos.settings.fetch(new Request('http://do/fallback'))
  const volRes = await dos.identity.fetch(new Request('http://do/volunteers'))
  ```

  **After:**
  ```typescript
  const onShiftPubkeys = await services.shifts.getCurrentVolunteers(hubId)
  // fallback: if empty, services.settings.getFallbackGroup(hubId)
  const allVolunteers = await services.identity.listVolunteers()
  ```

  Update all other DO fetch calls in this file similarly.

- [ ] **4.3 Migrate `src/worker/services/transcription.ts` → `src/server/lib/transcription-manager.ts`**

  Replace DO fetch calls for settings/identity with service params. The constructor or function signature gains `settings: SettingsService` and `identity: IdentityService`.

- [ ] **4.4 Create `src/server/middleware/services.ts`**

  Middleware that injects the singleton Services into context:

  ```typescript
  import type { MiddlewareHandler } from 'hono'
  import type { AppEnv } from '../types'
  import type { Services } from '../services'

  export function servicesMiddleware(services: Services): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      c.set('services', services)
      await next()
    }
  }
  ```

- [ ] **4.5 Rewrite `src/platform/node/server.ts` in-place**

  This file will be renamed later (Phase 6). For now, replace its contents to use Drizzle + services instead of the DO shim:

  ```typescript
  import path from 'node:path'
  import { serve } from '@hono/node-server'
  import { serveStatic } from '@hono/node-server/serve-static'
  import { migrate } from 'drizzle-orm/bun-sql/migrator'
  import { Hono } from 'hono'
  import { initDb } from '../../server/db'
  import { createServices } from '../../server/services'
  import { servicesMiddleware } from '../../server/middleware/services'
  import { loadEnv } from './env'

  async function main() {
    console.log('[llamenos] Starting server...')

    const env = loadEnv()  // simple env loader (step 4.6)

    const db = initDb(env.DATABASE_URL)
    await migrate(db, { migrationsFolder: './drizzle/migrations' })
    console.log('[llamenos] Migrations applied')

    const services = createServices(db)

    const { default: workerApp } = await import('../../worker/app')
    const app = new Hono()

    app.use('*', async (c, next) => {
      (c as any).env = env
      await next()
    })
    app.use('*', servicesMiddleware(services))
    app.route('/', workerApp as any)

    const staticDir = path.resolve(process.cwd(), 'dist', 'client')
    app.use('*', serveStatic({ root: staticDir }))
    app.use('*', serveStatic({ root: staticDir, path: '/index.html' }))

    const port = parseInt(process.env.PORT ?? '3000')
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[llamenos] Server running at http://localhost:${info.port}`)
    })

    const shutdown = async () => {
      console.log('[llamenos] Shutting down...')
      try { getNostrPublisher(env as any).close() } catch {}
      server.close(() => { process.exit(0) })
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }

  main().catch((err) => { console.error('[llamenos] Failed to start:', err); process.exit(1) })
  ```

- [ ] **4.6 Rewrite `src/platform/node/env.ts` in-place**

  Replace the DO-shim env builder with a simple env loader that returns plain strings/objects. Remove all DO namespace creation, postgres pool, alarm poller, startup migrations imports. Retain `readSecret` logic and all env vars (ADMIN_PUBKEY, HMAC_SECRET, TWILIO_*, NOSTR_*, etc.) plus add `DATABASE_URL`. Import `createBlobStorage` and `createTranscriptionService` from their platform files (those remain until Phase 7).

  ```typescript
  import fs from 'node:fs'
  import { createBlobStorage } from './blob-storage'
  import { createTranscriptionService } from './transcription'

  function readSecret(name: string, envKey?: string): string { ... }

  export function loadEnv() {
    return {
      DATABASE_URL: readSecret('database-url', 'DATABASE_URL') || process.env.DATABASE_URL || '',
      ADMIN_PUBKEY: readSecret('admin-pubkey', 'ADMIN_PUBKEY'),
      ADMIN_DECRYPTION_PUBKEY: process.env.ADMIN_DECRYPTION_PUBKEY || undefined,
      HMAC_SECRET: readSecret('hmac-secret', 'HMAC_SECRET'),
      HOTLINE_NAME: process.env.HOTLINE_NAME || 'Hotline',
      ENVIRONMENT: process.env.ENVIRONMENT || 'production',
      TWILIO_ACCOUNT_SID: readSecret('twilio-account-sid', 'TWILIO_ACCOUNT_SID'),
      TWILIO_AUTH_TOKEN: readSecret('twilio-auth-token', 'TWILIO_AUTH_TOKEN'),
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
      DEMO_MODE: process.env.DEMO_MODE || undefined,
      DEV_RESET_SECRET: process.env.DEV_RESET_SECRET || undefined,
      SERVER_NOSTR_SECRET: readSecret('server-nostr-secret', 'SERVER_NOSTR_SECRET') || undefined,
      NOSTR_RELAY_URL: process.env.NOSTR_RELAY_URL || undefined,
      NOSTR_RELAY_PUBLIC_URL: process.env.NOSTR_RELAY_PUBLIC_URL || undefined,
      ASSETS: null,
      AI: createTranscriptionService(),
      R2_BUCKET: createBlobStorage(),
    }
  }
  ```

  Note: `createNodeEnv()` is renamed to `loadEnv()` (now synchronous — no async DO initialization needed).

- [ ] **4.7 Update `src/worker/types.ts`**

  Add `services: Services` to `AppEnv.Variables`. Remove `DOStub`, `DONamespace` interfaces and all 7 DO bindings from `Env`. Keep all plain env var fields. Remove `NOSFLARE` binding (CF-only).

  ```typescript
  import type { Services } from './services'  // will be ../server/services after rename

  export type AppEnv = {
    Bindings: Env
    Variables: {
      pubkey: string
      volunteer: Volunteer
      permissions: string[]
      allRoles: import('../shared/permissions').Role[]
      hubId?: string
      hubPermissions?: string[]
      services: Services  // ADD THIS
    }
  }
  ```

  Remove from `Env`:
  - `CALL_ROUTER: DONamespace`
  - `SHIFT_MANAGER: DONamespace`
  - `IDENTITY_DO: DONamespace`
  - `SETTINGS_DO: DONamespace`
  - `RECORDS_DO: DONamespace`
  - `CONVERSATION_DO: DONamespace`
  - `BLAST_DO: DONamespace`
  - `NOSFLARE?: ...`

  Remove `DOStub` and `DONamespace` interface definitions.

- [ ] **4.8 Update `src/worker/app.ts`**

  Remove the inline `getDOs(c.env)` calls for the two messaging preference handlers (lines 63–90) and the IVR audio handler (lines 93–102) — replace with `c.get('services')` calls. Register `errorHandler` from `src/server/middleware/error.ts`. Remove the ASSETS conditional block (now handled by server.ts serveStatic).

- [ ] **4.9 Verify typecheck passes**

  ```bash
  bun run typecheck
  ```

- [ ] **4.10 Commit**

  ```bash
  git add src/server/ src/platform/node/ src/worker/types.ts src/worker/app.ts
  git commit -m "feat(wiring): wire Drizzle db + services into Hono app at startup"
  ```

---

## Phase 5: Route Migration

**Goal:** Migrate all route handlers from the `getDOs(c.env)` pattern to `c.get('services')`. Each route group is a separate commit. Also migrate auth/hub middleware.

**Pattern for every route:** Replace `getDOs(c.env)` → `c.get('services')`, then replace every `dos.X.fetch(new Request('http://do/...', ...))` call with the appropriate service method call.

**Audit calls:** Replace `await audit(dos.records, event, pubkey, details)` → `await c.get('services').records.addAuditEntry(hubId, event, pubkey, details)`.

### Steps

- [ ] **5.1 Migrate middleware: `src/worker/middleware/auth.ts` and `src/worker/middleware/hub.ts`**

  `auth.ts` uses `getDOs(c.env).identity.fetch(...)` to validate sessions and load volunteer data.
  **After:** `c.get('services').identity.validateSession(token)` and `c.get('services').identity.getVolunteer(pubkey)`.

  Also load all roles via `c.get('services').settings.listRoles()`.

  `hub.ts` uses `getDOs(c.env).settings.fetch(...)` to load hub.
  **After:** `c.get('services').settings.getHub(hubId)`.

  Verify: `bun run typecheck`

- [ ] **5.2 Migrate auth + webauthn routes**

  Files: `src/worker/routes/auth.ts`, `src/worker/routes/webauthn.ts`

  **auth.ts key changes:**
  - `POST /login`: `dos.identity.fetch('/volunteer/:pubkey')` → `services.identity.getVolunteer(pubkey)`
  - `POST /bootstrap`: `dos.identity.fetch('/has-admin')` + `dos.identity.fetch('/bootstrap')` → `services.identity.hasAdmin()` + `services.identity.bootstrapAdmin(pubkey)`
  - `GET /me`: `dos.identity.fetch('/webauthn/credentials?pubkey=...')` → `services.identity.getWebAuthnCredentials(pubkey)`, `dos.identity.fetch('/settings/webauthn')` → `services.identity.getWebAuthnSettings()`
  - `POST /me/logout`: `dos.identity.fetch('/sessions/revoke/...')` → `services.identity.revokeSession(token)`
  - `PATCH /me/profile`: `dos.identity.fetch('/volunteers/...')` → `services.identity.updateVolunteer(pubkey, body)`
  - `PATCH /me/availability`: same pattern
  - `PATCH /me/transcription`: check opt-out via `services.settings.getTranscriptionSettings()`, then `services.identity.updateVolunteer()`
  - Rate limiting: `checkRateLimit(dos.settings, key, max)` → `services.settings.checkRateLimit(key, max)`

  Commit: `feat(routes): migrate auth + webauthn routes to service layer`

- [ ] **5.3 Migrate volunteers + invites routes**

  Files: `src/worker/routes/volunteers.ts`, `src/worker/routes/invites.ts`

  **volunteers.ts key changes:**
  - `GET /`: `dos.identity.fetch('/volunteers')` → `services.identity.listVolunteers(hubId)`
  - `POST /`: `dos.identity.fetch('/volunteers', POST, body)` → `services.identity.createVolunteer(body)`, then `services.records.addAuditEntry(...)`
  - `PATCH /:pubkey`: `dos.identity.fetch('/admin/volunteers/:pubkey', PATCH)` → `services.identity.updateVolunteer(pubkey, body, true)`, if deactivated/roles changed → `services.identity.revokeAllSessions(pubkey)`
  - `DELETE /:pubkey`: `dos.identity.fetch('/sessions/revoke-all/:pubkey')` + `dos.identity.fetch('/volunteers/:pubkey', DELETE)` → `services.identity.revokeAllSessions(pubkey)` + `services.identity.deleteVolunteer(pubkey)`

  Commit: `feat(routes): migrate volunteers + invites routes to service layer`

- [ ] **5.4 Migrate shifts routes**

  File: `src/worker/routes/shifts.ts`

  Replace all `dos.shifts.fetch(...)` calls with `services.shifts.*` method calls.

  Commit: `feat(routes): migrate shifts routes to service layer`

- [ ] **5.5 Migrate bans + notes + audit routes**

  Files: `src/worker/routes/bans.ts`, `src/worker/routes/notes.ts`, `src/worker/routes/audit.ts`

  Replace `dos.records.fetch(...)` → `services.records.*`, `dos.settings.fetch(...)` → `services.settings.*`.

  Commit: `feat(routes): migrate bans, notes, audit routes to service layer`

- [ ] **5.6 Migrate calls + telephony + webrtc routes**

  Files: `src/worker/routes/calls.ts`, `src/worker/routes/telephony.ts`, `src/worker/routes/webrtc.ts`

  - `getTelephony(env, dos)` → `getTelephony(services.settings, hubId, env)` (from new adapters.ts)
  - `dos.calls.fetch(...)` → `services.calls.*`
  - `dos.shifts.fetch(...)` → `services.shifts.*`
  - `startParallelRinging(callSid, callerNumber, origin, env, dos, hubId)` → `startParallelRinging(callSid, callerNumber, origin, env, services, hubId)` (ringing.ts updated in Phase 4)

  Commit: `feat(routes): migrate calls, telephony, webrtc routes to service layer`

- [ ] **5.7 Migrate conversations + messaging router**

  Files: `src/worker/routes/conversations.ts`, `src/worker/messaging/router.ts`

  - `getScopedDOs(env, hubId)` → use `services` directly with `hubId` param
  - `getMessagingAdapter(channel, dos, hmacSecret)` → `getMessagingAdapter(channel, services.settings, hmacSecret, hubId)`
  - `getNostrPublisher(env)` → `getNostrPublisher(env)` (from new adapters.ts)
  - `dos.conversations.fetch(...)` → `services.conversations.*`

  Commit: `feat(routes): migrate conversations + messaging router to service layer`

- [ ] **5.8 Migrate settings + hubs routes**

  Files: `src/worker/routes/settings.ts`, `src/worker/routes/hubs.ts`

  Replace `dos.settings.fetch(...)` → `services.settings.*`.

  Commit: `feat(routes): migrate settings + hubs routes to service layer`

- [ ] **5.9 Migrate provisioning + setup + reports routes**

  Files: `src/worker/routes/provisioning.ts`, `src/worker/routes/setup.ts`, `src/worker/routes/reports.ts`

  Commit: `feat(routes): migrate provisioning, setup, reports routes to service layer`

- [ ] **5.10 Migrate blasts + contacts routes**

  Files: `src/worker/routes/blasts.ts`, `src/worker/routes/contacts.ts`

  Replace `dos.blasts.fetch(...)` → `services.blasts.*`.

  Commit: `feat(routes): migrate blasts + contacts routes to service layer`

- [ ] **5.11 Migrate remaining routes**

  Files: `src/worker/routes/health.ts`, `src/worker/routes/config.ts`, `src/worker/routes/dev.ts`, `src/worker/routes/metrics.ts`, `src/worker/routes/files.ts`, `src/worker/routes/uploads.ts`

  - `dev.ts` (test-reset handler): Replace DO resets with `services.identity.resetForTest()` etc.
  - `config.ts`: Check for any `getDOs(c.env)` calls
  - Others: Replace any remaining DO calls

  Commit: `feat(routes): migrate remaining routes (health, config, dev, metrics, files) to service layer`

- [ ] **5.12 Final typecheck after all route migrations**

  ```bash
  bun run typecheck
  bun run build
  ```

  Both must pass with zero errors. Do NOT use `any` to silence errors — fix the root cause.

---

## Phase 6: Rename src/worker/ → src/server/

**Goal:** Rename the directory and update all import paths. This is purely mechanical — no logic changes.

### Steps

- [ ] **6.1 Git move the directory**

  ```bash
  cd ~/projects/llamenos-hotline
  git mv src/worker src/server
  ```

- [ ] **6.2 Update `tsconfig.json`**

  Change `"@worker/*": ["./src/worker/*"]` → `"@server/*": ["./src/server/*"]`.
  Remove `"#cloudflare-workers": ["./src/platform/index.ts"]` from paths (deleted in Phase 7).
  Remove `"@cloudflare/workers-types"` from `types` array.

- [ ] **6.3 Update `vite.config.ts`**

  Change `@worker` alias → `@server`.

- [ ] **6.4 Mass update all import paths across codebase**

  ```bash
  # Update all @worker/ imports to @server/
  find src/ -type f -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|@worker/|@server/|g'
  # Update relative imports that reference worker/ directory
  find src/ -type f -name "*.ts" | xargs sed -i "s|from '../../worker/|from '../../server/|g"
  find src/ -type f -name "*.ts" | xargs sed -i "s|from '../worker/|from '../server/|g"
  ```

  Note: Use Grep to verify no remaining `@worker/` references:
  ```bash
  grep -r '@worker/' src/ --include="*.ts" --include="*.tsx"
  # Should return nothing
  ```

- [ ] **6.5 Move platform node files to their final locations**

  ```bash
  git mv src/platform/node/server.ts src/server/server.ts
  git mv src/platform/node/env.ts src/server/env.ts
  git mv src/platform/node/blob-storage.ts src/server/lib/blob-storage.ts
  git mv src/platform/node/transcription.ts src/server/lib/transcription.ts
  git mv src/platform/types.ts src/server/types.ts
  ```

  Update import paths in moved files to reflect new locations.

- [ ] **6.6 Update `package.json` imports field**

  Remove `"#cloudflare-workers"` import map entry (the `#cloudflare-workers` shim is being deleted).

- [ ] **6.7 Update `src/server/server.ts` imports**

  Now that server.ts is at `src/server/server.ts`, update relative imports from the old platform/node location to the new server location.

- [ ] **6.8 Typecheck + build**

  ```bash
  bun run typecheck
  bun run build
  ```

  Fix any broken import paths. Do NOT commit until both pass.

- [ ] **6.9 Commit**

  ```bash
  git add -A
  git commit -m "refactor: rename src/worker/ to src/server/ and update @worker alias"
  ```

---

## Phase 7: Delete CF/Platform Layer

**Goal:** Remove all Cloudflare and platform shim code that is now dead.

### Steps

- [ ] **7.1 Delete all DO files**

  ```bash
  git rm src/server/durable-objects/identity-do.ts
  git rm src/server/durable-objects/settings-do.ts
  git rm src/server/durable-objects/records-do.ts
  git rm src/server/durable-objects/shift-manager.ts
  git rm src/server/durable-objects/call-router.ts
  git rm src/server/durable-objects/conversation-do.ts
  git rm src/server/durable-objects/blast-do.ts
  git rm -rf src/server/durable-objects/
  ```

- [ ] **7.2 Delete DO infrastructure files**

  ```bash
  git rm src/server/lib/do-router.ts
  git rm src/server/lib/do-access.ts
  git rm src/server/services/audit.ts  # absorbed into RecordsService in Phase 2
  git rm src/server/index.ts           # CF Worker entry point (DO exports + scheduled() cron)
  ```

  Note: `src/server/index.ts` (renamed from `src/worker/index.ts`) is the CF Worker entry point that exports DO classes and the `scheduled()` cron handler. After migration, this is entirely dead code — the scheduled demo reset is handled by host cron calling `POST /api/test-reset` (already provisioned by the CF→VPS Demo Migration workstream).

- [ ] **7.3 Delete the platform layer**

  ```bash
  git rm -rf src/platform/
  ```

  This removes: `durable-object.ts`, `storage/postgres-storage.ts`, `storage/alarm-poller.ts`, `storage/postgres-pool.ts`, `storage/startup-migrations.ts`, `node/cf-types.d.ts`, `cloudflare.ts`, `index.ts`, and anything remaining.

- [ ] **7.4 Delete Wrangler and build artifacts**

  ```bash
  git rm wrangler.jsonc
  git rm -f esbuild.node.mjs  # may already be removed by Foundation Tooling workstream
  git rm -f scripts/dev-tunnel.sh
  ```

- [ ] **7.5 Delete DO-era migrations**

  ```bash
  git rm -rf src/shared/migrations/
  ```

- [ ] **7.6 Typecheck + build**

  ```bash
  bun run typecheck
  bun run build
  ```

  Fix any remaining references to deleted files. Common issues:
  - Any remaining imports of `DurableObject` from `#cloudflare-workers` (search: `grep -r 'cloudflare-workers' src/`)
  - Any remaining imports of deleted DO files
  - Any remaining `@cloudflare/workers-types` globals in type assertions

- [ ] **7.7 Commit**

  ```bash
  git add -A
  git commit -m "chore: delete CF/DO/platform layer and move node platform files"
  ```

---

## Phase 8: Package + Config Cleanup

**Goal:** Update package.json scripts, remove CF dev dependencies, update CI, update docker configs.

### Steps

- [ ] **8.1 Update `package.json` scripts**

  Remove scripts:
  - `dev:worker` (wrangler dev)
  - `deploy:cloudflare`
  - `deploy:next`
  - `start:bun` (old entrypoint)
  - `dev:tunnel`

  Add/update scripts:
  ```json
  {
    "dev:server": "bun --watch src/server/server.ts",
    "migrate": "bunx drizzle-kit migrate",
    "migrate:generate": "bunx drizzle-kit generate",
    "deploy": "bun run deploy:site"
  }
  ```

  Remove from `imports` field: `"#cloudflare-workers"` entry (deleted in Phase 6.6).

- [ ] **8.2 Remove CF dependencies from `package.json`**

  ```bash
  bun remove wrangler @cloudflare/workers-types
  bun remove postgres  # replaced by drizzle-orm/bun-sql (Bun's native SQL driver)
  bun remove ws @types/ws  # if only used by DO shim
  ```

  Verify: check if `ws` or `postgres` are used anywhere outside the deleted platform layer.
  ```bash
  grep -r "from 'ws'" src/ --include="*.ts"
  grep -r "from 'postgres'" src/ --include="*.ts"
  ```

  Remove only if no other usage found.

- [ ] **8.3 Update `tsconfig.json`**

  - Remove `@cloudflare/workers-types` from `types` array (or remove the `types` field entirely if that was the only entry)
  - Remove `#cloudflare-workers` from `paths`
  - Confirm `@server/*` alias is present (done in Phase 6)

- [ ] **8.4 Update `.github/workflows/*.yml`**

  For each CI workflow file:
  - Remove any `bunx wrangler` install or authentication steps targeting the app Worker
  - Add `bun run migrate` step before E2E test server startup (after DB is ready)
  - Remove any `wrangler.jsonc` linting or validation steps
  - The `site/` deploy workflow is unaffected — leave it alone

  Example addition to test job:
  ```yaml
  - name: Run database migrations
    run: bun run migrate
    env:
      DATABASE_URL: ${{ env.TEST_DATABASE_URL }}
  ```

- [ ] **8.5 Update `docker-compose.yml`**

  Change server start command from `node dist/server/index.js` (or old esbuild bundle) to `bun src/server/server.ts`.

- [ ] **8.6 Update `Dockerfile`**

  Remove esbuild bundle step. Use `bun` directly as the server runtime. The `ENTRYPOINT` or `CMD` should point to `bun src/server/server.ts` (or the built output if using `bun build` for production).

- [ ] **8.7 Update `CLAUDE.md`**

  Update the Development Commands section:
  - Remove `bun run dev:worker`
  - Add `bun run dev:server` — Bun server with --watch (localhost:3000)
  - Add `bun run migrate` — Apply pending Drizzle migrations
  - Add `bun run migrate:generate` — Generate SQL migration files from schema changes
  - Remove wrangler/deploy:cloudflare references

- [ ] **8.8 Typecheck + build**

  ```bash
  bun run typecheck
  bun run build
  ```

- [ ] **8.9 Commit**

  ```bash
  git add -A
  git commit -m "chore(config): update package.json, tsconfig, CI for CF removal"
  ```

---

## Phase 9: Verification

**Goal:** Final verification that everything works end-to-end. Fix any remaining issues without shortcuts.

### Steps

- [ ] **9.1 Full typecheck — zero errors**

  ```bash
  bun run typecheck
  ```

  If errors exist, fix each one. Do NOT use `any` to silence errors — find and fix the root type issue.

- [ ] **9.2 Production build — must succeed**

  ```bash
  bun run build
  ```

  The Vite SPA build must complete without errors.

- [ ] **9.3 Generate Drizzle migrations**

  ```bash
  # Requires a running PostgreSQL instance
  DATABASE_URL=postgres://localhost:5432/llamenos_dev bun run migrate:generate
  ```

  Verify the generated SQL in `drizzle/migrations/` looks correct — all tables from Phase 1 schema files should appear. Commit the generated migration files:

  ```bash
  git add drizzle/migrations/
  git commit -m "feat(migrations): initial Drizzle schema migration"
  ```

- [ ] **9.4 Apply migrations to dev database**

  ```bash
  DATABASE_URL=postgres://localhost:5432/llamenos_dev bun run migrate
  ```

  Must complete without errors.

- [ ] **9.5 Verify server starts**

  ```bash
  DATABASE_URL=postgres://localhost:5432/llamenos_dev \
  ADMIN_PUBKEY=... \
  HMAC_SECRET=... \
  bun run dev:server
  ```

  Server must start, apply migrations, and respond to `GET /api/health`.

- [ ] **9.6 Verify no remaining CF/DO references in src/**

  ```bash
  grep -r 'DurableObject\|getDOs\|DOStub\|DONamespace\|IDENTITY_DO\|SETTINGS_DO\|RECORDS_DO\|SHIFT_MANAGER\|CALL_ROUTER\|CONVERSATION_DO\|BLAST_DO\|wrangler\|cloudflare-workers' src/ --include="*.ts" --include="*.tsx"
  ```

  Should return no matches (except possibly comments).

- [ ] **9.7 Final commit if any fixes were made**

  ```bash
  git add -A
  git commit -m "fix: resolve remaining type errors after CF removal"
  ```

---

## Phase Dependency Summary

```
Phase 1 (Drizzle Foundation)
  └── Phase 2 (Service Classes)
        └── Phase 3 (Zod Schemas)
              └── Phase 4 (Server Wiring)
                    └── Phase 5 (Route Migration)
                          └── Phase 6 (Rename src/worker → src/server)
                                └── Phase 7 (Delete CF/Platform Layer)
                                      └── Phase 8 (Package + Config Cleanup)
                                            └── Phase 9 (Verification)
```

Each phase builds on the previous. Phases 1–3 add new files without touching existing code (safe to commit independently). Phases 4–5 modify existing files but keep the app functional (DO shim still exists). Phase 6 is the big rename. Phases 7–8 are cleanup. Phase 9 is final verification.

---

## Key Reference: getDOs Pattern → Service Pattern

This is the complete translation table for all route migrations:

| Old Pattern | New Pattern |
|-------------|-------------|
| `const dos = getDOs(c.env)` | `const { identity, settings, records, shifts, calls, conversations, blasts } = c.get('services')` |
| `const dos = getScopedDOs(c.env, hubId)` | Same `c.get('services')` — pass `hubId` to each method |
| `dos.identity.fetch(new Request('http://do/volunteers'))` | `await identity.listVolunteers(hubId)` |
| `dos.identity.fetch(new Request('http://do/volunteer/:pubkey'))` | `await identity.getVolunteer(pubkey)` |
| `dos.identity.fetch(new Request('http://do/volunteers', {method:'POST', body}))` | `await identity.createVolunteer(body)` |
| `dos.identity.fetch(new Request('http://do/admin/volunteers/:pubkey', {method:'PATCH', body}))` | `await identity.updateVolunteer(pubkey, body, true)` |
| `dos.identity.fetch(new Request('http://do/volunteers/:pubkey', {method:'DELETE'}))` | `await identity.deleteVolunteer(pubkey)` |
| `dos.identity.fetch(new Request('http://do/has-admin'))` | `await identity.hasAdmin()` |
| `dos.identity.fetch(new Request('http://do/bootstrap', {method:'POST', body}))` | `await identity.bootstrapAdmin(body.pubkey)` |
| `dos.identity.fetch(new Request('http://do/sessions/create', {method:'POST', body}))` | `await identity.createSession(body.pubkey)` |
| `dos.identity.fetch(new Request('http://do/sessions/validate/:token'))` | `await identity.validateSession(token)` |
| `dos.identity.fetch(new Request('http://do/sessions/revoke/:token', {method:'DELETE'}))` | `await identity.revokeSession(token)` |
| `dos.identity.fetch(new Request('http://do/sessions/revoke-all/:pubkey', {method:'DELETE'}))` | `await identity.revokeAllSessions(pubkey)` |
| `dos.identity.fetch(new Request('http://do/webauthn/credentials?pubkey=...'))` | `await identity.getWebAuthnCredentials(pubkey)` |
| `dos.identity.fetch(new Request('http://do/settings/webauthn'))` | `await identity.getWebAuthnSettings()` |
| `dos.settings.fetch(new Request('http://do/settings/spam'))` | `await settings.getSpamSettings(hubId)` |
| `dos.settings.fetch(new Request('http://do/settings/telephony-provider'))` | `await settings.getTelephonyConfig(hubId)` |
| `dos.settings.fetch(new Request('http://do/settings/messaging'))` | `await settings.getMessagingConfig(hubId)` |
| `dos.settings.fetch(new Request('http://do/settings/transcription'))` | `await settings.getTranscriptionSettings(hubId)` |
| `dos.settings.fetch(new Request('http://do/fallback'))` | `await settings.getFallbackGroup(hubId)` |
| `checkRateLimit(dos.settings, key, max)` | `await settings.checkRateLimit(key, max)` |
| `dos.records.fetch(new Request('http://do/audit', {method:'POST', body}))` | `await records.addAuditEntry(hubId, body.event, body.actorPubkey, body.details)` |
| `audit(dos.records, event, pubkey, details)` | `await records.addAuditEntry(hubId, event, pubkey, details)` |
| `dos.records.fetch(new Request('http://do/bans'))` | `await records.listBans(hubId)` |
| `dos.records.fetch(new Request('http://do/notes'))` | `await records.listNotes(hubId)` |
| `dos.shifts.fetch(new Request('http://do/current-volunteers'))` | `await shifts.getCurrentVolunteers(hubId)` |
| `dos.shifts.fetch(new Request('http://do/schedules'))` | `await shifts.listSchedules(hubId)` |
| `dos.calls.fetch(new Request('http://do/calls'))` | `await calls.listActiveCalls(hubId)` |
| `dos.conversations.fetch(new Request('http://do/conversations'))` | `await conversations.listConversations(hubId)` |
| `dos.blasts.fetch(new Request('http://do/blasts'))` | `await blasts.listBlasts(hubId)` |
| `getTelephony(env, dos)` | `await getTelephony(services.settings, hubId, env)` |
| `getMessagingAdapter(channel, dos, hmacSecret)` | `await getMessagingAdapter(channel, services.settings, hmacSecret, hubId)` |
| `getNostrPublisher(env)` (from do-access.ts) | `getNostrPublisher(env)` (from adapters.ts) |

---

## Files Summary

### Created (new files)
- `src/server/db/index.ts`
- `src/server/db/bun-jsonb.ts`
- `src/server/db/schema/index.ts`
- `src/server/db/schema/identity.ts`
- `src/server/db/schema/settings.ts`
- `src/server/db/schema/records.ts`
- `src/server/db/schema/shifts.ts`
- `src/server/db/schema/calls.ts`
- `src/server/db/schema/conversations.ts`
- `src/server/db/schema/blasts.ts`
- `src/server/services/index.ts`
- `src/server/services/identity.ts`
- `src/server/services/settings.ts`
- `src/server/services/records.ts`
- `src/server/services/shifts.ts`
- `src/server/services/calls.ts`
- `src/server/services/conversations.ts`
- `src/server/services/blasts.ts`
- `src/server/lib/errors.ts`
- `src/server/lib/adapters.ts`
- `src/server/lib/ringing.ts` (from src/worker/services/ringing.ts)
- `src/server/lib/transcription-manager.ts` (from src/worker/services/transcription.ts)
- `src/server/middleware/error.ts`
- `src/server/middleware/services.ts`
- `src/shared/schemas/index.ts`
- `src/shared/schemas/volunteers.ts`
- `src/shared/schemas/settings.ts`
- `src/shared/schemas/records.ts`
- `src/shared/schemas/shifts.ts`
- `src/shared/schemas/calls.ts`
- `src/shared/schemas/conversations.ts`
- `src/shared/schemas/blasts.ts`
- `drizzle.config.ts`
- `drizzle/migrations/` (generated)

### Renamed
- `src/worker/` → `src/server/` (entire directory, Phase 6)
- `src/platform/node/server.ts` → `src/server/server.ts` (Phase 6.5)
- `src/platform/node/env.ts` → `src/server/env.ts` (Phase 6.5)
- `src/platform/node/blob-storage.ts` → `src/server/lib/blob-storage.ts` (Phase 6.5)
- `src/platform/node/transcription.ts` → `src/server/lib/transcription.ts` (Phase 6.5)
- `src/platform/types.ts` → `src/server/types.ts` (Phase 6.5)

### Deleted
- `src/server/durable-objects/` (all 7 DO files, Phase 7)
- `src/server/lib/do-router.ts` (Phase 7)
- `src/server/lib/do-access.ts` (Phase 7)
- `src/server/index.ts` (CF Worker entry point with DO exports + scheduled cron, Phase 7)
- `src/server/services/audit.ts` (absorbed into RecordsService, Phase 7)
- `src/platform/` (entire directory, Phase 7)
- `src/shared/migrations/` (Phase 7)
- `wrangler.jsonc` (Phase 7)
- `esbuild.node.mjs` (Phase 7)
- `scripts/dev-tunnel.sh` (Phase 7)
