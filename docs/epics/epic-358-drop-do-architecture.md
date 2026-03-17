# Epic 358: Drop Durable Object Architecture — Drizzle ORM + Direct PostgreSQL

**Depends on:** Epic 357 (Bun runtime migration)

## Context

The Llamenos backend was originally designed for Cloudflare Workers + Durable Objects. A platform shim was built to run the same DO code on PostgreSQL for self-hosted deployments. The project has since pivoted to self-hosted-only (Bun runtime, Epic 357), making the CF Workers path dead code and the DO abstraction pure overhead.

**Current architecture:**
- 9 Durable Objects (~6,600 lines): `IdentityDO`, `SettingsDO`, `RecordsDO`, `ShiftManagerDO`, `CallRouterDO`, `ConversationDO`, `BlastDO`, `ContactDirectoryDO`, `CaseDO`
- ALL data stored in a single `kv_store(namespace, key, value JSONB)` table — no typed tables
- Secondary indexes maintained as additional KV entries (`idx:*` keys)
- Platform abstraction shim: ~1,200 lines (`src/platform/`)
- DO infrastructure: 271 lines (`do-router.ts` + `do-access.ts`)
- Routes call DOs via `fetch(new Request('http://do/path'))` — HTTP-over-nothing for in-process calls

**What this costs:**
- 4+ unnecessary serialization/deserialization cycles per database operation
- No relational indexes — hand-rolled trigram and secondary indexes as separate KV rows
- No JOINs, no SQL aggregation — all done in JS after loading full datasets
- Hub scoping implicit in namespace strings, not enforced by schema
- ConversationDO and BlastDO duplicate subscriber/blast code (data integrity bug — separate stores)

## Goal

Replace the DO architecture with **Drizzle ORM** backed by Bun's native SQL driver. Typed table schemas with proper relational indexes, foreign keys, and constraints. Routes call service methods directly — no HTTP-over-nothing, no DORouter, no Request/Response serialization.

## Architecture Decision: Drizzle ORM

### Why Drizzle (not raw SQL or another ORM)

1. **Native Bun.sql support** — `drizzle-orm/bun-sql` wraps Bun's built-in SQL driver directly. No additional driver package needed.
2. **Schema-as-code** — `pgTable()` definitions are the source of truth for DB structure. `drizzle-kit generate` produces migration SQL files. No hand-written DDL.
3. **Type-safe queries** — Full TypeScript inference from table schemas. Select, insert, update, delete all type-checked.
4. **Raw SQL escape hatch** — `sql` tagged template for advisory locks, `FOR UPDATE SKIP LOCKED`, custom functions. Never locked out of PostgreSQL features.
5. **`drizzle-orm/zod`** — generates insert/select Zod validation schemas from table definitions. DB-layer validation for free.
6. **Lightweight** — No entity manager, no identity map, no unit-of-work. Just a query builder with types. Fits our zero-knowledge architecture where the server doesn't interpret most data.
7. **Migration tooling** — `drizzle-kit generate` + `drizzle-kit migrate` for schema evolution. `drizzle-kit push` for rapid prototyping.

### Two Schema Layers (E2EE Architecture)

The server stores **encrypted opaque blobs**, not cleartext structures. This means:

| Layer | Source of Truth | Purpose |
|-------|----------------|---------|
| **Protocol schemas** (`packages/protocol/schemas/`) | Zod schemas | API wire format, client-side types. Describe the *decrypted* shape of data. |
| **Database schemas** (`apps/worker/db/schema/`) | Drizzle `pgTable()` | Storage-layer truth. Describe what the *server* sees: encrypted content + blind indexes + envelopes. |

These are **intentionally different**. A `Note` on the wire has `content: string` (decrypted text). In the database, it's `encrypted_content: text` (opaque ciphertext) + `envelopes: jsonb` (ECIES-wrapped keys per reader). The protocol schemas cannot drive the database schema because the server's view of data is fundamentally different from the client's.

**`drizzle-orm/zod`** generates insert/select validators from the Drizzle tables — these validate the *encrypted* shape for DB operations, complementing the protocol schemas that validate the *decrypted* shape for API operations.

## Database Schema Design

### New Dependencies

