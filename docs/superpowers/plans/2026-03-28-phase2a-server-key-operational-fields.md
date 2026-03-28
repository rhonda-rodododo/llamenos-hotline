# Phase 2A: Server-Key Operational Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-key encrypt audit log events/details, IVR audio data, and blast settings messages; drop hub slug column — so a seized database reveals nothing about organizational operations.

**Architecture:** Same Phase 1 pattern: `CryptoService.serverEncrypt()`/`serverDecrypt()` with domain-separated labels. Audit log hash chain computed on plaintext before encryption. No client-side changes except slug removal from hub creation UI.

**Tech Stack:** TypeScript, Drizzle ORM, CryptoService (from Phase 1), @noble/hashes (SHA-256 for audit chain)

**Spec:** `docs/superpowers/specs/2026-03-28-phase2a-server-key-operational-fields-design.md`

---

## File Map

### New files

None — all infrastructure exists from Phase 1.

### Modified files

| File | Changes |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_AUDIT_EVENT`, `LABEL_IVR_AUDIO` |
| `src/server/db/schema/records.ts` | Add `encryptedEvent`, `encryptedDetails` to audit_log |
| `src/server/db/schema/settings.ts` | Add `encryptedAudioData` to ivr_audio; drop `slug` from hubs; add encrypted columns to blast_settings (unused but ready) |
| `src/server/db/schema/blasts.ts` | Add encrypted columns to blast_settings |
| `src/server/services/records.ts` | Encrypt audit log event/details on write, decrypt on read |
| `src/server/services/settings.ts` | Encrypt IVR audio on write, decrypt on read |
| `src/server/lib/audit-hash.ts` | No changes — hash computed on plaintext before encryption |
| `src/server/routes/hubs.ts` | Remove slug from hub creation/response |
| `drizzle/migrations/` | New migration file |

---

## Task 1: New Crypto Labels

**Files:**
- Modify: `src/shared/crypto-labels.ts`

- [ ] **Step 1: Add Phase 2A labels**

Append to `src/shared/crypto-labels.ts`:

```typescript

// --- Field-Level Encryption (Phase 2A) ---

/** Server-key encryption of audit log events and details */
export const LABEL_AUDIT_EVENT = 'llamenos:audit-event:v1'

/** Server-key encryption of IVR audio prompt data */
export const LABEL_IVR_AUDIO = 'llamenos:ivr-audio:v1'

/** Server-key encryption of blast settings messages (welcome, bye, double opt-in) */
export const LABEL_BLAST_SETTINGS = 'llamenos:blast-settings:v1'
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/crypto-labels.ts
git commit -m "feat(crypto): add LABEL_AUDIT_EVENT, LABEL_IVR_AUDIO, LABEL_BLAST_SETTINGS labels"
```

---

## Task 2: Schema — Audit Log Encrypted Columns

**Files:**
- Modify: `src/server/db/schema/records.ts`

- [ ] **Step 1: Read the current audit_log definition**

Read `src/server/db/schema/records.ts` and find the `auditLog` table (around line 18). It currently has:
```typescript
event: text('event').notNull(),
details: jsonb<Record<string, unknown>>()('details').notNull().default({}),
```

- [ ] **Step 2: Add encrypted columns alongside plaintext**

Import `ciphertext` from `../crypto-columns` at the top of the file (it may already be imported from Phase 1). Add two new columns to the `auditLog` table:

```typescript
encryptedEvent: ciphertext('encrypted_event'),
encryptedDetails: ciphertext('encrypted_details'),
```

Both nullable during transition. `encryptedDetails` stores `JSON.stringify(details)` then encrypted — a single ciphertext blob, not JSONB.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/records.ts
git commit -m "feat(schema): add encrypted audit log columns"
```

---

## Task 3: Schema — IVR Audio Encrypted Column

**Files:**
- Modify: `src/server/db/schema/settings.ts`

- [ ] **Step 1: Read the current ivr_audio definition**

Read `src/server/db/schema/settings.ts` and find `ivrAudio` (around line 114). It currently has:
```typescript
audioData: text('audio_data').notNull(), // base64-encoded audio
```

- [ ] **Step 2: Add encrypted column**

Add to the `ivrAudio` table:

```typescript
encryptedAudioData: ciphertext('encrypted_audio_data'),
```

Nullable during transition.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/settings.ts
git commit -m "feat(schema): add encrypted IVR audio column"
```

---

## Task 4: Schema — Blast Settings Encrypted Columns

**Files:**
- Modify: `src/server/db/schema/blasts.ts`

- [ ] **Step 1: Read the current blast_settings definition**

Read `src/server/db/schema/blasts.ts` and find `blastSettings` (around line 87). It currently has:
```typescript
doubleOptInMessage: text('double_opt_in_message'),
welcomeMessage: text('welcome_message'),
byeMessage: text('bye_message'),
```

- [ ] **Step 2: Add encrypted columns**

Import `ciphertext` from `../crypto-columns`. Add:

```typescript
encryptedDoubleOptInMessage: ciphertext('encrypted_double_opt_in_message'),
encryptedWelcomeMessage: ciphertext('encrypted_welcome_message'),
encryptedByeMessage: ciphertext('encrypted_bye_message'),
```

All nullable.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/blasts.ts
git commit -m "feat(schema): add encrypted blast settings columns"
```

