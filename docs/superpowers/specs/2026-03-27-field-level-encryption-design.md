# Field-Level Encryption: Generic E2EE & Encrypted-at-Rest for All PII

**Date:** 2026-03-27
**Status:** Draft
**Scope:** Server + Client crypto refactor, schema migration, branded type safety

## Problem

The database audit reveals that several tables store PII in plaintext despite the project's zero-knowledge goals and the DATA_CLASSIFICATION.md document classifying them as "Encrypted-at-Rest" or higher:

| Table | Plaintext Fields | Severity |
|---|---|---|
| `volunteers` | `name`, `phone` | **CRITICAL** — volunteer identity is safety-critical PII |
| `bans` | `phone`, `reason` | **HIGH** — phone numbers of banned callers |
| `invite_codes` | `name`, `phone` | **HIGH** — PII of invitees |
| `geocoding_config` | `api_key` | **HIGH** — third-party API key |
| `signal_registration_pending` | `number` | **HIGH** — phone number |

Additionally, the current encryption implementation is bespoke per-feature: each Epic added its own encrypt/decrypt functions (`encryptMessageForStorage`, `encryptCallRecordForStorage`, `encryptProviderCredentials`, `encryptForHub`, etc.). There is no generic, type-safe mechanism to declare a column as encrypted and have the compiler enforce correct usage.

## Goals

1. **Encrypt all PII at rest** — no plaintext PII in the database
2. **E2EE where possible** — fields the server doesn't need operationally should be envelope-encrypted so the server never sees plaintext
3. **Generic, type-safe encryption** — branded TypeScript types that make it a compile-time error to store plaintext in an encrypted column or read ciphertext without decrypting
4. **Unified CryptoService** — single API replacing all scattered encryption functions on both server and client
5. **Shared crypto primitives** — deduplicate the ECIES/XChaCha20/HMAC implementations between server and client

## Non-Goals

