# Phase 2B: Hub-Key E2EE Organizational Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub-key encrypt all organizational metadata (hub names, role names, custom fields, report types, shift/ring group names, blast names) so a seized database reveals nothing about what the organization does or how it's structured. The server stores opaque ciphertext — clients encrypt with the hub key before sending, and decrypt after key unlock.

**Architecture:** Client encrypts with `encryptForHub(plaintext, hubKey)` from `hub-key-manager.ts` before API calls. Server stores ciphertext directly in `ciphertext()` typed columns (pass-through, no server-side encrypt/decrypt). Client decrypts with `decryptFromHub(ciphertext, hubKey)` using cached hub key from `hub-key-cache.ts`. During transition, server writes both plaintext and encrypted; after Phase 2C drops plaintext, server is pure pass-through.

**Tech Stack:** TypeScript, Drizzle ORM, XChaCha20-Poly1305 (hub-key symmetric), React client components, `hub-key-manager.ts`, `hub-key-cache.ts`

**Spec:** `docs/superpowers/specs/2026-03-28-phase2b-e2ee-organizational-metadata-design.md`

---

## File Map

### Modified files — Schema (8 tables)

| File | Changes |
|---|---|
| `src/server/db/schema/settings.ts` | Add encrypted columns to hubs, roles, custom_field_definitions, report_categories |
| `src/server/db/schema/report-types.ts` | Add encrypted columns to report_types |
| `src/server/db/schema/shifts.ts` | Add encrypted columns to shift_schedules, ring_groups |
| `src/server/db/schema/blasts.ts` | Add encrypted column to blasts (name) |

### Modified files — Services

| File | Changes |
|---|---|
| `src/server/services/settings.ts` | Hub CRUD: accept + return encrypted name/description; Role CRUD: accept + return encrypted name/description; Custom field CRUD: accept + return encrypted field_name/label/options; Report categories: accept + return encrypted |
| `src/server/services/shifts.ts` | Shift CRUD: accept + return encrypted name; Ring group CRUD: accept + return encrypted name |
| `src/server/services/blasts.ts` | Blast CRUD: accept + return encrypted name |
| `src/server/services/records.ts` | Report type service methods that reference report type name |

### Modified files — API Routes

| File | Changes |
|---|---|
| `src/server/routes/hubs.ts` | Accept encryptedName/Description from client, return ciphertext |
| `src/server/routes/settings.ts` | Roles, custom fields, report categories routes |
| `src/server/routes/reports.ts` | Report types routes |
| `src/server/routes/shifts.ts` | Shift and ring group routes |
| `src/server/routes/blasts.ts` | Blast name in routes |

### Modified files — Client

| File | Changes |
|---|---|
| `src/client/components/hub-switcher.tsx` | Decrypt hub names with hub key |
| `src/client/components/admin-settings/roles-section.tsx` | Encrypt/decrypt role names |
| `src/client/components/admin-settings/custom-fields-section.tsx` | Encrypt/decrypt field definitions |
| `src/client/components/admin-settings/report-types-section.tsx` | Encrypt/decrypt report type names |
| `src/client/routes/shifts.tsx` | Encrypt/decrypt shift names |
| `src/client/routes/blasts.tsx` | Encrypt/decrypt blast names |
| `src/client/routes/admin/hubs.tsx` | Encrypt on hub create, decrypt names |

---

## Task 1: Schema — Add Encrypted Columns to All 8 Tables

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Modify: `src/server/db/schema/report-types.ts`
- Modify: `src/server/db/schema/shifts.ts`
- Modify: `src/server/db/schema/blasts.ts`

- [ ] **Step 1: Read all four schema files** to understand current definitions.

- [ ] **Step 2: Add encrypted columns to each table**

`settings.ts` — hubs table: add `encryptedName: ciphertext('encrypted_name')`, `encryptedDescription: ciphertext('encrypted_description')`

