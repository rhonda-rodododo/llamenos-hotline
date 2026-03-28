# Field-Level Encryption Phase 2B: E2EE Organizational Metadata (Hub-Key)

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Hub-key E2EE encryption of all organizational metadata — hub names, role definitions, custom field definitions, report types, shift/ring group names, blast campaign names. Full-stack: schema + API + client components + UI flow changes.
**Prerequisite:** Phase 1 complete, Phase 2A complete (or parallel)
**Threat model:** Nation-state adversaries. A seized database must not reveal what the organization does, how it's structured, what it tracks, or what its teams are called. A compromised server secret alone is insufficient to decrypt — the attacker also needs the hub key envelope from the database, making these fields resistant to partial infrastructure compromise.

## Problem

After Phase 1 (identity) and Phase 2A (operational), the database still contains organizational intelligence in plaintext:

| Table | Plaintext Fields | Adversary Value |
|---|---|---|
| `hubs` | `name`, `description` | **CRITICAL** — "Legal Observer Network", "Protest Response Team" reveals org purpose |
| `roles` | `name`, `description` | **HIGH** — "Field Medic", "Legal Liaison" reveals org capabilities |
| `custom_field_definitions` | `field_name`, `label`, `options` | **HIGH** — "Immigration Status", "Ethnicity" reveals what data the org collects |
| `report_types` | `name`, `description` | **HIGH** — "Police Violence", "ICE Raid" reveals what the org monitors |
| `report_categories` | `categories` | **HIGH** — same as report types |
| `shift_schedules` | `name` | **MEDIUM** — "Night Watch", "Rally Coverage" reveals operational patterns |
| `ring_groups` | `name` | **MEDIUM** — "Legal Team", "Crisis Response" reveals team structure |
| `blasts` | `name` | **MEDIUM** — "March Alert", "Bail Fund Update" reveals campaign strategy |

## Goals

1. **Hub-key E2EE** — all organizational metadata encrypted with the hub's symmetric key; the server stores opaque ciphertext
2. **Client-side encryption on write** — admin client encrypts metadata with hub key before sending to API
3. **Client-side decryption on read** — client decrypts using `ClientCryptoService.hubDecrypt()` after PIN unlock
4. **UI flow change** — organizational metadata is only visible after PIN unlock; pre-unlock screens show loading placeholders
5. **Hub-scoped isolation** — each hub's metadata is encrypted with its own key; compromising one hub's key reveals nothing about other hubs

## Non-Goals

- Encrypting structural metadata (hub IDs, timestamps, boolean flags, foreign keys)
- Encrypting fields the server must process at runtime (blast settings messages, IVR audio, audit events — Phase 2A)
- Full ECIES envelope encryption per-member (hub-key symmetric encryption is the right model for data all members read)

## Design

### Why Hub-Key, Not Server-Key

The hub key provides two security properties server-key doesn't:

1. **Two-secret requirement** — decryption requires BOTH `SERVER_NOSTR_SECRET` (to derive server keypair) AND the hub_keys DB row (to unwrap the hub key). Server-key only needs one secret. A leaked `SERVER_NOSTR_SECRET` without DB access reveals nothing. A DB dump without the server secret reveals nothing.

2. **Hub isolation** — each hub has its own key. Compromising hub A's key reveals nothing about hub B's metadata. Server-key encryption uses a single derived key for everything.

3. **Client-native** — the hub key is already distributed to all hub members via ECIES envelopes in `hub_keys`. Clients already have `hubDecrypt()`. No new crypto infrastructure needed.

### Encryption Flow

**Write (admin creates/edits metadata):**
```
Admin client
  → hubKey = ClientCryptoService.hubDecrypt(hubKeyEnvelope) // from hub_keys table
  → ciphertext = ClientCryptoService.hubEncrypt(name, hubKey)
  → POST /api/hubs { encryptedName: ciphertext }
  → Server stores ciphertext directly (never sees plaintext)
```

**Read (any hub member):**
```
Client requests GET /api/hubs
  → Server returns { encryptedName: "ab12cd..." }
  → hubKey = ClientCryptoService.hubDecrypt(hubKeyEnvelope) // cached after unlock
  → name = ClientCryptoService.hubDecrypt(encryptedName, hubKey)
  → Component renders decrypted name
```