```bash
bun add drizzle-orm    # includes drizzle-orm/zod (no separate `drizzle-orm/zod` package needed)
bun add -d drizzle-kit # >=0.21.0 required for partial indexes and .using('gin', ...)
```

### Directory Structure

```
apps/worker/
  db/
    index.ts              # drizzle() instance, connection setup
    schema/
      index.ts            # Re-exports all tables + relations
      volunteers.ts       # volunteers, sessions, invites, webauthn, devices
      settings.ts         # system_settings, hubs, hub_settings, roles, entity_types, ...
      records.ts          # notes, note_replies, bans, audit_log, contact_metadata
      shifts.ts           # shifts, push_reminders_sent
      calls.ts            # active_calls, call_records
      conversations.ts    # conversations, messages, files, reports
      blasts.ts           # subscribers, blasts, blast_settings
      contacts.ts         # contacts, contact_relationships, affinity_groups, group_members
      cases.ts            # case_records, events, case_contacts, case_events, ...
      tasks.ts            # scheduled_tasks (replaces alarm poller)
      nostr.ts            # nostr_event_outbox (already exists, gets Drizzle definition)
    relations.ts          # defineRelations() for all cross-table relationships
    validators.ts         # createInsertSchema/createSelectSchema exports via `drizzle-orm/zod`
    migrate.ts            # Programmatic migration runner (drizzle-orm/bun-sql/migrator)
  services/
    index.ts              # Service registry + createServices()
    identity.ts           # Volunteers, sessions, invites, WebAuthn, devices
    settings.ts           # System settings, hubs, entity types, roles
    records.ts            # Notes, bans, contact metadata
    audit.ts              # Hash-chained audit log (extracted)
    shifts.ts             # Shifts, push reminders
    calls.ts              # Active calls, call records, presence
    conversations.ts      # Conversations, messages, files
    blasts.ts             # Subscribers, blasts, delivery (unified — fixes duplication bug)
    contacts.ts           # Contact directory, relationships, groups
    cases.ts              # Cases, events, interactions, evidence, links
    scheduler.ts          # Scheduled tasks (replaces alarm poller)
  middleware/
    services.ts           # Hono middleware: inject services into context
drizzle/                  # Migration output directory (at repo root)
  migrations/             # Generated SQL migration files
  meta/                   # drizzle-kit snapshots
drizzle.config.ts         # drizzle-kit configuration
```

### Example Table Definitions

#### volunteers.ts — Identity Domain

```typescript
import { pgTable, text, boolean, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const volunteers = pgTable('volunteers', {
  pubkey: text('pubkey').primaryKey(),  // 64-char hex, NOT a UUID
  roles: text('roles').array().notNull().default(sql`'{"volunteer"}'::text[]`),
  displayName: text('display_name'),
  phone: text('phone'),  // encrypted
  status: text('status').notNull().default('active'),
  hubRoles: jsonb('hub_roles').notNull().default([]),  // [{hubId, roleIds: string[]}]
  availability: text('availability').notNull().default('unavailable'),
  onBreak: boolean('on_break').default(false),
  callPreference: text('call_preference'),
  spokenLanguages: text('spoken_languages').array().default(sql`'{}'::text[]`),
  uiLanguage: text('ui_language'),
  transcriptionEnabled: boolean('transcription_enabled').default(false),
  profileCompleted: boolean('profile_completed').default(false),
  specializations: text('specializations').array().default(sql`'{}'::text[]`),
  maxCaseAssignments: integer('max_case_assignments'),
  teamId: text('team_id'),
  supervisorPubkey: text('supervisor_pubkey'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  pubkey: text('pubkey').notNull().references(() => volunteers.pubkey, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  deviceInfo: jsonb('device_info'),
}, (t) => [
  index('idx_sessions_pubkey').on(t.pubkey),
  index('idx_sessions_expires').on(t.expiresAt),
])

export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  roleIds: text('role_ids').array().notNull().default(sql`'{}'::text[]`),
  hubId: text('hub_id'),
  createdBy: text('created_by'),
  redeemedBy: text('redeemed_by'),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const webauthnCredentials = pgTable('webauthn_credentials', {
  credentialId: text('credential_id').primaryKey(),
  pubkey: text('pubkey').notNull().references(() => volunteers.pubkey, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),  // base64
  counter: integer('counter').notNull().default(0),
  transports: text('transports').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_webauthn_pubkey').on(t.pubkey),
])

export const webauthnChallenges = pgTable('webauthn_challenges', {
  challengeId: text('challenge_id').primaryKey(),
  challenge: text('challenge').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const devices = pgTable('devices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  pubkey: text('pubkey').notNull().references(() => volunteers.pubkey, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  pushToken: text('push_token'),
  voipToken: text('voip_token'),
  wakeKeyPublic: text('wake_key_public'),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [
  index('idx_devices_pubkey').on(t.pubkey),
])

export const provisionRooms = pgTable('provision_rooms', {
  roomId: text('room_id').primaryKey(),
  initiatorPubkey: text('initiator_pubkey').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
```