`settings.ts` — roles table: add `encryptedName: ciphertext('encrypted_name')`, `encryptedDescription: ciphertext('encrypted_description')`

`settings.ts` — customFieldDefinitions table: add `encryptedFieldName: ciphertext('encrypted_field_name')`, `encryptedLabel: ciphertext('encrypted_label')`, `encryptedOptions: ciphertext('encrypted_options')`

`settings.ts` — reportCategories table: add `encryptedCategories: ciphertext('encrypted_categories')`

`report-types.ts` — reportTypes table: add `encryptedName: ciphertext('encrypted_name')`, `encryptedDescription: ciphertext('encrypted_description')`

`shifts.ts` — shiftSchedules table: add `encryptedName: ciphertext('encrypted_name')`

`shifts.ts` — ringGroups table: add `encryptedName: ciphertext('encrypted_name')`

`blasts.ts` — blasts table: add `encryptedName: ciphertext('encrypted_name')`

All new columns are NULLABLE during transition. Import `ciphertext` from `../crypto-columns` where not already imported.

- [ ] **Step 3: Generate migration**

Hand-write `drizzle/migrations/0026_phase2b_org_metadata.sql`:

```sql
-- Phase 2B: Add encrypted columns for organizational metadata

-- Hubs
ALTER TABLE hubs ADD COLUMN encrypted_name text;
ALTER TABLE hubs ADD COLUMN encrypted_description text;

-- Roles
ALTER TABLE roles ADD COLUMN encrypted_name text;
ALTER TABLE roles ADD COLUMN encrypted_description text;

-- Custom field definitions
ALTER TABLE custom_field_definitions ADD COLUMN encrypted_field_name text;
ALTER TABLE custom_field_definitions ADD COLUMN encrypted_label text;
ALTER TABLE custom_field_definitions ADD COLUMN encrypted_options text;

-- Report categories
ALTER TABLE report_categories ADD COLUMN encrypted_categories text;

-- Report types
ALTER TABLE report_types ADD COLUMN encrypted_name text;
ALTER TABLE report_types ADD COLUMN encrypted_description text;

-- Shift schedules
ALTER TABLE shift_schedules ADD COLUMN encrypted_name text;

-- Ring groups
ALTER TABLE ring_groups ADD COLUMN encrypted_name text;

-- Blasts
ALTER TABLE blasts ADD COLUMN encrypted_name text;
```

Update `_journal.json` and generate snapshot.

- [ ] **Step 4: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/ drizzle/
git commit -m "feat(schema): add encrypted columns for org metadata (8 tables, Phase 2B)"
```

---

## Task 2: Services — Hub CRUD (Server-Side Transition Writes)

**Files:**
- Modify: `src/server/services/settings.ts`

During transition, the server writes BOTH plaintext and encrypted columns. The server hub-key encrypts for now (using `this.crypto.hubEncrypt()` with the hub key obtained via `this.crypto.unwrapHubKey()`). After client-side encryption is deployed (Task 5+), new writes will come pre-encrypted from the client.

- [ ] **Step 1: Read SettingsService hub methods**

Find `createHub`, `updateHub`, `getHubs`, `getHub`, and `#rowToHub` methods.

- [ ] **Step 2: Add hub-key encryption to hub writes**

In `createHub`: after creating the hub and its hub key, encrypt the name and description with the hub key:

```typescript
// After hub is created and hub key exists:
const hubKeyEnvelopes = await this.db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
if (hubKeyEnvelopes.length > 0) {
  const hubKey = this.crypto.unwrapHubKey(hubKeyEnvelopes)
  const encryptedName = this.crypto.hubEncrypt(name, hubKey)
  const encryptedDescription = description ? this.crypto.hubEncrypt(description, hubKey) : null
  await this.db.update(hubs).set({ encryptedName, encryptedDescription }).where(eq(hubs.id, hubId))
}
```