- Key rotation mechanism (document but don't build)
- `volunteers` → `users` table rename (separate PR)
- Changes to already-encrypted fields (messages, notes, call records, blasts, telephony config, etc.) beyond refactoring them to use CryptoService
- Push subscription endpoint encryption (server must call these URLs)
- Hub phone number encryption (public hotline number, not PII)
- Audit log detail encryption (readability required for audit purposes)

## Design Decisions

### Encryption model per field

Each field is classified into one of four encryption modes based on whether the server needs runtime access:

| Field | Mode | Rationale |
|---|---|---|
| Volunteer `name` | **E2EE envelope** | Server never needs display names; only shown to the volunteer and global admins via client-side decryption. Envelope recipients: the volunteer's own pubkey + all global admin pubkeys (not hub-scoped — name is a user-level attribute). |
| Volunteer `phone` | **Server-key** | Server must decrypt just-in-time for call routing (SIP dial, Twilio API) |
| Ban `reason` | **Plaintext** | Not PII by convention — UI should warn admins not to include identifying information in ban reasons |
| Ban `phoneHash` | **HMAC hash** | Lookup-only; same pattern as existing caller phone hashing |
| Ban `encryptedPhone` (display) | **E2EE envelope** | Admin who created the ban can view it; server never needs it |
| Invite `name` | **E2EE envelope** | Display-only for the creating admin |
| Invite `phone` | **Server-key** | Server needs it for SMS invite delivery |
| Geocoding `apiKey` | **Server-key** | Server needs it for geocoding API calls |
| Signal reg `number` | **Server-key** | Server needs it for Signal registration flow |

### Why not hub-key encryption for volunteer PII?

Volunteers (users) can be members of multiple hubs. Hub-key encryption would require:
- N encrypted copies per hub membership
- Encrypt on hub join, delete on hub leave
- Re-encrypt on hub key rotation for all members
- A fallback for profile display (no hub context)

The security benefit is marginal: the server can unwrap all hub keys via `unwrapHubKeyForServer()`, so a full server compromise exposes all copies regardless. Hub-key isolation only helps when a single hub key is compromised without the server secret — a narrow scenario that doesn't justify the complexity.

Server-key encryption protects against the primary threat (database breach) with no multi-hub bookkeeping. E2EE envelope encryption (for fields the server doesn't need) provides stronger protection than hub-key encryption because the server literally cannot decrypt.

### Why branded types instead of transparent Drizzle custom types?

Drizzle's `customType` offers `toDriver`/`fromDriver` transforms, but they are synchronous and stateless — no access to encryption keys or hub context at runtime. Transparent encrypt-on-write/decrypt-on-read at the column level would:
- Break WHERE clauses (comparing plaintext to ciphertext)
- Pay decryption cost on every SELECT even when the value isn't needed
- Not support hub-key encryption (needs hub ID context)
- Require fragile module-level singleton key providers

Branded types (`Ciphertext`, `HmacHash`) with Drizzle's `$type<>()` provide compile-time safety with zero runtime overhead and no Drizzle hacks.

## Architecture

### Shared layer (`src/shared/`)

#### `crypto-types.ts` — Branded types

```typescript
/** Encrypted ciphertext — cannot be used as a plain string without decryption */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' }

/** HMAC hash — one-way, cannot be reversed to plaintext */
export type HmacHash = string & { readonly __brand: 'HmacHash' }
```

These types are structurally identical to `string` at runtime but TypeScript treats them as incompatible. Inserting a raw `string` into a `Ciphertext` column is a type error.

`RecipientEnvelope` already exists in `shared/types.ts` and is unchanged.

#### `crypto-primitives.ts` — Pure crypto functions

Extracted from the duplicated implementations in `server/lib/crypto.ts` and `client/lib/crypto.ts`:

```typescript
// ECIES key wrapping (secp256k1 ECDH + SHA256 + XChaCha20-Poly1305)
export function eciesWrapKey(key: Uint8Array, recipientPubkeyHex: string, label: string):
  { wrappedKey: string; ephemeralPubkey: string }
export function eciesUnwrapKey(envelope: { wrappedKey: string; ephemeralPubkey: string },
  privateKey: Uint8Array, label: string): Uint8Array

// Symmetric encryption (XChaCha20-Poly1305)
export function symmetricEncrypt(plaintext: Uint8Array, key: Uint8Array): string  // hex: nonce(24) || ciphertext
export function symmetricDecrypt(packed: string, key: Uint8Array): Uint8Array

// HMAC-SHA256
export function hmacSha256(key: Uint8Array, input: Uint8Array): Uint8Array

// HKDF-SHA256
export function hkdfDerive(secret: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array
```

These are pure functions with no side effects, no runtime dependencies beyond `@noble/*`, and work identically in browser and Bun. All existing crypto implementations collapse into calls to these primitives.

#### `crypto-labels.ts` — Domain separation (existing, extended)

New constant:

```typescript
export const LABEL_VOLUNTEER_PII = 'llamenos:volunteer-pii:v1'
```

### Server layer (`src/server/lib/`)

#### `crypto-service.ts` — CryptoService

```typescript
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'

export class CryptoService {
  constructor(private serverSecret: string, private hmacSecret: string) {}

  // ── Server-key encryption ──
  // HKDF(SERVER_NOSTR_SECRET, label) → symmetric key → XChaCha20-Poly1305
  serverEncrypt(plaintext: string, label: string): Ciphertext
  serverDecrypt(ct: Ciphertext, label: string): string

  // ── Hub-key encryption ──
  // Caller provides hub key (obtained via unwrapHubKey)
  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext
  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null

  // ── HMAC hashing ──
  // HMAC-SHA256(hmacSecret, label + input) → hex digest
  hmac(input: string, label: string): HmacHash

  // ── Envelope encryption (ECIES per-reader) ──
  envelopeEncrypt(plaintext: string, recipientPubkeys: string[], label: string):
    { encrypted: Ciphertext; envelopes: RecipientEnvelope[] }
  envelopeDecrypt(ct: Ciphertext, envelope: RecipientEnvelope,
    secretKey: Uint8Array, label: string): string

  // ── Binary envelope ──
  envelopeEncryptBinary(data: Uint8Array, recipientPubkeys: string[], label: string):
    { encrypted: Ciphertext; envelopes: RecipientEnvelope[] }
  envelopeDecryptBinary(ct: Ciphertext, envelope: RecipientEnvelope,
    secretKey: Uint8Array, label: string): Uint8Array

  // ── Hub key management ──
  unwrapHubKey(envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>): Uint8Array
}
```

**Initialization:** Created once at server startup, passed to services via constructor injection (same pattern as the existing `serverSecret` parameter).

**Existing function migration:**

| Existing function | CryptoService method |
|---|---|
| `encryptProviderCredentials(text, secret)` | `crypto.serverEncrypt(text, LABEL_PROVIDER_CREDENTIAL_WRAP)` |
| `decryptProviderCredentials(ct, secret)` | `crypto.serverDecrypt(ct, LABEL_PROVIDER_CREDENTIAL_WRAP)` |
| `encryptStorageCredential(text, secret)` | `crypto.serverEncrypt(text, LABEL_STORAGE_CREDENTIAL_WRAP)` |
| `decryptStorageCredential(ct, secret)` | `crypto.serverDecrypt(ct, LABEL_STORAGE_CREDENTIAL_WRAP)` |
| `encryptForHub(text, hubKey)` | `crypto.hubEncrypt(text, hubKey)` |
| `decryptFromHub(ct, hubKey)` | `crypto.hubDecrypt(ct, hubKey)` |
| `encryptMessageForStorage(text, pubkeys)` | `crypto.envelopeEncrypt(text, pubkeys, LABEL_MESSAGE)` |
| `encryptCallRecordForStorage(meta, pubkeys)` | `crypto.envelopeEncrypt(JSON.stringify(meta), pubkeys, LABEL_CALL_META)` |
| `encryptBinaryForStorage(data, pubkeys, label)` | `crypto.envelopeEncryptBinary(data, pubkeys, label)` |
| `decryptBinaryFromStorage(ct, env, key, label)` | `crypto.envelopeDecryptBinary(ct, env, key, label)` |
| `hashPhone(phone, secret)` | `crypto.hmac(phone, HMAC_PHONE_PREFIX)` |
| `hashIP(ip, secret)` | `crypto.hmac(ip, HMAC_IP_PREFIX)` (truncated to 24 hex chars) |
| `unwrapHubKeyForServer(secret, envelopes)` | `crypto.unwrapHubKey(envelopes)` |
| `hashAuditEntry(entry)` | Stays standalone — integrity hashing, not encryption |

Old standalone functions are deleted after all callers migrate.

### Client layer (`src/client/lib/`)

#### `crypto-service.ts` — ClientCryptoService

```typescript
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'

export class ClientCryptoService {
  constructor(private secretKey: Uint8Array, private pubkey: string) {}

  // ── Envelope encryption (notes, volunteer name, ban display, etc.) ──
  envelopeEncrypt(plaintext: string, recipientPubkeys: string[], label: string):
    { encrypted: Ciphertext; envelopes: RecipientEnvelope[] }
  envelopeDecrypt(ct: Ciphertext, envelopes: RecipientEnvelope[], label: string): string

  // ── Hub-key operations ──
  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext
  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null

  // ── Binary envelope ──
  envelopeEncryptBinary(data: Uint8Array, recipientPubkeys: string[], label: string):
    { encrypted: Ciphertext; envelopes: RecipientEnvelope[] }
  envelopeDecryptBinary(ct: Ciphertext, envelopes: RecipientEnvelope[], label: string): Uint8Array

  // ── Draft encryption (self-only, auto-save) ──
  encryptDraft(plaintext: string): Ciphertext
  decryptDraft(ct: Ciphertext): string
}
```

Mirrors the server service API. Both use the same `crypto-primitives.ts` underneath.

### Database layer (`src/server/db/`)

#### `crypto-columns.ts` — Column helpers

```typescript
import { text } from 'drizzle-orm/pg-core'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'

/** Text column that stores XChaCha20-Poly1305 ciphertext (hex-encoded) */
export const ciphertext = (name: string) => text(name).$type<Ciphertext>()

/** Text column that stores an HMAC-SHA256 hash (hex-encoded) */
export const hmacHashed = (name: string) => text(name).$type<HmacHash>()
```

## Schema Changes

### `volunteers` (identity.ts)

```typescript
export const volunteers = pgTable('volunteers', {
  pubkey: text('pubkey').primaryKey(),
  // REMOVED: name (plaintext)
  // REMOVED: phone (plaintext)
  encryptedName: ciphertext('encrypted_name').notNull(),           // E2EE envelope
  nameEnvelopes: jsonb<RecipientEnvelope[]>()('name_envelopes')    // ECIES key wraps (self + admins)
    .notNull().default([]),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),         // Server-key encrypted
  // All other columns unchanged
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
```

### `bans` (records.ts)

```typescript
export const bans = pgTable('bans', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  // REMOVED: phone (plaintext)
  phoneHash: hmacHashed('phone_hash').notNull(),                   // HMAC for lookup
  encryptedPhone: ciphertext('encrypted_phone').notNull(),         // E2EE envelope for admin display
  phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes')  // ECIES key wraps (creating admin)
    .notNull().default([]),
  reason: text('reason').notNull().default(''),                    // Plaintext — avoid putting PII in ban reasons
  bannedBy: text('banned_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### `invite_codes` (identity.ts)

```typescript
export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  // REMOVED: name (plaintext)
  // REMOVED: phone (plaintext)
  encryptedName: ciphertext('encrypted_name').notNull(),           // E2EE envelope (creating admin)
  nameEnvelopes: jsonb<RecipientEnvelope[]>()('name_envelopes')
    .notNull().default([]),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),         // Server-key (SMS delivery)
  roleIds: jsonb<string[]>()('role_ids').notNull().default([]),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedBy: text('used_by'),
  recipientPhoneHash: hmacHashed('recipient_phone_hash'),          // Re-typed from text
  deliveryChannel: varchar('delivery_channel', { length: 16 }),
  deliverySentAt: timestamp('delivery_sent_at', { withTimezone: true }),
})
```

### `geocoding_config` (settings.ts)

```typescript
export const geocodingConfig = pgTable('geocoding_config', {
  id: text('id').primaryKey().default('global'),
  provider: text('provider'),
  // CHANGED: api_key → encrypted_api_key
  encryptedApiKey: ciphertext('encrypted_api_key').notNull().default('' as Ciphertext),
  countries: jsonb<string[]>()('countries').notNull().default([]),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### `signal_registration_pending` (settings.ts)

```typescript
export const signalRegistrationPending = pgTable('signal_registration_pending', {
  id: text('id').primaryKey().default('global'),
  // CHANGED: number → encrypted_number
  encryptedNumber: ciphertext('encrypted_number').notNull(),       // Server-key
  bridgeUrl: text('bridge_url').notNull(),                         // Keep plaintext (server needs it)
  method: text('method').notNull(),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

## Service Layer Integration

### Volunteer CRUD (identity service)

**Create:** Client encrypts name (envelope for self + admin pubkeys), sends `{ encryptedName, nameEnvelopes, phone }`. Server encrypts phone with server-key before storing.

**Read (admin view):** Server returns `encryptedName` + `nameEnvelopes` (client decrypts name) and decrypts phone server-side for display.

**Read (call routing):** Server decrypts phone with server-key JIT, passes to telephony adapter, discards from memory after routing.

**Update profile:** Client re-encrypts name if changed (new envelopes for current admin set). Server re-encrypts phone if changed.

### Ban CRUD (records service)

**Create ban:** Client encrypts phone (envelope for creating admin). Server hashes phone for lookup column.

**Check ban:** Server hashes incoming caller phone, compares to `phoneHash` column. No decryption needed.

**List bans (admin view):** Server returns `encryptedPhone` + `phoneEnvelopes`. Client decrypts for display.

### Invite CRUD (identity service)

**Create invite:** Client encrypts name (envelope for creating admin). Server encrypts phone with server-key (needed for SMS delivery).

**Send invite SMS:** Server decrypts phone with server-key, sends SMS, discards plaintext.

**List invites (admin view):** Server returns `encryptedName` + `nameEnvelopes`. Client decrypts.

## Data Migration

### Phase 1: Add encrypted columns (non-breaking)

Drizzle migration adds new nullable columns alongside existing plaintext columns:

```sql
ALTER TABLE volunteers ADD COLUMN encrypted_name text;
ALTER TABLE volunteers ADD COLUMN name_envelopes jsonb DEFAULT '[]';
ALTER TABLE volunteers ADD COLUMN encrypted_phone text;

ALTER TABLE bans ADD COLUMN phone_hash text;
ALTER TABLE bans ADD COLUMN encrypted_phone text;
ALTER TABLE bans ADD COLUMN phone_envelopes jsonb DEFAULT '[]';

ALTER TABLE invite_codes ADD COLUMN encrypted_name text;
ALTER TABLE invite_codes ADD COLUMN name_envelopes jsonb DEFAULT '[]';
ALTER TABLE invite_codes ADD COLUMN encrypted_phone text;

ALTER TABLE geocoding_config RENAME COLUMN api_key TO encrypted_api_key;

ALTER TABLE signal_registration_pending RENAME COLUMN number TO encrypted_number;
```

### Phase 2: Backfill script

A runtime migration script (`scripts/migrate-encrypt-pii.ts`) that:

1. Reads all rows with plaintext values
2. For E2EE fields (volunteer name, ban phone display, invite name): encrypts using envelope pattern with server pubkey + admin pubkeys as recipients. This is a one-time bootstrap — future writes are encrypted client-side.
3. For server-key fields (volunteer phone, invite phone, geocoding API key, signal number): encrypts with `CryptoService.serverEncrypt()`
4. For HMAC fields (ban phone hash): hashes with `CryptoService.hmac()`
5. Idempotent: skips rows where encrypted columns are already populated

### Phase 3: Drop plaintext columns

After verification (decrypt round-trip check, row count validation, integration tests pass):

```sql
ALTER TABLE volunteers DROP COLUMN name;
ALTER TABLE volunteers DROP COLUMN phone;
ALTER TABLE bans DROP COLUMN phone;
ALTER TABLE invite_codes DROP COLUMN name;
ALTER TABLE invite_codes DROP COLUMN phone;
```

### Transition period

During phases 1-2, services read from encrypted columns if populated, falling back to plaintext:

```typescript
// Server-key fields (e.g., volunteer phone) — server-side fallback
const phone = row.encryptedPhone
  ? crypto.serverDecrypt(row.encryptedPhone, LABEL_VOLUNTEER_PII)
  : row.phone  // legacy plaintext fallback

// E2EE fields (e.g., volunteer name) — server returns encrypted data to client
// During transition, API returns both encryptedName (if populated) and legacy name
// Client prefers encryptedName when present, falls back to plaintext name
```

All writes immediately use encrypted columns. After phase 3, fallback code is deleted. The phase 2 backfill encrypts E2EE fields server-side as a one-time bootstrap (using the server's pubkey + admin pubkeys as envelope recipients). After backfill, all new E2EE writes originate from the client.

## Testing Strategy

### Unit tests

- `CryptoService`: encrypt/decrypt round-trips for all modes (server-key, hub-key, HMAC, envelope, binary envelope)
- Domain separation: encrypting with one label, decrypting with another must fail
- HMAC determinism: same input + label = same hash
- Branded types: compile-time verification (no runtime test needed — `tsc` is the test)

### Migration tests

- Insert plaintext rows, run backfill, verify encrypted columns populated
- Decrypt round-trip matches original plaintext for all tables
- Idempotent: running backfill twice produces same result
- Phase 3 column drops don't break reads

### Integration tests

Existing API and E2E tests should pass unchanged — the service layer returns the same decrypted application types. Tests that directly query the database need updating to expect ciphertext.

## Future Considerations (Not In Scope)

- **Server key rotation:** Re-encrypting all server-key fields when `SERVER_NOSTR_SECRET` changes. Requires a rotation script similar to the backfill. Document the procedure but don't build automated rotation.
- **Client-side volunteer profile decryption:** Currently the server mediates all volunteer data access. If client-side decryption of volunteer profiles is added later, hub-key encryption could be layered on.
- **`volunteers` → `users` rename:** Separate PR to avoid conflating schema and encryption changes.
- **Admin membership changes:** When an admin is added/removed, E2EE envelope fields (volunteer names, ban display phones, invite names) should ideally be re-encrypted to add/remove their envelopes. This is the same problem as note re-encryption on admin change and should use the same solution.