#### records.ts — Notes & Audit (E2EE Domain)

```typescript
import { pgTable, text, integer, timestamp, jsonb, index, uuid } from 'drizzle-orm/pg-core'
import { hubs } from './settings'

// E2EE notes — server sees encrypted content + envelopes, never plaintext
export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  hubId: text('hub_id'),
  authorPubkey: text('author_pubkey').notNull(),
  callId: text('call_id'),
  conversationId: text('conversation_id'),
  contactHash: text('contact_hash'),
  // E2EE: server stores opaque encrypted blob
  encryptedContent: text('encrypted_content').notNull(),
  // E2EE: per-reader key envelopes (ECIES-wrapped symmetric key)
  authorEnvelope: jsonb('author_envelope').notNull(),  // {pubkey, wrappedKey, ephemeralPubkey}
  adminEnvelopes: jsonb('admin_envelopes').notNull().default([]),  // array of above
  // Custom field envelopes (optional, for structured encrypted fields)
  encryptedFields: text('encrypted_fields'),
  fieldEnvelopes: jsonb('field_envelopes'),
  replyCount: integer('reply_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_notes_hub').on(t.hubId),
  index('idx_notes_author').on(t.authorPubkey),
  index('idx_notes_contact').on(t.contactHash),
  index('idx_notes_created').on(t.createdAt),
])

// Hash-chained audit log — tamper-evident via SHA-256 chain
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  hubId: text('hub_id'),
  action: text('action').notNull(),
  actorPubkey: text('actor_pubkey').notNull(),
  details: jsonb('details'),
  previousEntryHash: text('previous_entry_hash'),
  entryHash: text('entry_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_audit_hub_created').on(t.hubId, t.createdAt),
  index('idx_audit_action').on(t.action),
])
```

#### cases.ts — CMS Case Records (E2EE + Blind Indexes)

```typescript
import { pgTable, text, integer, timestamp, jsonb, index, uuid, uniqueIndex } from 'drizzle-orm/pg-core'

// Case records — encrypted summary/fields/PII + blind indexes for server-side filtering
export const caseRecords = pgTable('case_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  hubId: text('hub_id'),
  entityTypeId: text('entity_type_id'),
  caseNumber: text('case_number'),
  // Blind indexes — hashed values for server-side filtering without decryption
  statusHash: text('status_hash'),
  severityHash: text('severity_hash'),
  categoryHash: text('category_hash'),
  assignedTo: text('assigned_to').array().notNull().default(sql`'{}'::text[]`),
  blindIndexes: jsonb('blind_indexes').notNull().default({}),  // {fieldName: hash|hash[]}
  // E2EE 3-tier encrypted content
  encryptedSummary: text('encrypted_summary'),
  summaryEnvelopes: jsonb('summary_envelopes').notNull().default([]),
  encryptedFields: text('encrypted_fields'),
  fieldEnvelopes: jsonb('field_envelopes'),
  encryptedPii: text('encrypted_pii'),
  piiEnvelopes: jsonb('pii_envelopes'),
  // Denormalized counts (updated on link/unlink)
  contactCount: integer('contact_count').notNull().default(0),
  interactionCount: integer('interaction_count').notNull().default(0),
  fileCount: integer('file_count').notNull().default(0),
  reportCount: integer('report_count').notNull().default(0),
  // Metadata
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [
  index('idx_cases_hub').on(t.hubId),
  index('idx_cases_status').on(t.hubId, t.statusHash),
  index('idx_cases_severity').on(t.hubId, t.severityHash),
  index('idx_cases_type').on(t.entityTypeId),
  uniqueIndex('idx_cases_number').on(t.caseNumber).where(sql`case_number IS NOT NULL`),
  index('idx_cases_assigned').using('gin', t.assignedTo),
  index('idx_cases_category').on(t.hubId, t.categoryHash),
])
```