In `updateHub`: same pattern — encrypt updated fields.

In `#rowToHub` or read methods: return BOTH plaintext and encrypted fields for now. The client uses whichever is available.

- [ ] **Step 3: Apply same pattern to roles, custom fields, report categories**

For each entity type in SettingsService:
- Writes: hub-key encrypt the name/description/label/options fields, store in encrypted columns
- Reads: return both plaintext (fallback) and encrypted fields

- [ ] **Step 4: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/services/settings.ts
git commit -m "feat(crypto): hub-key encrypt org metadata in SettingsService"
```

---

## Task 3: Services — Shifts, Ring Groups, Blasts

**Files:**
- Modify: `src/server/services/shifts.ts`
- Modify: `src/server/services/blasts.ts`

- [ ] **Step 1: Read ShiftService and BlastService**

Find CRUD methods for shift schedules, ring groups, and blasts.

- [ ] **Step 2: Add hub-key encryption to shift and ring group writes**

Same pattern as Task 2: get hub key for the row's hubId, encrypt name, store alongside plaintext.

For shifts, the hub key is fetched from the `hub_keys` table for the shift's hub.

- [ ] **Step 3: Add hub-key encryption to blast name writes**

Blasts already have `encryptedContent` (E2EE for the message body). Now add `encryptedName` for the campaign name.

- [ ] **Step 4: Update reads to return both plaintext and encrypted fields**

- [ ] **Step 5: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server/services/shifts.ts src/server/services/blasts.ts
git commit -m "feat(crypto): hub-key encrypt shift, ring group, and blast names"
```

---

## Task 4: Services — Report Types

**Files:**
- Modify: `src/server/services/records.ts` (or wherever ReportTypeService is)

- [ ] **Step 1: Find ReportTypeService**

Check `src/server/services/` for the report type service. It may be in its own file or in records.ts.

- [ ] **Step 2: Add hub-key encryption to report type writes**

Encrypt `name` and `description` with hub key, store in encrypted columns.

- [ ] **Step 3: Update reads to return both plaintext and encrypted fields**

- [ ] **Step 4: Run tests**

Run: `bun test src/server`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/services/
git commit -m "feat(crypto): hub-key encrypt report type names and descriptions"
```

---

## Task 5: API Routes — Accept and Return Encrypted Fields

**Files:**
- Modify: `src/server/routes/hubs.ts`
- Modify: `src/server/routes/settings.ts`
- Modify: `src/server/routes/reports.ts`
- Modify: `src/server/routes/shifts.ts`
- Modify: `src/server/routes/blasts.ts`

- [ ] **Step 1: Update hub routes**

In POST/PUT handlers, accept `encryptedName` and `encryptedDescription` from the client. If provided, pass them through to the service. If not provided (legacy client), the service handles server-side encryption.

In GET responses, include both `name` (plaintext, fallback) and `encryptedName` (ciphertext) for transition.

- [ ] **Step 2: Update role, custom field, report category routes**

Same pattern — accept encrypted fields, return both.

- [ ] **Step 3: Update report type, shift, ring group, blast routes**

Same pattern.

- [ ] **Step 4: Run API tests**

```bash
lsof -ti:3099 | xargs kill -9 2>/dev/null
docker exec llamenos-postgres-1 psql -U llamenos -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='llamenos' AND pid <> pg_backend_pid();"
docker exec llamenos-postgres-1 psql -U llamenos -d postgres -c "DROP DATABASE llamenos;"
docker exec llamenos-postgres-1 psql -U llamenos -d postgres -c "CREATE DATABASE llamenos;"
PORT=3099 USE_TEST_ADAPTER=true bun run src/server/server.ts &>/tmp/llamenos-server.log &
sleep 6
PLAYWRIGHT_BASE_URL=http://localhost:3099 npx playwright test --project=api
lsof -ti:3099 | xargs kill -9 2>/dev/null
```

Expected: All API tests pass (services return plaintext in `name` field for backward compatibility).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/
git commit -m "feat(crypto): API routes accept and return encrypted org metadata"
```

