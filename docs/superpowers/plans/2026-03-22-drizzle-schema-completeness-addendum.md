# Drizzle Migration Schema Completeness — Addendum

> **For agentic workers:** This plan supplements `2026-03-22-cf-removal-drizzle-migration-plan.md`. It must be applied **during Phase 1** (Drizzle Foundation), before any service classes are written. These are **blocking schema corrections** — the migration plan's Phase 1 tables are incomplete.

> **CRITICAL:** The cf-removal worktree at `.worktrees/cf-removal` (branch `feature/cf-removal-drizzle-migration`) is actively being worked on. Apply these corrections to that branch, not main.

**Goal:** Fix critical schema gaps found by auditing the actual DO storage against the proposed Drizzle schema. Prevent data loss or architectural dead-ends in the migration.

---

## BLOCKING ISSUES (Must Fix Before Phase 2)

### Issue 1: Subscribers table — wrong data model

**Current plan (WRONG):**
```typescript
subscribers { id, hubId, phoneNumber, channel, active, token, metadata }
```
One row per subscriber, one channel field, boolean active.

**Actual DO storage (CORRECT):**
```typescript
subscribers {
  id, identifierHash,       // HMAC hash, not plaintext phone
  channels: [{type, verified}],   // ARRAY — multiple channels per subscriber
  tags: string[],
  language: string | null,
  status: 'active' | 'paused' | 'unsubscribed',  // NOT boolean
  doubleOptInConfirmed: boolean,
  subscribedAt: number,
  preferenceToken: string,    // For unsubscribe links
}
```

**Correction:**
- [x] Rename `phoneNumber` → `identifierHash` (HMAC hash, not plaintext)
- [x] Replace `channel` → `channels` JSONB array OR create junction table `subscriber_channels(subscriberId, channelType, verified)`
- [x] Replace `active: boolean` → `status: 'active' | 'paused' | 'unsubscribed'` enum
- [x] Add `tags TEXT[]` column (or JSONB array)
- [x] Add `language VARCHAR(10) NULLABLE` column
- [x] Add `doubleOptInConfirmed BOOLEAN NOT NULL DEFAULT FALSE` column
- [x] Add `subscribedAt TIMESTAMPTZ NOT NULL DEFAULT NOW()` column
- [x] Add `preferenceToken VARCHAR(64) NOT NULL` column (used for opt-out URL tokens)
- [x] Add `hmacContext` note: identifierHash uses `HMAC_SUBSCRIBER` label from `crypto-labels.ts`
- [x] Run `bunx drizzle-kit generate` after fix

### Issue 2: Blasts table — missing targeting fields

**Current plan (WRONG):**
```typescript
blasts { id, hubId, name, channel, content, status, ... }
```
Single channel, no audience targeting.

**Actual DO storage (CORRECT):**
```typescript
blasts {
  id, name, content,
  targetChannels: string[],   // MULTI-CHANNEL
  targetTags: string[],       // Filter by subscriber tags
  targetLanguages: string[],  // Filter by subscriber language
  stats: {
    totalRecipients: number,
    sent: number,
    delivered: number,
    failed: number,
    optedOut: number
  }
}
```

**Correction:**
- [x] Replace `channel` → `targetChannels JSONB` (array of channel types)
- [x] Add `targetTags JSONB NOT NULL DEFAULT '[]'`
- [x] Add `targetLanguages JSONB NOT NULL DEFAULT '[]'`
- [x] Replace `stats` flat columns → `stats JSONB NOT NULL DEFAULT '{}'` with the structured shape above
- [x] Update Zod schema to match

### Issue 3: Missing `file_records` table

**ConversationDO stores:** Message attachments as `fileRecord:${fileId}` entries with fields:
```typescript
{ id, conversationId, messageId, filename, mimeType, size, storageKey, encryptedKey, uploadedAt, uploadedBy }
```

**Current plan:** No `file_records` table.

**Correction:**
- [x] Add `file_records` table to `src/server/db/schema/conversations.ts`:
  ```typescript
  fileRecords = pgTable('file_records', {
    id: varchar('id', { length: 64 }).primaryKey(),
    hubId: varchar('hub_id', { length: 64 }).notNull().references(() => hubs.id),
    conversationId: varchar('conversation_id', { length: 64 }).notNull(),
    messageId: varchar('message_id', { length: 64 }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 127 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 512 }).notNull(),  // MinIO/R2 key
    encryptedKey: text('encrypted_key').notNull(),  // ECIES-wrapped AES key
    uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
    uploadedBy: varchar('uploaded_by', { length: 64 }).notNull(),  // volunteer pubkey
  })
  ```

### Issue 4: Missing `blast_settings` table (or column)

**ConversationDO/BlastDO stores:** A singleton blast configuration with keywords for opt-in/opt-out, double opt-in message, etc.

**Current plan:** No table for this.

**Correction:**
- [x] Add `blastConfig JSONB NOT NULL DEFAULT '{}'` column to the hub settings table OR
- [x] Add separate `blast_settings` table (one row per hub):
  ```typescript
  blastSettings = pgTable('blast_settings', {
    hubId: varchar('hub_id', { length: 64 }).primaryKey().references(() => hubs.id),
    optInKeywords: jsonb('opt_in_keywords').notNull().default([]),
    optOutKeywords: jsonb('opt_out_keywords').notNull().default([]),
    doubleOptInEnabled: boolean('double_opt_in_enabled').notNull().default(false),
    doubleOptInMessage: text('double_opt_in_message'),
    welcomeMessage: text('welcome_message'),
    byeMessage: text('bye_message'),
  })
  ```