### Database Connection

```typescript
// apps/worker/db/index.ts
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function initDatabase(databaseUrl: string): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db
  db = drizzle({
    connection: { url: databaseUrl },
    schema,
  })
  return db
}

export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}

export type Database = ReturnType<typeof getDb>
```

### Additional Table Definitions (Not Shown in Full Above)

The following tables are referenced in the file inventory but not fully defined in the example sections. They follow the same patterns:

#### contact_metadata (RecordsDO `contact-meta:*`)
```typescript
export const contactMetadata = pgTable('contact_metadata', {
  contactHash: text('contact_hash').notNull(),
  hubId: text('hub_id'),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  noteCount: integer('note_count').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.contactHash, t.hubId] }),
])
```

#### note_replies (RecordsDO `note-replies:*`)
```typescript
export const noteReplies = pgTable('note_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  noteId: uuid('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  authorPubkey: text('author_pubkey').notNull(),
  encryptedContent: text('encrypted_content').notNull(),
  readerEnvelopes: jsonb('reader_envelopes').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_replies_note').on(t.noteId),
])
```

#### messages (ConversationDO `messages:*`)
```typescript
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(),  // 'inbound' | 'outbound'
  externalId: text('external_id'),  // provider message ID for delivery status callbacks
  authorPubkey: text('author_pubkey'),
  encryptedContent: text('encrypted_content').notNull(),
  readerEnvelopes: jsonb('reader_envelopes').notNull().default([]),
  status: text('status').default('sent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_messages_conv').on(t.conversationId, t.createdAt),
  uniqueIndex('idx_messages_external').on(t.externalId).where(sql`external_id IS NOT NULL`),
])
```

#### system_settings (SettingsDO scalar keys)

```typescript
export const systemSettings = pgTable('system_settings', {
  id: integer('id').primaryKey().default(1),  // singleton
  spamSettings: jsonb('spam_settings').notNull().default({}),
  callSettings: jsonb('call_settings').notNull().default({}),
  transcriptionSettings: jsonb('transcription_settings').notNull().default({}),
  ivrLanguages: text('ivr_languages').array().default(sql`'{}'::text[]`),
  messagingConfig: jsonb('messaging_config').notNull().default({}),
  telephonyProvider: jsonb('telephony_provider').notNull().default({}),
  setupState: jsonb('setup_state').notNull().default({}),
  webauthnSettings: jsonb('webauthn_settings').notNull().default({}),
  caseManagementEnabled: boolean('case_management_enabled').default(false),
  autoAssignmentSettings: jsonb('auto_assignment_settings').notNull().default({}),
  crossHubSettings: jsonb('cross_hub_settings').notNull().default({}),
  crossHubSharingEnabled: boolean('cross_hub_sharing_enabled').default(false),
  ttlOverrides: jsonb('ttl_overrides').notNull().default({}),
  appliedTemplates: text('applied_templates').array().default(sql`'{}'::text[]`),
  fallbackGroup: text('fallback_group').array().default(sql`'{}'::text[]`),  // volunteer pubkeys
  reportCategories: text('report_categories').array().default(sql`'{}'::text[]`),
  reportTypes: jsonb('report_types').notNull().default([]),  // legacy messaging report types
  cmsReportTypes: jsonb('cms_report_types').notNull().default([]),  // CMS report type definitions
})
```

#### volunteer-load (ConversationDO — COMPUTED, not stored)

The `volunteer-load:{pubkey}` and `volunteer-conversations:{pubkey}` KV keys are denormalized counters. In the Drizzle architecture, these are computed via SQL:

