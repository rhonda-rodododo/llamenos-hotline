# Field-Level Encryption Phase 2B: Organizational Metadata Encryption

**Date:** 2026-03-28
**Status:** Draft
**Scope:** End-to-end encryption of all organizational metadata — hub names, role definitions, custom field definitions, report types, shift/ring group names, blast campaign names. Full-stack: schema + API + client components.
**Prerequisite:** Phase 1 complete, Phase 2A complete (or parallel)
**Threat model:** Nation-state adversaries. A seized database must not reveal what the organization does, how it's structured, what it tracks, or what its teams are called. Even a compromised running server cannot decrypt E2EE fields — only authorized clients with unlocked keys can read this data.

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

1. **True E2EE** — the server stores opaque ciphertext for all organizational metadata; only authenticated clients with unlocked keys can decrypt
2. **Client-side encryption on write** — admin encrypts metadata before sending to the API
3. **Client-side decryption on read** — client decrypts using `ClientCryptoService` after PIN unlock
4. **UI flow change** — all organizational metadata is only visible after PIN unlock; pre-unlock screens show opaque placeholders
5. **Follow the blast content pattern** — the existing `blasts.tsx` decrypt flow is the template for all E2EE fields

## Non-Goals

- Encrypting structural metadata (hub IDs, timestamps, boolean flags, foreign keys)
- Encrypting data the server must process (blast settings messages, IVR audio, audit events — those are Phase 2A server-key)
- Building a generalized "encrypted field" React component (defer until pattern stabilizes)

## Design

### Encryption Model

All fields use **server-key encryption** with the same `CryptoService.serverEncrypt()`/`serverDecrypt()` pattern. The server encrypts on write and decrypts on read, returning plaintext to authorized clients over TLS.

**Why server-key instead of E2EE envelopes for this phase:** These fields are organizational metadata that ALL authorized hub members need to read. Using ECIES envelopes would require wrapping for every member (potentially hundreds), re-wrapping on every membership change, and the server would need to maintain envelope lists for metadata rows. Server-key encryption achieves the core goal (seized database reveals nothing) while avoiding the O(members) envelope management complexity.

**The path to full E2EE:** When client-side hub key decryption is implemented (the client already has `ClientCryptoService.hubDecrypt()`), these fields can be re-encrypted with the hub key instead of the server key. The hub key is already distributed to all members via ECIES envelopes in the `hub_keys` table. This is a future migration that swaps the encryption key without changing the schema structure.

### Schema Changes

Each table gets an encrypted companion column. The pattern for every field:

```typescript
// Before:
name: text('name').notNull()

// After (Phase 1 migration: add alongside):
name: text('name').notNull()                    // ← kept during transition
encryptedName: ciphertext('encrypted_name')     // ← new, nullable during transition

// After (Phase 3 migration: drop plaintext):
encryptedName: ciphertext('encrypted_name').notNull()
```

#### `hubs` (settings.ts)

```typescript
export const hubs = pgTable('hubs', {
  id: text('id').primaryKey(),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description'),
  status: text('status').notNull().default('active'),
  phoneNumber: text('phone_number'),                    // Public hotline number — plaintext OK
  createdBy: text('created_by').notNull().default(''),
  allowSuperAdminAccess: boolean('allow_super_admin_access').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: name, slug, description
})
```

Note: `slug` is dropped entirely (Phase 2A replaces slug routing with hub ID routing).

#### `roles` (settings.ts)

```typescript
export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  hubId: text('hub_id'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description').notNull().default('' as Ciphertext),
  permissions: jsonb<string[]>()('permissions').notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: name, description
})
```

Note: `roles.slug` is dropped — custom role slugs like 'legal-liaison' reveal org structure. Permission checks should use role IDs instead. System roles ('role-admin', 'role-volunteer') are identified by `isDefault` flag or by ID, not slug.

#### `custom_field_definitions` (settings.ts)