---

## Task 5: Schema — Drop Hub Slug

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Modify: `src/server/routes/hubs.ts`

- [ ] **Step 1: Read hub creation route**

Read `src/server/routes/hubs.ts` to find where `slug` is used. It's generated from the hub name during creation (around line 46) and returned in responses.

- [ ] **Step 2: Remove slug from hubs schema**

In `src/server/db/schema/settings.ts`, remove the `slug` field from the `hubs` table:
```typescript
// REMOVE this line:
slug: text('slug').notNull().default(''),
```

- [ ] **Step 3: Remove slug from hub routes**

In `src/server/routes/hubs.ts`:
- Remove slug generation logic in POST handler (the `slug: body.slug?.trim() || ...` block)
- Remove `slug` from response objects
- Search for any other references to `slug` in hub-related code

Also check `src/server/routes/auth.ts` — it returns `primaryRole.slug` in the auth response. Role slugs will be handled in Phase 2B; for now, just remove the hub slug.

- [ ] **Step 4: Fix TypeScript errors**

Run `npx tsc --noEmit` and fix any remaining references to `hubs.slug` or `hubData.slug`.

- [ ] **Step 5: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/settings.ts src/server/routes/hubs.ts
git commit -m "feat(schema): drop hub slug column, use hub ID for routing"
```

---

## Task 6: Generate and Apply Drizzle Migration

**Files:**
- Create: `drizzle/migrations/0023_phase2a_operational_fields.sql`

- [ ] **Step 1: Hand-write the migration SQL**

Create `drizzle/migrations/0023_phase2a_operational_fields.sql`:

```sql
-- Phase 2A: Add encrypted columns for operational fields

-- Audit log
ALTER TABLE audit_log ADD COLUMN encrypted_event text;
ALTER TABLE audit_log ADD COLUMN encrypted_details text;

-- IVR audio
ALTER TABLE ivr_audio ADD COLUMN encrypted_audio_data text;

-- Blast settings
ALTER TABLE blast_settings ADD COLUMN encrypted_double_opt_in_message text;
ALTER TABLE blast_settings ADD COLUMN encrypted_welcome_message text;
ALTER TABLE blast_settings ADD COLUMN encrypted_bye_message text;

-- Drop hub slug
ALTER TABLE hubs DROP COLUMN IF EXISTS slug;
```

- [ ] **Step 2: Generate Drizzle snapshot**

Run `npx drizzle-kit generate` to create the snapshot JSON for the new schema state. If it produces a conflicting migration, delete its SQL file and keep our hand-written one. Update the `_journal.json` to include the new entry.

- [ ] **Step 3: Apply migration**

Start the server briefly to apply migrations: `PORT=3099 USE_TEST_ADAPTER=true timeout 10 bun run src/server/server.ts 2>&1 | head -5`

Or apply directly: check if the DB is accessible and run the SQL manually via `docker exec`.

- [ ] **Step 4: Commit**

```bash
git add drizzle/
git commit -m "migration: add Phase 2A encrypted columns, drop hub slug"
```

---

## Task 7: Service — Encrypt Audit Log

**Files:**
- Modify: `src/server/services/records.ts`

- [ ] **Step 1: Read the current addAuditEntry method**

Read `src/server/services/records.ts` and find `addAuditEntry` (around line 478). It currently:
1. Gets the previous entry's hash
2. Computes `hashAuditEntry()` on the plaintext event + details
3. Inserts the row with plaintext `event` and `details`

- [ ] **Step 2: Add encryption to addAuditEntry**

After computing the hash chain (which must operate on plaintext), encrypt the event and details before storing:

```typescript
import { LABEL_AUDIT_EVENT } from '@shared/crypto-labels'

// In addAuditEntry, AFTER computing entryHash:
const encryptedEvent = this.crypto.serverEncrypt(event, LABEL_AUDIT_EVENT)
const encryptedDetails = this.crypto.serverEncrypt(JSON.stringify(details ?? {}), LABEL_AUDIT_EVENT)

// Add to the insert values:
encryptedEvent,
encryptedDetails,
```

The plaintext `event` and `details` columns still get written during transition. They'll be dropped in Phase 2C.

- [ ] **Step 3: Add decryption to getAuditLog**

In the `getAuditLog` method, add decryption with plaintext fallback:

```typescript
// For each row in the result:
const event = row.encryptedEvent
  ? this.crypto.serverDecrypt(row.encryptedEvent as Ciphertext, LABEL_AUDIT_EVENT)
  : row.event