```typescript
// In ConversationService
async getVolunteerLoad(pubkey: string, hubId: string | null) {
  const [result] = await this.db.select({
    activeCount: sql<number>`count(*) filter (where ${conversations.status} IN ('active', 'waiting'))`,
    totalCount: sql<number>`count(*)`,
  })
    .from(conversations)
    .where(and(
      eq(conversations.assignedTo, pubkey),
      eq(conversations.hubId, hubId),
    ))
  return result
}
```

This eliminates the denormalized counter maintenance (increment/decrement on assignment changes) in favor of an always-accurate aggregate query. PostgreSQL is fast enough for this at current scale, and the `idx_conv_assigned` index covers the lookup.

### Service Layer Pattern

```typescript
// apps/worker/services/records.ts
import { eq, and, desc, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { notes, auditLog } from '../db/schema'

export class RecordsService {
  constructor(private db: Database) {}

  async createNote(data: {
    hubId: string | null
    authorPubkey: string
    encryptedContent: string
    authorEnvelope: unknown
    adminEnvelopes: unknown[]
    callId?: string
    contactHash?: string
  }) {
    const [note] = await this.db.insert(notes).values({
      hubId: data.hubId,
      authorPubkey: data.authorPubkey,
      encryptedContent: data.encryptedContent,
      authorEnvelope: data.authorEnvelope,
      adminEnvelopes: data.adminEnvelopes,
      callId: data.callId,
      contactHash: data.contactHash,
    }).returning()
    return note
  }

  async listNotes(hubId: string | null, filters: {
    authorPubkey?: string
    contactHash?: string
    limit?: number
    offset?: number
  } = {}) {
    const conditions = [eq(notes.hubId, hubId)]
    if (filters.authorPubkey) conditions.push(eq(notes.authorPubkey, filters.authorPubkey))
    if (filters.contactHash) conditions.push(eq(notes.contactHash, filters.contactHash))

    return this.db.select().from(notes)
      .where(and(...conditions))
      .orderBy(desc(notes.createdAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
  }
}
```

### Route Migration Example

**Before** (DO-based):
```typescript
app.post('/', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = await c.req.json()
  const res = await dos.records.fetch(
    new Request('http://do/notes', {
      method: 'POST',
      body: JSON.stringify({ ...body, authorPubkey: c.get('pubkey') }),
    })
  )
  if (!res.ok) return c.json(await res.json(), res.status)
  const data = await res.json()
  await audit(dos.records, 'noteCreated', c.get('pubkey'), { noteId: data.note.id })
  return c.json(data, 201)
})
```

**After** (Drizzle service):
```typescript
app.post('/', async (c) => {
  const { records, audit } = c.get('services')
  const hubId = c.get('hubId')
  const body = await c.req.json()
  const note = await records.createNote({
    ...body,
    hubId,
    authorPubkey: c.get('pubkey'),
  })
  await audit.log('noteCreated', c.get('pubkey'), { noteId: note.id }, hubId)
  return c.json({ note }, 201)
})
```

### Scheduled Tasks (Replaces DO Alarms)

```typescript
// apps/worker/db/schema/tasks.ts
export const scheduledTasks = pgTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  taskType: text('task_type').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload').notNull().default({}),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
}, (t) => [
  index('idx_tasks_due').on(t.runAt).where(sql`claimed_at IS NULL`),
])
```