---

## Task 6: Client — Hub Name Decryption

**Files:**
- Modify: `src/client/components/hub-switcher.tsx`
- Modify: `src/client/routes/admin/hubs.tsx`

- [ ] **Step 1: Read hub-switcher.tsx**

Understand how hub names are currently displayed.

- [ ] **Step 2: Add hub-key decryption**

Import `getHubKeyForId` from `../lib/hub-key-cache` and `decryptFromHub` from `../lib/hub-key-manager`.

For each hub in the list, try to decrypt `encryptedName`:

```typescript
function decryptHubName(hub: Hub): string {
  if (!hub.encryptedName) return hub.name ?? `Hub ${hub.id.slice(0, 8)}`
  const hubKey = getHubKeyForId(hub.id)
  if (!hubKey) return `Hub ${hub.id.slice(0, 8)}`  // Not yet unlocked
  return decryptFromHub(hub.encryptedName, hubKey) ?? `Hub ${hub.id.slice(0, 8)}`
}
```

Replace all `hub.name` displays with `decryptHubName(hub)`.

- [ ] **Step 3: Update hub creation form**

In `hubs.tsx` admin page, when creating a hub, encrypt the name before sending:

```typescript
const hubKey = getHubKeyForId(hubId) // After hub is created, the key exists
// Actually, for NEW hubs, the hub key doesn't exist yet when creating.
// The server creates the hub + hub key simultaneously.
// So for creation, send plaintext — the server encrypts server-side (transition).
// After creation, future updates send encrypted.
```

For hub updates: encrypt name with hub key before PUT.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/hub-switcher.tsx src/client/routes/admin/hubs.tsx
git commit -m "feat(client): decrypt hub names with hub key, encrypt on update"
```

---

## Task 7: Client — Role, Custom Field, Report Type Decryption

**Files:**
- Modify: `src/client/components/admin-settings/roles-section.tsx`
- Modify: `src/client/components/admin-settings/custom-fields-section.tsx`
- Modify: `src/client/components/admin-settings/report-types-section.tsx`

- [ ] **Step 1: Add decryption to roles section**

Read `roles-section.tsx`. For each role displayed, decrypt `encryptedName` and `encryptedDescription` with the active hub key:

```typescript
import { getHubKeyForId } from '../../lib/hub-key-cache'
import { decryptFromHub, encryptForHub } from '../../lib/hub-key-manager'
import { useConfig } from '../../lib/config'

// In component:
const { activeHubId } = useConfig()
const hubKey = activeHubId ? getHubKeyForId(activeHubId) : null

function decryptField(encrypted: string | null): string | null {
  if (!encrypted || !hubKey) return null
  return decryptFromHub(encrypted, hubKey)
}

// Display:
const roleName = decryptField(role.encryptedName) ?? role.name ?? 'Encrypted'
```

For role creation/editing forms: encrypt name and description before sending to API.

- [ ] **Step 2: Add decryption to custom fields section**

Same pattern for field_name, label, and options. Options is a JSON-stringified array — decrypt then parse:

```typescript
const options = decryptField(field.encryptedOptions)
  ? JSON.parse(decryptField(field.encryptedOptions)!)
  : field.options
```

For form submission: JSON.stringify options, encrypt, then send.

- [ ] **Step 3: Add decryption to report types section**

Same pattern for name and description.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/admin-settings/
git commit -m "feat(client): decrypt roles, custom fields, report types with hub key"
```

---

## Task 8: Client — Shift, Ring Group, Blast Name Decryption

**Files:**
- Modify: `src/client/routes/shifts.tsx`
- Modify: `src/client/routes/blasts.tsx`

- [ ] **Step 1: Add decryption to shifts page**

Decrypt `encryptedName` for each shift schedule and ring group.