```typescript
export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: text('id').primaryKey(),
  hubId: text('hub_id'),
  encryptedFieldName: ciphertext('encrypted_field_name').notNull(),
  encryptedLabel: ciphertext('encrypted_label').notNull(),
  fieldType: text('field_type').notNull(),  // 'text' | 'select' etc. — structural, not content
  encryptedOptions: ciphertext('encrypted_options').notNull().default('' as Ciphertext),  // JSON-stringified then encrypted
  required: boolean('required').notNull().default(false),
  showInVolunteerView: boolean('show_in_volunteer_view').notNull().default(false),
  context: text('context').notNull().default('notes'),
  reportTypeIds: jsonb<string[]>()('report_type_ids').notNull().default([]),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: field_name, label, options
})
```

Note: `fieldType` stays plaintext — "text", "select", "checkbox" are structural types needed for form rendering logic. They don't reveal what the field is about.

#### `report_types` (report-types.ts)

```typescript
export const reportTypes = pgTable('report_types', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description'),
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: name, description
})
```

#### `report_categories` (settings.ts)

```typescript
export const reportCategories = pgTable('report_categories', {
  hubId: text('hub_id').primaryKey().default('global'),
  encryptedCategories: ciphertext('encrypted_categories').notNull().default('' as Ciphertext),  // JSON array, encrypted
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: categories
})
```

#### `shift_schedules` (shifts.ts)

```typescript
export const shiftSchedules = pgTable('shift_schedules', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  startTime: text('start_time').notNull(),   // Plaintext — server needs for scheduling
  endTime: text('end_time').notNull(),       // Plaintext — server needs for scheduling
  days: jsonb<number[]>()('days').notNull().default([]),  // Plaintext — server needs for scheduling
  volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
  ringGroupId: text('ring_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: name
})
```

#### `ring_groups` (shifts.ts)

```typescript
export const ringGroups = pgTable('ring_groups', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // REMOVED: name
})
```

#### `blasts` (blasts.ts)

```typescript
// Only the `name` field changes — encryptedContent + contentEnvelopes are already E2EE
export const blasts = pgTable('blasts', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedContent: text('encrypted_content').notNull().default(''),  // Already E2EE (unchanged)
  contentEnvelopes: jsonb<RecipientEnvelope[]>()('content_envelopes').notNull().default([]),
  // ... all other fields unchanged
  // REMOVED: name
})
```

### Service Layer

Each service encrypts on write with `this.crypto.serverEncrypt(value, LABEL)` and decrypts on read with `this.crypto.serverDecrypt(ct, LABEL)`. Same dual-read transition pattern as Phase 1.

### New Crypto Label

```typescript
export const LABEL_ORG_METADATA = 'llamenos:org-metadata:v1'
```

All organizational metadata fields use this single label — they're the same security domain (organizational structure/strategy).

### Client-Side Changes

**No client-side decryption changes needed for server-key encryption.** The server decrypts and returns plaintext to authorized clients over TLS. The client components continue to display fields the same way.

**UI flow change (hub switcher):** The hub list is loaded via `/api/config`. Currently this happens before PIN unlock. Since hub names are now encrypted and the server decrypts them, the hub list still works — but we should move the hub switcher to post-authentication to prevent showing hub names to an unauthenticated observer of the screen.

### Future: Migration to Hub-Key E2EE

These server-key encrypted fields are positioned for future hub-key E2EE migration:
1. Replace `serverEncrypt` with `hubEncrypt(value, hubKey)` in the service layer
2. API returns ciphertext — client decrypts with `clientCrypto.hubDecrypt(ct, hubKey)`
3. Hub key is already distributed to all members via the `hub_keys` table
4. No schema changes needed — same `ciphertext()` columns

This migration is a separate future spec, not part of Phase 2.

## Migration

Same three-phase pattern:
1. Add encrypted columns alongside plaintext (nullable)
2. Backfill: server-key encrypt existing plaintext data
3. Drop plaintext columns, make encrypted NOT NULL

## Testing

- All existing API tests pass (server decrypts transparently)
- All existing UI E2E tests pass (no client changes)
- Verify encrypted columns contain ciphertext, not plaintext
- Verify hub ID routing works (no slug-based routes remain)