```typescript
// apps/worker/services/scheduler.ts
export class TaskScheduler {
  constructor(private db: Database, private handlers: Map<string, (payload: unknown) => Promise<void>>) {}

  start(intervalMs = 15_000) {
    this.interval = setInterval(() => this.poll(), intervalMs)
    setTimeout(() => this.poll(), 3_000)
  }

  private async poll() {
    // Use raw SQL for FOR UPDATE SKIP LOCKED (not expressible in Drizzle query builder)
    // NOTE: bun-sql execute() returns array directly (not { rows }),
    // unlike node-postgres which returns { rows: [...] }
    const tasks = await this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        DELETE FROM scheduled_tasks
        WHERE id IN (
          SELECT id FROM scheduled_tasks
          WHERE run_at <= now() AND claimed_at IS NULL
          FOR UPDATE SKIP LOCKED
          LIMIT 50
        )
        RETURNING *
      `)
      // bun-sql returns the rows array directly from execute()
      return Array.isArray(result) ? result : (result as any).rows ?? []
    })
    for (const task of tasks) {
      const handler = this.handlers.get(task.task_type as string)
      if (handler) handler(task.payload).catch(err =>
        console.error(`[scheduler] Task ${task.id} failed:`, err)
      )
    }
  }
}
```

### Migration Strategy

**drizzle-kit** handles schema evolution:

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/worker/db/schema/*.ts',
  out: './drizzle/migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

**Data migration** from `kv_store` to typed tables:

```typescript
// apps/worker/db/migrate-kv.ts — run once
async function migrateVolunteers(db: Database) {
  const rows = await db.execute(sql`
    SELECT key, value FROM kv_store
    WHERE namespace = 'identity-globalidentity' AND key LIKE 'vol:%'
  `)
  for (const row of rows) {
    const vol = row.value as Record<string, unknown>
    await db.insert(volunteers).values(mapVolunteerFromKV(vol)).onConflictDoNothing()
  }
}
```

**Startup migration** (applied automatically):
```typescript
// apps/worker/db/index.ts
// NOTE: drizzle-orm/bun-sql/migrator may not be exposed yet.
// Fallback: use drizzle-kit CLI (`drizzle-kit migrate`) in Docker entrypoint
// or pre-deploy CI step. Verify import path against installed drizzle-orm version.
import { migrate } from 'drizzle-orm/bun-sql/migrator'