**Server-side fallback (for server operations that need hub names):**
The server CAN decrypt via `unwrapHubKeyForServer()` when absolutely needed (e.g., logging, debugging). But in normal operation, it stores and returns ciphertext without decrypting. This is "E2EE by default, server-decryptable as escape hatch."

### Schema Changes

Each table gets an encrypted companion column. Same pattern as Phase 1:

#### `hubs` (settings.ts)

```typescript
export const hubs = pgTable('hubs', {
  id: text('id').primaryKey(),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description'),
  // REMOVED: name, description, slug
  status: text('status').notNull().default('active'),
  phoneNumber: text('phone_number'),     // Public hotline number — plaintext OK
  createdBy: text('created_by').notNull().default(''),
  allowSuperAdminAccess: boolean('allow_super_admin_access').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`slug` is dropped entirely — Phase 2A replaces slug routing with hub ID routing.

#### `roles` (settings.ts)

```typescript
export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  hubId: text('hub_id'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description').notNull().default('' as Ciphertext),
  // REMOVED: name, slug, description
  // slug dropped — custom slugs like 'legal-liaison' reveal org structure
  // permission checks use role ID, not slug; system roles identified by isDefault flag
  permissions: jsonb<string[]>()('permissions').notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

#### `custom_field_definitions` (settings.ts)

```typescript
export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: text('id').primaryKey(),
  hubId: text('hub_id'),
  encryptedFieldName: ciphertext('encrypted_field_name').notNull(),
  encryptedLabel: ciphertext('encrypted_label').notNull(),
  fieldType: text('field_type').notNull(),  // Structural type, not content — stays plaintext
  encryptedOptions: ciphertext('encrypted_options').notNull().default('' as Ciphertext),
  // REMOVED: field_name, label, options
  required: boolean('required').notNull().default(false),
  showInVolunteerView: boolean('show_in_volunteer_view').notNull().default(false),
  context: text('context').notNull().default('notes'),
  reportTypeIds: jsonb<string[]>()('report_type_ids').notNull().default([]),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

#### `report_types` (report-types.ts)

```typescript
export const reportTypes = pgTable('report_types', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description'),
  // REMOVED: name, description
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

#### `report_categories` (settings.ts)

```typescript
export const reportCategories = pgTable('report_categories', {
  hubId: text('hub_id').primaryKey().default('global'),
  encryptedCategories: ciphertext('encrypted_categories').notNull().default('' as Ciphertext),
  // REMOVED: categories
  // Categories array is JSON.stringify'd then hub-key encrypted as a single blob
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

#### `shift_schedules` (shifts.ts)

```typescript
export const shiftSchedules = pgTable('shift_schedules', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  // REMOVED: name
  startTime: text('start_time').notNull(),   // Server needs for scheduling — plaintext
  endTime: text('end_time').notNull(),       // Server needs for scheduling — plaintext
  days: jsonb<number[]>()('days').notNull().default([]),
  volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
  ringGroupId: text('ring_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

#### `ring_groups` (shifts.ts)

```typescript
export const ringGroups = pgTable('ring_groups', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  // REMOVED: name
  volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

#### `blasts` (blasts.ts)

```typescript
export const blasts = pgTable('blasts', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  // REMOVED: name
  // encryptedContent + contentEnvelopes already E2EE (unchanged)
  encryptedContent: text('encrypted_content').notNull().default(''),
  contentEnvelopes: jsonb<RecipientEnvelope[]>()('content_envelopes').notNull().default([]),
  // ... all other fields unchanged
})
```

### Service Layer Changes

Services change from "encrypt/decrypt transparently" to "pass through ciphertext":

**Before (server-key, server decrypts for API response):**
```typescript
async getHubs() {
  const rows = await db.select().from(hubs)
  return rows.map(r => ({
    ...r,
    name: this.crypto.serverDecrypt(r.encryptedName, LABEL),
  }))
}
```

**After (hub-key E2EE, server passes through ciphertext):**
```typescript
async getHubs() {
  const rows = await db.select().from(hubs)
  return rows.map(r => ({
    id: r.id,
    encryptedName: r.encryptedName,       // Ciphertext — client decrypts
    encryptedDescription: r.encryptedDescription,
    status: r.status,
    // ... structural fields
  }))
}
```

**Write path changes from server-encrypts to client-provides-ciphertext:**
```typescript
// Before: server encrypts
async createHub(data: { name: string, ... }) {
  const encrypted = this.crypto.serverEncrypt(data.name, LABEL)
  await db.insert(hubs).values({ encryptedName: encrypted, ... })
}

// After: client already encrypted
async createHub(data: { encryptedName: Ciphertext, ... }) {
  await db.insert(hubs).values({ encryptedName: data.encryptedName, ... })
}
```

### API Route Changes

Routes change from accepting plaintext to accepting ciphertext:

```typescript
// Before:
app.post('/api/hubs', async (c) => {
  const { name, description } = await c.req.json()
  const hub = await services.settings.createHub({ name, description })
  return c.json(hub)
})

// After:
app.post('/api/hubs', async (c) => {
  const { encryptedName, encryptedDescription } = await c.req.json()
  const hub = await services.settings.createHub({ encryptedName, encryptedDescription })
  return c.json(hub)
})
```

### Client Component Changes

Each component that displays organizational metadata adds hub-key decryption:

```typescript
// Pattern for all components:
function HubName({ hub }: { hub: HubResponse }) {
  const { keyManager } = useAuth()
  const hubKey = useHubKey(hub.id)  // Cached after unlock

  if (!hubKey) return <Skeleton />  // Show placeholder until key unlocked

  const crypto = new ClientCryptoService(keyManager.getSecretKey(), keyManager.getPublicKeyHex())
  const name = crypto.hubDecrypt(hub.encryptedName as Ciphertext, hubKey)

  return <span>{name ?? 'Encrypted'}</span>
}
```

Or more practically, a shared hook:

```typescript
function useDecryptedHubField(encryptedValue: string | null, hubId: string): string | null {
  const hubKey = useHubKey(hubId)
  if (!encryptedValue || !hubKey) return null

  const crypto = useCryptoService()
  return crypto.hubDecrypt(encryptedValue as Ciphertext, hubKey)
}
```

### UI Flow Changes

1. **Hub switcher** — currently visible before PIN unlock. Must move to post-unlock. Before unlock, show a generic "Unlock to continue" screen instead of the hub list.

2. **Config bootstrap** — `/api/config` currently returns hub names for the switcher. After encryption, it returns ciphertext. The client shows hub names only after key unlock + hub key decryption.

3. **Admin settings pages** (roles, custom fields, report types, shifts, ring groups, blasts) — all fields show loading skeletons until hub key is available, then decrypt and render.

4. **Call ring screen** — hub name in the call notification decrypts after key unlock. Pre-unlock shows "Incoming call" without hub identification (user confirmed this is acceptable).

### New Crypto Label

No new label needed — hub-key encryption doesn't use labels. The `hubEncrypt()`/`hubDecrypt()` functions use the hub key directly as the XChaCha20-Poly1305 symmetric key.

### Hub Key Availability

The hub key flow already exists:
1. Admin wraps hub key for each member's pubkey via ECIES → stored in `hub_keys` table
2. Client fetches hub key envelope from `GET /api/hubs/:id/key`
3. Client unwraps with `eciesUnwrapKey(envelope, secretKey, LABEL_HUB_KEY_WRAP)`
4. Hub key cached in `hub-key-cache.ts` for the session

This infrastructure is already built. Phase 2B just adds more consumers of the hub key.

## Migration

No existing data to migrate — the database has no production data yet. The migration is a clean schema change:

1. Add encrypted columns alongside plaintext (Drizzle migration)
2. Deploy server + client code simultaneously (all new writes are hub-key encrypted by the client)
3. Drop plaintext columns (Phase 2C migration)

**No backfill script needed.** No dual-read fallback code. The server never encrypts or decrypts these fields — it's pure pass-through of client-provided ciphertext from day one.

## Testing

- Hub-key encrypt/decrypt round-trip for all 8 tables
- Client components render decrypted values after key unlock
- Client components show placeholders before key unlock
- Admin forms send ciphertext (not plaintext) for all encrypted fields
- API returns ciphertext for all encrypted fields
- Hub isolation: hub A's key cannot decrypt hub B's metadata
- Existing API tests updated for encrypted response format
- UI E2E tests work with PIN unlock flow