const details = row.encryptedDetails
  ? JSON.parse(this.crypto.serverDecrypt(row.encryptedDetails as Ciphertext, LABEL_AUDIT_EVENT))
  : row.details
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/services/records.ts
git commit -m "feat(crypto): encrypt audit log event and details with server-key"
```

---

## Task 8: Service — Encrypt IVR Audio

**Files:**
- Modify: `src/server/services/settings.ts`

- [ ] **Step 1: Read the IVR audio methods**

Read `src/server/services/settings.ts` and find `getIvrAudio` (around line 403), `upsertIvrAudio` (around line 430), and `getIvrAudioList` (around line 390).

- [ ] **Step 2: Encrypt on write**

In `upsertIvrAudio`, encrypt the audio data before storing:

```typescript
import { LABEL_IVR_AUDIO } from '@shared/crypto-labels'

// In upsertIvrAudio:
const encryptedAudioData = this.crypto.serverEncrypt(entry.audioData, LABEL_IVR_AUDIO)
// Add encryptedAudioData to the insert/update values
```

- [ ] **Step 3: Decrypt on read**

In `getIvrAudio`, decrypt with plaintext fallback:

```typescript
const audioData = row.encryptedAudioData
  ? this.crypto.serverDecrypt(row.encryptedAudioData as Ciphertext, LABEL_IVR_AUDIO)
  : row.audioData
```

`getIvrAudioList` doesn't return audio data (only metadata), so no changes needed there.

- [ ] **Step 4: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/services/settings.ts
git commit -m "feat(crypto): encrypt IVR audio data with server-key"
```

---

## Task 9: Drop Plaintext Columns

**Files:**
- Modify: `src/server/db/schema/records.ts` — remove `event`, `details` from audit_log
- Modify: `src/server/db/schema/settings.ts` — remove `audioData` from ivr_audio
- Modify: `src/server/db/schema/blasts.ts` — remove plaintext blast settings columns
- Modify: `src/server/services/records.ts` — remove dual-read fallback
- Modify: `src/server/services/settings.ts` — remove dual-read fallback
- Create: `drizzle/migrations/0024_phase2a_drop_plaintext.sql`

- [ ] **Step 1: Remove plaintext columns from schema**

In `records.ts` audit_log table:
- Remove `event: text('event').notNull()`
- Remove `details: jsonb<Record<string, unknown>>()('details').notNull().default({})`
- Make `encryptedEvent` NOT NULL
- Make `encryptedDetails` NOT NULL

In `settings.ts` ivr_audio table:
- Remove `audioData: text('audio_data').notNull()`
- Make `encryptedAudioData` NOT NULL

In `blasts.ts` blast_settings table:
- Remove `doubleOptInMessage`, `welcomeMessage`, `byeMessage`
- Encrypted versions stay nullable (optional fields)

- [ ] **Step 2: Remove dual-read fallback from services**

In `records.ts` `getAuditLog`:
```typescript
// Replace:
const event = row.encryptedEvent ? ... : row.event
// With:
const event = this.crypto.serverDecrypt(row.encryptedEvent, LABEL_AUDIT_EVENT)
```

Same for IVR audio in `settings.ts`.

- [ ] **Step 3: Fix TypeScript errors**

Run `npx tsc --noEmit` and fix any remaining references to dropped columns.

- [ ] **Step 4: Write migration**

Create `drizzle/migrations/0024_phase2a_drop_plaintext.sql`:

```sql
-- Phase 2A: Drop plaintext operational fields

ALTER TABLE audit_log DROP COLUMN event;
ALTER TABLE audit_log DROP COLUMN details;
ALTER TABLE audit_log ALTER COLUMN encrypted_event SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN encrypted_details SET NOT NULL;

ALTER TABLE ivr_audio DROP COLUMN audio_data;
ALTER TABLE ivr_audio ALTER COLUMN encrypted_audio_data SET NOT NULL;

ALTER TABLE blast_settings DROP COLUMN double_opt_in_message;
ALTER TABLE blast_settings DROP COLUMN welcome_message;
ALTER TABLE blast_settings DROP COLUMN bye_message;
```

Update `drizzle/migrations/meta/_journal.json` and generate snapshot.

- [ ] **Step 5: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(crypto): drop plaintext operational fields, encrypted-only reads"
```

---

## Task 10: API Tests Verification

**Files:** None (verification only)

- [ ] **Step 1: Start server and run API tests**

```bash
# Reset DB for clean migrations
docker exec llamenos-postgres-1 psql -U llamenos -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='llamenos' AND pid <> pg_backend_pid();"
docker exec llamenos-postgres-1 psql -U llamenos -d postgres -c "DROP DATABASE llamenos;"
docker exec llamenos-postgres-1 psql -U llamenos -d postgres -c "CREATE DATABASE llamenos;"

# Start server
PORT=3099 USE_TEST_ADAPTER=true bun run src/server/server.ts &

# Wait for startup
sleep 5

# Run API tests
PLAYWRIGHT_BASE_URL=http://localhost:3099 npx playwright test --project=api
```

- [ ] **Step 2: Fix any failures**

If audit-related tests fail, check that `hashAuditEntry` still receives plaintext values (computed before encryption). If IVR tests fail, check that audio data round-trips correctly through encrypt/decrypt.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(crypto): resolve Phase 2A API test failures"
```