export async function initDatabase(databaseUrl: string) {
  const db = drizzle({ connection: { url: databaseUrl }, schema })
  await migrate(db, { migrationsFolder: './drizzle/migrations' })
  return db
}
```

**Fallback if programmatic migrator unavailable**: Add `drizzle-kit migrate` to the Docker entrypoint or a pre-start script, similar to how `runStartupMigrations()` works today.

## Scope

### In Scope
- Replace all 9 DOs with service classes backed by Drizzle ORM
- ~45 typed PostgreSQL tables with proper indexes, FKs, constraints
- `drizzle-kit` migration tooling
- Service injection middleware for Hono
- All ~32 route files updated
- Data migration script from `kv_store`
- Delete `src/platform/` (~1,200 lines), `apps/worker/durable-objects/` (~6,600 lines), `do-router.ts`, `do-access.ts`
- Fix ConversationDO/BlastDO subscriber data integrity bug (unified table)
- Scheduled task system replaces DO alarms

### Out of Scope
- Frontend changes (API contract stays identical)
- Mobile clients (same API)
- Crypto layer (unchanged)
- Nostr relay integration (unchanged)
- Cloudflare Workers for marketing site (separate deployment)

## E2EE / Zero-Knowledge Considerations

The database schema is designed to preserve zero-knowledge guarantees:

1. **Encrypted content is opaque TEXT** — `encrypted_content`, `encrypted_summary`, `encrypted_fields`, `encrypted_pii` are stored as base64 ciphertext. The server never sees or validates the plaintext structure.

2. **Envelopes are JSONB arrays** — `author_envelope`, `admin_envelopes`, `summary_envelopes`, `field_envelopes`, `pii_envelopes` store ECIES-wrapped symmetric keys. The server can enumerate recipients but cannot decrypt the content keys.

3. **Blind indexes enable server-side filtering** — `status_hash`, `severity_hash`, `category_hash`, `blind_indexes` are HMAC-SHA256 values that the server can use for WHERE clauses without learning the cleartext values. These are computed client-side and passed through the API.

4. **No cleartext PII in the database** — volunteer phones, contact details, note content, case summaries are all encrypted. Only hashes and pubkeys (which are pseudonymous) are in cleartext.

5. **Hub key distribution unchanged** — hub keys are ECIES-wrapped per-member, stored in `hub_keys` table. Rotation on member departure still works the same way.

6. **Audit log hash chain preserved** — `previous_entry_hash` + `entry_hash` in the `audit_log` table. The hash chain integrity check requires serialized writes, implemented via `SELECT ... FOR UPDATE` on the latest entry.

## Implementation Order

1. **Set up Drizzle** — install deps, create `drizzle.config.ts`, `apps/worker/db/index.ts`
2. **Write all table schemas** — `apps/worker/db/schema/*.ts` (can coexist with DOs)
3. **Generate initial migration** — `drizzle-kit generate`
4. **Write service classes** — parallel to DOs, not yet wired
5. **Service injection middleware** — inject services into Hono context
6. **Migrate DOs one at a time** (order below) — update routes, run BDD tests, delete DO
7. **Write data migration script** — `kv_store` → typed tables
8. **Relocate blob-storage, transcription, outbox** to `apps/worker/lib/`
9. **Delete platform layer** (`src/platform/`)
10. **Delete DO infrastructure** (do-router, do-access, durable-objects/)
11. **Drop `kv_store` and `alarms` tables** (after verification)
12. **Update docs** (CLAUDE.md, PROTOCOL.md)

**DO migration order** (dependency-driven):
1. `SettingsDO` → `SettingsService` — no inbound deps, most routes depend on it
2. `IdentityDO` → `IdentityService` — auth depends on it
3. `RecordsDO` → `RecordsService` + `AuditService` — notes, bans, audit
4. `ShiftManagerDO` → `ShiftService` — shifts, push reminders
5. `CallRouterDO` → `CallService` — depends on shifts + identity (already migrated)
6. `ConversationDO` + `BlastDO` → `ConversationService` + `BlastService` — unified, fixes dupe bug
7. `ContactDirectoryDO` → `ContactService` — trigram KV indexes → GIN indexes
8. `CaseDO` → `CaseService` — most complex, many link tables

## Files Created

```
apps/worker/db/
  index.ts                    # Drizzle instance + migration runner
  schema/
    index.ts                  # Re-exports all tables
    volunteers.ts             # 7 tables: volunteers, sessions, invites, webauthn_*, devices, provision_rooms
    settings.ts               # ~12 tables: system_settings, hubs, hub_settings, hub_keys, roles, entity/relationship/report types, custom_fields, ivr_audio, rate_limits, captchas, case_number_sequences
    records.ts                # 5 tables: notes, note_replies, bans, audit_log, contact_metadata
    shifts.ts                 # 2 tables: shifts, push_reminders_sent
    calls.ts                  # 2 tables: active_calls, call_records
    conversations.ts          # 4 tables: conversations, messages, files, reports (report = conversation subtype)
    blasts.ts                 # 3 tables: subscribers, blasts, blast_settings
    contacts.ts               # 4 tables: contacts, contact_relationships, affinity_groups, group_members
    cases.ts                  # 9 tables: case_records, events, case_contacts, case_events, report_events, report_cases, case_interactions, evidence, custody_entries
    tasks.ts                  # 1 table: scheduled_tasks
    nostr.ts                  # 1 table: nostr_event_outbox (migrated from raw DDL)
  relations.ts                # defineRelations()
  validators.ts               # `drizzle-orm/zod` createInsertSchema/createSelectSchema exports
  migrate-kv.ts               # One-time KV → typed table migration
apps/worker/services/
  index.ts                    # Service registry
  identity.ts
  settings.ts
  records.ts
  audit.ts
  shifts.ts
  calls.ts
  conversations.ts
  blasts.ts
  contacts.ts
  cases.ts
  scheduler.ts
apps/worker/middleware/
  services.ts                 # Service injection
drizzle.config.ts             # drizzle-kit config
drizzle/migrations/           # Generated SQL files
```

## Files Deleted

```
src/platform/                 # Entire directory (~1,200 lines)
apps/worker/durable-objects/  # Entire directory (9 files, ~6,600 lines)
apps/worker/lib/do-router.ts  # 44 lines
apps/worker/lib/do-access.ts  # 227 lines
```

## Files Modified

```
apps/worker/app.ts               # Remove DO imports, add service middleware
apps/worker/index.ts             # Remove DO class exports
apps/worker/types.ts             # Env drops DO namespaces, adds Services + Database
apps/worker/routes/*.ts          # All 32 route files: getDOs() → c.get('services')
apps/worker/lib/auth.ts          # DO fetch → service call
apps/worker/lib/push-dispatch.ts # DO refs → services
apps/worker/middleware/auth.ts   # identityDO → identityService
apps/worker/middleware/hub.ts    # DO refs → services
apps/worker/telephony/*.ts       # SettingsDO → settingsService
apps/worker/messaging/router.ts  # ConversationDO → conversationService
wrangler.jsonc                   # Remove 9 DO bindings
package.json                     # Add drizzle-orm, drizzle-kit
```

## Risks & Mitigations

### Risk: CRITICAL — Massive route rewrite (~32 files, ~200+ handlers)
**Mitigation**: Transformation is mechanical. Each `dos.X.fetch(new Request(...))` becomes `services.X.method(params)`. DO handler business logic moves into service method body. BDD tests validate at API level — they don't test DO internals.

### Risk: HIGH — Data migration correctness
**Mitigation**: Pre-production — no live user data. `drizzle-kit` handles schema creation. Migration script validates counts. Fresh deployments skip migration entirely.

### Risk: HIGH — Concurrency model change
**Mitigation**: Advisory locks serialized ALL writes per namespace. Drizzle uses PostgreSQL's MVCC for most operations. Audit log hash chain requires serialized writes — use `SELECT ... FOR UPDATE` on the latest entry within a transaction.

### Risk: MEDIUM — ConversationDO/BlastDO data integrity bug
**Impact**: Both DOs maintain identical code with SEPARATE data stores. Migration unifies into single `subscribers`/`blasts` tables.
**Mitigation**: Audit which DO's routes are actually called to determine canonical dataset.

### Risk: MEDIUM — Blob storage + transcription relocation
**Impact**: `blob-storage.ts` and `transcription.ts` in `src/platform/bun/` which gets deleted.
**Mitigation**: Move to `apps/worker/lib/`. Code unchanged; only location moves.

### Risk: LOW — Nostr outbox relocation
**Mitigation**: `outbox.ts` and `outbox-poller.ts` move to `apps/worker/lib/`. Only depend on DB connection, not DOs.

### Risk: LOW — dev.ts test-reset
**Mitigation**: `TRUNCATE ... CASCADE` is simpler and more thorough than 8 separate DO resets. Fixes existing bug where BlastDO is never reset.

## Acceptance Criteria

- [ ] All 9 DOs replaced with Drizzle-backed service classes
- [ ] ~45 typed PostgreSQL tables with proper indexes and constraints
- [ ] `drizzle-kit generate` produces migration SQL from schema changes
- [ ] `src/platform/` directory deleted (~1,200 lines)
- [ ] `apps/worker/durable-objects/` directory deleted (~6,600 lines)
- [ ] `do-router.ts` and `do-access.ts` deleted
- [ ] Hub scoping via `hub_id` columns with FK constraints
- [ ] Audit log hash chain preserved with serialized writes
- [ ] Scheduled task system replaces DO alarms
- [ ] ConversationDO/BlastDO subscriber duplication resolved
- [ ] E2EE envelopes stored as JSONB, encrypted content as opaque TEXT
- [ ] Blind indexes preserved for server-side filtering
- [ ] All BDD tests pass
- [ ] Data migration script for existing dev data
- [ ] No `import { DurableObject } from 'cloudflare:workers'` in codebase
- [ ] `kv_store` and `alarms` tables dropped after verification

## Estimated Impact

- **~8,100 lines deleted** (platform: ~1,200 + DOs: ~6,600 + do-router: 44 + do-access: ~210)
- **~5,000-6,000 lines created** (Drizzle schema definitions + services — less than DOs due to no Request/Response overhead, no DORouter, no KV index management)
- **Net: ~2,100-3,100 lines removed**
- **1 catch-all table → ~45 typed tables** with indexes, FKs, constraints
- **Query performance: 2-10x faster** for indexed lookups (GIN indexes replace KV prefix scans)
- **4 serialization cycles eliminated** per operation
- **No more advisory locks** for simple CRUD
- **Proper SQL JOINs** for cross-entity queries
- **Hub scoping enforced by schema** (FK constraints), not naming conventions
- **`cloudflare:workers` import eliminated** — resolves Epic 357 tsconfig path alias risk
- **Type-safe queries** — Drizzle inference catches column name typos at compile time
- **Automated migrations** — `drizzle-kit generate` + `drizzle-kit migrate`
