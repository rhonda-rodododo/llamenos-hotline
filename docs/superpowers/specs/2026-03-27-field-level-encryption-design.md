# Field-Level Encryption Phase 1: Crypto Foundation + PII Protection

**Date:** 2026-03-27
**Status:** Draft
**Scope:** Crypto infrastructure (CryptoService, branded types, shared primitives) + encryption of all PII and sensitive identity data across the database
**Threat model:** Nation-state adversaries with the capability to obtain database dumps, compel cloud providers, or compromise server infrastructure. See `docs/security/THREAT_MODEL.md`.

## Series Overview

This is **Phase 1** of a two-phase encryption hardening effort:

- **Phase 1 (this spec):** Build the generic crypto infrastructure (CryptoService, shared primitives, branded types, column helpers) and encrypt all PII, phone numbers, credentials, and user-identifying data. After this phase, a database dump reveals no personal information.

- **Phase 2 (future spec):** Encrypt all operational metadata that reveals organizational structure and strategy — hub names, role definitions, report types, shift schedules, custom field definitions, audit log details, blast campaign names, IVR audio. After Phase 2, a database dump reveals nothing about what the organization does, how it's structured, or what it tracks.

Phase 1 builds the foundation that Phase 2 extends. The CryptoService, branded types, and shared primitives are designed to make Phase 2 a straightforward application of existing patterns to additional tables.

## Problem

### Plaintext PII in the database

The database audit reveals PII and sensitive data stored in plaintext across multiple tables, contradicting the project's zero-knowledge goals and the DATA_CLASSIFICATION.md classification of volunteer identity as "Encrypted-at-Rest":

| Table | Plaintext Fields | Adversary Value |
|---|---|---|
| `volunteers` | `name`, `phone` | **CRITICAL** — directly identifies who volunteers for the hotline |
| `active_calls` | `caller_number` | **CRITICAL** — full caller phone number during active calls |
| `call_legs` | `phone` | **HIGH** — volunteer phone exposed during call ringing |
| `bans` | `phone`, `reason` | **HIGH** — banned caller phones; reasons may contain identifying details |
| `invite_codes` | `name`, `phone` | **HIGH** — identifies who is being recruited |
| `call_records` | `caller_last4` | **MEDIUM** — last 4 digits + timing data narrows caller identification |
| `conversations` | `contact_last4` | **MEDIUM** — same risk as caller_last4 |
| `geocoding_config` | `api_key` | **HIGH** — third-party API key enables impersonation |
| `signal_registration_pending` | `number` | **HIGH** — phone number in plaintext |
| `provider_config` | `brand_sid`, `campaign_sid`, `messaging_service_sid` | **MEDIUM** — links database to specific Twilio account |
| `push_subscriptions` | `device_label` | **MEDIUM** — "John's iPhone" is direct PII |
| `webauthn_credentials` | `label` | **MEDIUM** — "Work Laptop" reveals device ownership |

### Bespoke per-feature encryption

The current encryption implementation has no generic mechanism. Each Epic added its own encrypt/decrypt functions (`encryptMessageForStorage`, `encryptCallRecordForStorage`, `encryptProviderCredentials`, `encryptForHub`, etc.). There is no type-safe way to declare a column as encrypted and have the compiler enforce correct usage, making it easy for new features to accidentally store sensitive data in plaintext.

## Goals

1. **Zero plaintext PII** — no personal information recoverable from a database dump
2. **E2EE where the server doesn't need access** — envelope-encrypted fields the server literally cannot decrypt
3. **Server-key encryption where operationally required** — encrypted at rest, decrypted JIT, discarded from memory immediately
4. **Generic, type-safe crypto** — branded TypeScript types (`Ciphertext`, `HmacHash`) that make storing plaintext in an encrypted column a compile-time error
5. **Unified CryptoService** — single API on both server and client replacing all scattered functions
6. **Shared crypto primitives** — one implementation of ECIES/XChaCha20/HMAC used by both server and client
7. **Foundation for Phase 2** — the infrastructure built here is reusable for operational metadata encryption