For shift/ring group creation forms: encrypt name before sending.

- [ ] **Step 2: Add decryption to blasts page**

Blast name decryption alongside the existing blast content decryption.

For blast creation: encrypt name before sending.

- [ ] **Step 3: Commit**

```bash
git add src/client/routes/shifts.tsx src/client/routes/blasts.tsx
git commit -m "feat(client): decrypt shift, ring group, blast names with hub key"
```

---

## Task 9: Drop Plaintext Columns + Remove Fallbacks

**Files:**
- Modify: all schema files from Task 1
- Modify: all service files from Tasks 2-4
- Modify: all route files from Task 5
- Modify: all client files from Tasks 6-8
- Create: `drizzle/migrations/0027_phase2b_drop_plaintext.sql`

- [ ] **Step 1: Remove plaintext columns from schema**

Drop `name`, `description` from hubs; `name`, `slug`, `description` from roles; `field_name`, `label`, `options` from custom_field_definitions; `categories` from report_categories; `name`, `description` from report_types; `name` from shift_schedules, ring_groups, blasts.

Make encrypted columns NOT NULL where appropriate (see spec for which stay nullable).

- [ ] **Step 2: Remove plaintext fallbacks from services and client**

All `role.name ?? 'Encrypted'` fallbacks become just the decrypted value. Services no longer return plaintext fields.

- [ ] **Step 3: Write migration SQL**

```sql
-- Phase 2B: Drop plaintext org metadata columns

ALTER TABLE hubs DROP COLUMN name, DROP COLUMN description;
ALTER TABLE hubs ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE roles DROP COLUMN name, DROP COLUMN slug, DROP COLUMN description;
ALTER TABLE roles ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE custom_field_definitions DROP COLUMN field_name, DROP COLUMN label, DROP COLUMN options;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_field_name SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_label SET NOT NULL;

ALTER TABLE report_categories DROP COLUMN categories;

ALTER TABLE report_types DROP COLUMN name, DROP COLUMN description;
ALTER TABLE report_types ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE shift_schedules DROP COLUMN name;
ALTER TABLE shift_schedules ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE ring_groups DROP COLUMN name;
ALTER TABLE ring_groups ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE blasts DROP COLUMN name;
ALTER TABLE blasts ALTER COLUMN encrypted_name SET NOT NULL;
```

- [ ] **Step 4: Fix TypeScript errors, run tests**

Run: `npx tsc --noEmit` then `bun test src/server`
Expected: All pass

- [ ] **Step 5: Run API tests**

Reset DB, start server, run playwright API tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(crypto): drop plaintext org metadata, hub-key E2EE only"
```

---

## Task 10: UI Flow — Move Hub Switcher After PIN Unlock

**Files:**
- Modify: `src/client/components/hub-switcher.tsx` or parent layout
- Modify: `src/client/lib/config.tsx` or auth flow

- [ ] **Step 1: Identify where hub data loads pre-authentication**

Read the client auth flow. The hub list may load via `/api/config` before the user enters their PIN. After encryption, hub names are ciphertext — they need the hub key (which requires PIN unlock) to display.

- [ ] **Step 2: Show placeholder before key unlock**

If hub key is not available (user hasn't entered PIN), show a loading state instead of hub names:

```typescript
// In hub-switcher.tsx:
const hubKey = getHubKeyForId(hub.id)
const hubName = hubKey && hub.encryptedName
  ? decryptFromHub(hub.encryptedName, hubKey)
  : null

// Display:
{hubName ?? <Skeleton className="h-4 w-24" />}
```

- [ ] **Step 3: Verify the flow**

After PIN unlock → hub keys load → hub names decrypt → switcher updates. This should happen automatically if the component re-renders when hub keys become available.

- [ ] **Step 4: Commit**

```bash
git add src/client/
git commit -m "feat(client): show hub name placeholders until key unlock"
```