### Issue 5: Missing `context` field on `custom_field_definitions`

**SettingsDO stores:** `context` field on custom fields to distinguish call-notes vs conversation-notes vs reports.

**Current plan:** No `context` column.

**Correction:**
- [x] Add `context VARCHAR(32)` column to `custom_field_definitions`:
  - Values: `'notes'` | `'conversations'` | `'reports'` | `'all'`
  - Default: `'notes'`
- [x] Update Zod schema for `CustomFieldDefinition` to include `context`

### Issue 6: Missing `note_replies` table

**RecordsDO stores:** Note replies as `note-replies:${noteId}` arrays (Epic 123 placeholder).

**Current plan:** No `note_replies` table — Epic 123 deferred but schema needs placeholder.

**Correction:**
- [x] Add `note_replies` table to `src/server/db/schema/records.ts`:
  ```typescript
  noteReplies = pgTable('note_replies', {
    id: varchar('id', { length: 64 }).primaryKey(),
    hubId: varchar('hub_id', { length: 64 }).notNull(),
    parentNoteId: varchar('parent_note_id', { length: 64 }).notNull().references(() => notes.id),
    encryptedContent: text('encrypted_content').notNull(),
    authorEnvelope: text('author_envelope').notNull(),
    adminEnvelopes: jsonb('admin_envelopes').notNull().default([]),
    authorPubkey: varchar('author_pubkey', { length: 64 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  })
  ```
  This schema matches the encryption pattern of the parent note and is ready for Epic 123 implementation.

### Issue 7: Missing `volunteer_load` table

**ConversationDO stores:** Per-volunteer conversation load for auto-assignment balancing as `load:${pubkey}`.

**Current plan:** No `volunteer_load` table.

**Correction:**
- [x] Add `volunteer_load` table OR a `load` column to conversations assignment queries:
  - Simpler approach: `load` is computed by counting `WHERE assignedTo = pubkey AND status = 'open'`
  - If the DO uses a cached counter (not recomputed): add `volunteer_load(hubId, pubkey, activeCount)` table
  - **Recommended:** Use computed query (no separate table), remove legacy cached counter

---

## NEW TABLES NEEDED (From Other Specs)

These tables are referenced by other specs written in this session and must be added to Phase 1:

### GDPR tables (from `2026-03-22-gdpr-compliance-plan.md`)
- [x] `gdpr_consents(pubkey PK, consentVersion, consentedAt)`
- [x] `gdpr_erasure_requests(pubkey PK, requestedAt, executeAt, status)`
- [x] Add `retention_settings` JSONB column to hub settings

### Geocoding config (from `2026-03-22-geocoding-location-fields-plan.md`)
- [x] `geocoding_config` JSONB column on `settings` table (per-hub or global)

### Hub access control (from `2026-03-22-hub-admin-zero-trust-visibility-plan.md`)
- [x] `allow_super_admin_access BOOLEAN DEFAULT FALSE` on hub settings
- [x] `hub_key_envelopes(hubId, pubkey, wrappedKey, ephemeralPk, createdAt)` table

### Contact `identifierHash` hashing context
- [x] Document: `contactIdentifier` in conversations (caller's phone/identifier) is stored as `HMAC_PHONE_PREFIX` hash (from `crypto-labels.ts`) — server stores hash for matching ban lists, not plaintext

---

## Timestamp Consistency Fix

**Issue found:** DO code mixes ISO string timestamps (some entities) and millisecond unix numbers (other entities). Drizzle should standardize to `TIMESTAMPTZ` PostgreSQL type across all tables.

- [x] Ensure all `createdAt`, `updatedAt`, `expiresAt` columns are `timestamp('...').notNull()` in Drizzle (maps to `TIMESTAMPTZ`)
- [x] In migration data-loader: convert millisecond timestamps to `new Date(ms)` for PostgreSQL compatibility

---

## Updated Schema Coverage Table

After corrections, the migration should cover:

| DO | Tables | Completeness |
|---|---|---|
| IdentityDO | volunteers, sessions, webauthn_credentials, invites, provisioning_rooms, hub_memberships, gdpr_consents, gdpr_erasure_requests | 100% |
| SettingsDO | settings, custom_field_definitions (with context), telephony_config, spam_settings, ivr_languages, roles, role_assignments, blast_settings, geocoding_config, hub_key_envelopes, hub_access_settings | 100% |
| RecordsDO | notes, note_replies, calls, audit_log, bans, contacts | 100% |
| ShiftManagerDO | shifts, ring_groups, shift_volunteers | 100% |
| CallRouterDO | active_calls, call_records | 100% |
| ConversationDO | conversations, messages, file_records | 100% |
| BlastDO | blasts (corrected), subscribers (corrected), blast_deliveries | 100% |

---

## Coordination with Active Worktree

**Active worktree:** `.worktrees/cf-removal` on `feature/cf-removal-drizzle-migration`

- [x] Switch to the worktree: `cd ~/projects/llamenos-hotline/.worktrees/cf-removal`
- [x] Apply all schema corrections above to `src/server/db/schema/` files
- [x] Regenerate all migrations: `bunx drizzle-kit generate`
- [x] Run typecheck: `bun run typecheck`
- [x] Commit: `git commit -m "fix(schema): correct subscriber/blast models, add missing tables"`
- [x] These corrections must land BEFORE Phase 2 service classes are written