## Non-Goals

- Key rotation automation (document the procedure, don't build it)
- `volunteers` → `users` table rename (separate PR)
- Operational metadata encryption (Phase 2: hub names, roles, report types, shifts, audit details, etc.)
- Changing already-encrypted fields beyond refactoring to CryptoService
- Phone number normalization table (evaluated and rejected — see Design Decisions)

## Design Decisions

### Encryption classification

Every field is classified by what an adversary gains from it and whether the server needs runtime access:

**E2EE envelope** — server never sees plaintext. Client encrypts, client decrypts. Strongest protection.
**Server-key** — encrypted at rest, server decrypts JIT for operational use, discards immediately. Protects against DB dumps.
**HMAC hash** — one-way, for lookup/comparison only. Cannot be reversed.
**Plaintext** — no sensitive content, or operationally impossible to encrypt.

### Complete field classification (Phase 1 scope)

#### Volunteers

| Field | Mode | Rationale |
|---|---|---|
| `name` | **E2EE envelope** | Server never needs display names. Recipients: volunteer's own pubkey + all global admin pubkeys. |
| `phone` | **Server-key** | Server decrypts JIT for call routing (SIP dial, Twilio API), then discards. |

#### Active calls (ephemeral — call duration)

| Field | Mode | Rationale |
|---|---|---|
| `caller_number` | **Server-key** | Full caller phone needed for routing; rows are ephemeral and deleted after call ends. |

#### Call legs (ephemeral — ring duration)

| Field | Mode | Rationale |
|---|---|---|
| `phone` | **Server-key** | Volunteer phone needed during ringing; deleted after ring ends. |

#### Call records (persistent)

| Field | Mode | Rationale |
|---|---|---|
| `caller_last4` | **E2EE envelope** | Display-only for admins. Server doesn't need last-4 for any operation. Recipients: admin pubkeys. |

#### Conversations (persistent)

| Field | Mode | Rationale |
|---|---|---|
| `contact_last4` | **E2EE envelope** | Display-only for assigned volunteer + admins. Server doesn't need it. On reassignment, re-encrypt with new volunteer's pubkey added to envelopes. |

#### Bans

| Field | Mode | Rationale |
|---|---|---|
| `phone` → `phone_hash` | **HMAC hash** | Lookup-only. Server compares hashes, never needs to recover the number. |
| `phone` → `encrypted_phone` | **E2EE envelope** | Display copy for admin who created the ban. |
| `reason` | **E2EE envelope** | Ban reasons may contain identifying info ("Threatened volunteer at the march"). Recipients: creating admin + global admins. |

#### Invite codes

| Field | Mode | Rationale |
|---|---|---|
| `name` | **E2EE envelope** | Display-only for creating admin. |
| `phone` | **Server-key** | Server needs it for SMS invite delivery. |

#### Geocoding config

| Field | Mode | Rationale |
|---|---|---|
| `api_key` | **Server-key** | Server needs it for geocoding API calls. Uses `LABEL_PROVIDER_CREDENTIAL_WRAP`. |

#### Signal registration

| Field | Mode | Rationale |
|---|---|---|
| `number` | **Server-key** | Server needs it for Signal registration API calls. |

#### Provider config

| Field | Mode | Rationale |
|---|---|---|
| `brand_sid` | **Server-key** | Operational — server needs for A2P registration. |
| `campaign_sid` | **Server-key** | Operational — server needs for messaging service. |
| `messaging_service_sid` | **Server-key** | Operational — server needs for SMS routing. |
| `phone_number` | **Plaintext** | Public hotline number — already published. |

#### Push subscriptions

| Field | Mode | Rationale |
|---|---|---|
| `endpoint` | **Server-key** | Server must call these URLs to deliver push notifications. |
| `auth_key` | **Server-key** | Server needs for Web Push protocol. |
| `p256dh_key` | **Server-key** | Server needs for Web Push protocol. |
| `device_label` | **E2EE envelope** | "John's iPhone" is PII. Display-only for the volunteer themselves. Recipients: volunteer's pubkey. |

#### WebAuthn credentials

| Field | Mode | Rationale |
|---|---|---|
| `label` | **E2EE envelope** | "Work Laptop" reveals device ownership. Display-only for the volunteer. Recipients: volunteer's pubkey. |

### Why not a normalized phone table?

Evaluated and rejected. Phone numbers appear in different contexts (volunteer identity, incoming caller, banned number, invite recipient) with different lifecycles (persistent, ephemeral, one-way hash). A shared table would:
- Add writes to the hot path for every incoming call (ephemeral `active_calls`)
- Create cross-context correlation (matching a caller's phone to a volunteer's phone via shared row)
- Add JOINs to the call routing critical path
- Not help for HMAC-only fields (bans) where the number is never recovered

### Why not hub-key encryption for volunteer PII?

Volunteers can be members of multiple hubs. Hub-key encryption would require N encrypted copies per hub membership, encrypt/delete on hub join/leave, and re-encryption on hub key rotation. The server can unwrap all hub keys via `unwrapHubKeyForServer()`, so a full server compromise exposes all copies regardless. E2EE envelope encryption (where the server doesn't need access) provides strictly stronger protection because the server cannot decrypt at all.

### Why branded types instead of transparent Drizzle custom types?

Drizzle's `customType` `toDriver`/`fromDriver` transforms are synchronous and stateless — no access to encryption keys, hub context, or recipient pubkeys at runtime. Branded types (`Ciphertext`, `HmacHash`) with Drizzle's `$type<>()` provide compile-time safety with zero runtime overhead and no fragile hacks.

## Architecture

### Shared layer (`src/shared/`)

#### `crypto-types.ts` — Branded types

```typescript
/** Encrypted ciphertext — cannot be assigned from or to a plain string */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' }

/** HMAC hash — one-way, cannot be reversed to plaintext */
export type HmacHash = string & { readonly __brand: 'HmacHash' }
```

`RecipientEnvelope` already exists in `shared/types.ts` and is unchanged.

#### `crypto-primitives.ts` — Pure crypto functions

Extracted from the duplicated implementations in `server/lib/crypto.ts` and `client/lib/crypto.ts`. These are pure functions with no side effects, no runtime dependencies beyond `@noble/*`, and work identically in browser and Bun:

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

All existing crypto implementations on both server and client collapse into calls to these primitives.

#### `crypto-labels.ts` — Domain separation (existing, extended)

New constants:

```typescript
export const LABEL_VOLUNTEER_PII = 'llamenos:volunteer-pii:v1'
export const LABEL_EPHEMERAL_CALL = 'llamenos:ephemeral-call:v1'
export const LABEL_PUSH_CREDENTIAL = 'llamenos:push-credential:v1'
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
  // Server can encrypt and decrypt. Protects against database dumps.
  serverEncrypt(plaintext: string, label: string): Ciphertext
  serverDecrypt(ct: Ciphertext, label: string): string

  // ── Hub-key encryption ──
  // Caller provides hub key (obtained via unwrapHubKey)
  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext
  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null

  // ── HMAC hashing ──
  // HMAC-SHA256(hmacSecret, label + input) → hex digest. One-way.
  hmac(input: string, label: string): HmacHash

  // ── Envelope encryption (ECIES per-reader) ──
  // Random per-item symmetric key, wrapped via ECIES for each recipient.
  // Server can create envelopes but cannot decrypt without a recipient's private key.
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

**Initialization:** Created once at server startup, passed to services via constructor injection.

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

  // ── Envelope encryption ──
  // Used for: volunteer name, ban reason/phone display, invite name, device labels,
  //           notes, messages, call records (existing)
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

Mirrors the server CryptoService API. Both use the same `crypto-primitives.ts` underneath.

### Database layer (`src/server/db/`)

#### `crypto-columns.ts` — Column helpers

```typescript
import { text } from 'drizzle-orm/pg-core'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'

/** Text column storing XChaCha20-Poly1305 ciphertext (hex-encoded nonce || ciphertext) */
export const ciphertext = (name: string) => text(name).$type<Ciphertext>()

/** Text column storing an HMAC-SHA256 hash (hex-encoded) */
export const hmacHashed = (name: string) => text(name).$type<HmacHash>()
```

## Schema Changes

### `volunteers` (identity.ts)

```typescript
export const volunteers = pgTable('volunteers', {
  pubkey: text('pubkey').primaryKey(),
  encryptedName: ciphertext('encrypted_name').notNull(),           // E2EE envelope (self + admins)
  nameEnvelopes: jsonb<RecipientEnvelope[]>()('name_envelopes')
    .notNull().default([]),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),         // Server-key
  // Unchanged: roles, hubRoles, encryptedSecretKey, active, transcriptionEnabled,
  //   spokenLanguages, uiLanguage, profileCompleted, onBreak, callPreference,
  //   supportedMessagingChannels, messagingEnabled, createdAt
})
```

### `active_calls` (calls.ts)

```typescript
export const activeCalls = pgTable('active_calls', {
  callSid: text('call_sid').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedCallerNumber: ciphertext('encrypted_caller_number').notNull(), // Server-key (ephemeral)
  status: text('status').notNull().default('ringing'),
  assignedPubkey: text('assigned_pubkey'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb<Record<string, unknown>>()('metadata').notNull().default({}),
})
```

### `call_legs` (calls.ts)

```typescript
export const callLegs = pgTable('call_legs', {
  legSid: text('leg_sid').primaryKey(),
  callSid: text('call_sid').notNull(),
  hubId: text('hub_id').notNull().default('global'),
  volunteerPubkey: text('volunteer_pubkey').notNull(),
  encryptedPhone: ciphertext('encrypted_phone'),                   // Server-key (ephemeral)
  status: text('status').notNull().default('ringing'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  type: callLegTypeEnum('type').notNull().default('phone'),
})
```

### `call_records` (records.ts)

```typescript
export const callRecords = pgTable('call_records', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedCallerLast4: ciphertext('encrypted_caller_last4'),      // E2EE envelope (admins)
  callerLast4Envelopes: jsonb<RecipientEnvelope[]>()('caller_last4_envelopes')
    .notNull().default([]),
  // Unchanged: startedAt, endedAt, duration, status, hasTranscription, hasVoicemail,
  //   hasRecording, recordingSid, encryptedContent, adminEnvelopes, voicemailFileId
})
```

### `conversations` (conversations.ts)

```typescript
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  channelType: text('channel_type').notNull(),
  contactIdentifierHash: text('contact_identifier_hash').notNull(),
  encryptedContactLast4: ciphertext('encrypted_contact_last4'),    // E2EE envelope (assigned vol + admins)
  contactLast4Envelopes: jsonb<RecipientEnvelope[]>()('contact_last4_envelopes')
    .notNull().default([]),
  // Unchanged: externalId, assignedTo, status, metadata, reportTypeId,
  //   messageCount, createdAt, updatedAt, lastMessageAt
})
```

### `bans` (records.ts)

```typescript
export const bans = pgTable('bans', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  phoneHash: hmacHashed('phone_hash').notNull(),                   // HMAC for lookup
  encryptedPhone: ciphertext('encrypted_phone').notNull(),         // E2EE envelope (creating admin)
  phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes')
    .notNull().default([]),
  encryptedReason: ciphertext('encrypted_reason').notNull(),       // E2EE envelope (creating admin + global admins)
  reasonEnvelopes: jsonb<RecipientEnvelope[]>()('reason_envelopes')
    .notNull().default([]),
  bannedBy: text('banned_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### `invite_codes` (identity.ts)

```typescript
export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  encryptedName: ciphertext('encrypted_name').notNull(),           // E2EE envelope (creating admin)
  nameEnvelopes: jsonb<RecipientEnvelope[]>()('name_envelopes')
    .notNull().default([]),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),         // Server-key (SMS delivery)
  // Unchanged: roleIds, createdBy, createdAt, expiresAt, usedAt, usedBy,
  //   deliveryChannel, deliverySentAt
  recipientPhoneHash: hmacHashed('recipient_phone_hash'),          // Re-typed from text
})
```

### `geocoding_config` (settings.ts)

```typescript
export const geocodingConfig = pgTable('geocoding_config', {
  id: text('id').primaryKey().default('global'),
  provider: text('provider'),
  encryptedApiKey: ciphertext('encrypted_api_key').notNull().default('' as Ciphertext), // Server-key
  // Unchanged: countries, enabled, updatedAt
})
```

### `signal_registration_pending` (settings.ts)

```typescript
export const signalRegistrationPending = pgTable('signal_registration_pending', {
  id: text('id').primaryKey().default('global'),
  encryptedNumber: ciphertext('encrypted_number').notNull(),       // Server-key
  // Unchanged: bridgeUrl, method, status, error, expiresAt, createdAt
})
```

### `provider_config` (settings.ts)

```typescript
export const providerConfig = pgTable('provider_config', {
  id: text('id').primaryKey().default('global'),
  provider: text('provider').notNull(),
  connected: boolean('connected').notNull().default(false),
  phoneNumber: text('phone_number'),                               // Public hotline number — plaintext OK
  webhooksConfigured: boolean('webhooks_configured').notNull().default(false),
  sipConfigured: boolean('sip_configured').notNull().default(false),
  a2pStatus: text('a2p_status').default('not_started'),
  encryptedBrandSid: ciphertext('encrypted_brand_sid'),            // Server-key
  encryptedCampaignSid: ciphertext('encrypted_campaign_sid'),      // Server-key
  encryptedMessagingServiceSid: ciphertext('encrypted_messaging_service_sid'), // Server-key
  encryptedCredentials: ciphertext('encrypted_credentials'),       // Already encrypted — re-type only
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### `push_subscriptions` (push-subscriptions.ts)

```typescript
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pubkey: text('pubkey').notNull(),
  endpointHash: hmacHashed('endpoint_hash').notNull().unique(),    // HMAC for dedup (replaces unique constraint on plaintext)
  encryptedEndpoint: ciphertext('encrypted_endpoint').notNull(),   // Server-key (server must call)
  encryptedAuthKey: ciphertext('encrypted_auth_key').notNull(),    // Server-key (Web Push protocol)
  encryptedP256dhKey: ciphertext('encrypted_p256dh_key').notNull(),// Server-key (Web Push protocol)
  encryptedDeviceLabel: ciphertext('encrypted_device_label'),      // E2EE envelope (volunteer only)
  deviceLabelEnvelopes: jsonb<RecipientEnvelope[]>()('device_label_envelopes')
    .notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Note: The existing `endpoint` column has a `UNIQUE` constraint. Once encrypted, identical URLs produce different ciphertexts (random nonce), so uniqueness is enforced via `endpointHash` (HMAC) instead.

### `webauthn_credentials` (identity.ts)

```typescript
export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: text('id').primaryKey(),
  pubkey: text('pubkey').notNull(),
  publicKey: text('public_key').notNull(),
  counter: text('counter').notNull().default('0'),
  transports: jsonb<string[]>()('transports').notNull().default([]),
  backedUp: boolean('backed_up').notNull().default(false),
  encryptedLabel: ciphertext('encrypted_label').notNull().default('' as Ciphertext), // E2EE envelope (volunteer only)
  labelEnvelopes: jsonb<RecipientEnvelope[]>()('label_envelopes')
    .notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
})
```

## Service Layer Integration

### Volunteer CRUD (identity service)

**Create:** Client encrypts name (envelope for self + admin pubkeys), sends `{ encryptedName, nameEnvelopes, phone }`. Server encrypts phone with server-key before storing.

**Read (admin view):** Server returns `encryptedName` + `nameEnvelopes` (client decrypts). Server decrypts phone server-side for display to authorized admins.

**Read (call routing):** Server decrypts phone with server-key JIT, passes to telephony adapter, discards from memory after routing completes.

**Update profile:** Client re-encrypts name if changed (new envelopes for current admin set). Server re-encrypts phone if changed.

### Active calls (calls service)

**Create:** Server encrypts `callerNumber` with server-key on incoming webhook. Ephemeral row.

**Read (routing):** Server decrypts caller number JIT for ban checking and call bridging.

**Delete:** Row deleted when call ends. Encrypted caller number never persists beyond call lifetime.

### Call records

**Create:** Server encrypts `callerLast4` as E2EE envelope for admin pubkeys. This happens once when the call record is finalized.

**Read (admin view):** Client decrypts `callerLast4` from envelopes for display.

### Conversations

**Create:** Server encrypts `contactLast4` as E2EE envelope for assigned volunteer + admin pubkeys.

**Read:** Client decrypts from envelopes.

### Ban CRUD (records service)

**Create ban:** Client encrypts phone (envelope for creating admin + global admins) and reason (same recipients). Server hashes phone for lookup column.

**Check ban:** Server hashes incoming caller phone, compares to `phoneHash`. O(1) lookup, no decryption.

**List bans (admin view):** Client decrypts phone and reason from envelopes.

### Push subscriptions

**Create:** Client encrypts device label (envelope for self). Server encrypts endpoint/auth_key/p256dh_key with server-key.

**Send push:** Server decrypts endpoint + keys JIT, sends push notification, discards.

### WebAuthn credentials

**Create:** Client encrypts label (envelope for self). All other credential fields unchanged.

**List credentials (profile view):** Client decrypts label from envelope.

## Data Migration

### Phase 1: Add encrypted columns (non-breaking)

Drizzle migration adds new nullable columns alongside existing plaintext columns. Renames where the column name changes (geocoding, signal). All new columns are nullable during migration.

### Phase 2: Backfill script

Runtime migration script (`scripts/migrate-encrypt-pii.ts`):

1. **E2EE fields** (volunteer name, ban phone/reason, invite name, caller_last4, contact_last4, device labels, webauthn labels): encrypts using envelope pattern with server pubkey + admin pubkeys as recipients. One-time bootstrap — future writes are client-side encrypted.
2. **Server-key fields** (volunteer phone, invite phone, caller_number, call_leg phone, geocoding API key, signal number, provider SIDs, push endpoints/keys): encrypts with `CryptoService.serverEncrypt()`.
3. **HMAC fields** (ban phone hash): hashes with `CryptoService.hmac()`.
4. Idempotent: skips rows where encrypted columns are already populated.

### Phase 3: Drop plaintext columns

After verification (decrypt round-trip check, row count validation, all tests pass):

```sql
ALTER TABLE volunteers DROP COLUMN name, DROP COLUMN phone;
ALTER TABLE active_calls DROP COLUMN caller_number;
ALTER TABLE call_legs DROP COLUMN phone;
ALTER TABLE call_records DROP COLUMN caller_last4;
ALTER TABLE conversations DROP COLUMN contact_last4;
ALTER TABLE bans DROP COLUMN phone, DROP COLUMN reason;
ALTER TABLE invite_codes DROP COLUMN name, DROP COLUMN phone;
ALTER TABLE provider_config DROP COLUMN brand_sid, DROP COLUMN campaign_sid, DROP COLUMN messaging_service_sid;
ALTER TABLE push_subscriptions DROP COLUMN endpoint, DROP COLUMN auth_key, DROP COLUMN p256dh_key, DROP COLUMN device_label;
ALTER TABLE webauthn_credentials DROP COLUMN label;
```

### Transition period

During phases 1-2, services read from encrypted columns if populated, falling back to plaintext:

```typescript
// Server-key fields — server-side fallback
const phone = row.encryptedPhone
  ? crypto.serverDecrypt(row.encryptedPhone, LABEL_VOLUNTEER_PII)
  : row.phone

// E2EE fields — API returns both during transition
// Client prefers encrypted when present, falls back to plaintext
```

All writes immediately use encrypted columns. After phase 3, fallback code is deleted. The phase 2 backfill encrypts E2EE fields server-side as a one-time bootstrap (using server pubkey + admin pubkeys as envelope recipients). After backfill, all new E2EE writes originate from the client.

## Testing Strategy

### Unit tests

- `CryptoService`: encrypt/decrypt round-trips for all modes (server-key, hub-key, HMAC, envelope, binary)
- `ClientCryptoService`: envelope encrypt/decrypt round-trips, draft encryption
- `crypto-primitives`: ECIES wrap/unwrap, symmetric encrypt/decrypt, HMAC determinism, HKDF derivation
- Domain separation: encrypting with label A, decrypting with label B must fail
- Branded types: compile-time verification (`tsc` is the test — no runtime check needed)

### Migration tests

- Insert plaintext rows, run backfill, verify all encrypted columns populated
- Decrypt round-trip matches original plaintext for every table
- HMAC hash matches re-hashing the original value
- Idempotent: running backfill twice produces identical results
- Phase 3 column drops don't break reads

### Integration tests

Existing API and E2E tests pass unchanged — the service layer returns the same decrypted application types above the service boundary. Tests that directly query the database need updating to expect ciphertext.

### Security-specific tests

- Verify no plaintext PII appears in any database column after migration
- Verify ephemeral tables (active_calls, call_legs) are cleaned up after call lifecycle
- Verify E2EE fields cannot be decrypted with just `SERVER_NOSTR_SECRET` (require recipient private key)

## Phase 2 Preview (Future Spec)

Phase 2 encrypts operational metadata using the same CryptoService infrastructure:

| Table | Fields | Mode |
|---|---|---|
| `hubs` | `name`, `description`, `slug` | E2EE envelope |
| `roles` | `name`, `description` | E2EE envelope |
| `custom_field_definitions` | `field_name`, `label`, `options` | E2EE envelope |
| `report_types` | `name`, `description` | E2EE envelope |
| `report_categories` | `categories` | Hub-key |
| `shift_schedules` | `name` | E2EE envelope |
| `ring_groups` | `name` | E2EE envelope |
| `blasts` | `name` | E2EE envelope |
| `blast_settings` | `welcome_message`, `bye_message`, `double_opt_in_message` | Hub-key |
| `audit_log` | `event`, `details` | E2EE envelope |
| `ivr_audio` | `audio_data` | Hub-key |

Phase 2 is a straightforward application of the Phase 1 patterns to additional tables — no new crypto infrastructure needed.

## Future Considerations (Not In Scope)

- **Server key rotation:** Re-encrypting all server-key fields when `SERVER_NOSTR_SECRET` changes. Document the procedure (iterate all server-encrypted rows, decrypt with old key, re-encrypt with new key) but don't build automated rotation.
- **Admin membership changes:** When an admin is added/removed, E2EE envelope fields should be re-encrypted to add/remove their envelopes. Same problem as note re-encryption on admin change — use the same solution.
- **`volunteers` → `users` rename:** Separate PR.
- **Memory zeroization:** After JIT decryption of server-key fields (e.g., volunteer phone for routing), the plaintext exists in JS heap until GC. V8 doesn't support explicit memory zeroization. Mitigate by keeping decrypted values in local scope (not stored on objects) so they become unreachable quickly.
