# Field-Level Encryption Phase 2A: Server-Key Operational Fields

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Server-key encryption for fields the server must process at runtime — blast settings messages, audit log events/details, IVR audio, hub slug replacement
**Prerequisite:** Phase 1 complete (CryptoService, branded types, shared primitives)
**Threat model:** Nation-state adversaries. A seized database must not reveal what the organization communicates to subscribers, what events occurred in the audit trail, what IVR prompts say, or how the organization structures its hubs.

## Problem

After Phase 1, all personal identity data is encrypted. But operational fields remain in plaintext:

| Table | Plaintext Fields | Adversary Value |
|---|---|---|
| `blast_settings` | `welcome_message`, `bye_message`, `double_opt_in_message` | **HIGH** — reveals org messaging to subscribers, language, tone, purpose |
| `audit_log` | `event`, `details` | **HIGH** — complete operational history: who did what, when, to whom |
| `ivr_audio` | `audio_data` | **HIGH** — voice recordings reveal language, org identity, operational procedures |
| `hubs` | `slug` | **MEDIUM** — human-readable slugs reveal org structure ("legal-observer-network") |

## Goals

1. Server-key encrypt all four field groups so a database dump reveals nothing about organizational operations
2. Replace hub slug-based URL routing with hub ID routing — slugs are display-only metadata, not routing keys
3. Same Phase 1 patterns: `CryptoService.serverEncrypt()`/`serverDecrypt()`, branded `Ciphertext` types, three-phase migration

## Non-Goals

- E2EE for these fields (server must process them at runtime)
- Client-side changes beyond removing slug from URLs (that's a minor routing change)
- Encrypting audit log integrity hashes (`entry_hash`, `previous_entry_hash`) — these are SHA-256 hashes, not sensitive content

## Design

### Blast Settings

Three text fields encrypted with server-key:

| Field | Label | Rationale |
|---|---|---|
| `welcome_message` | `LABEL_VOLUNTEER_PII` | Server sends via SMS on subscriber opt-in |
| `bye_message` | `LABEL_VOLUNTEER_PII` | Server sends via SMS on subscriber opt-out |
| `double_opt_in_message` | `LABEL_VOLUNTEER_PII` | Server sends via SMS for confirmation |

Schema change:
```typescript
export const blastSettings = pgTable('blast_settings', {
  hubId: text('hub_id').primaryKey().default('global'),
  optInKeywords: jsonb<string[]>()('opt_in_keywords').notNull().default(['START', 'JOIN', 'YES']),
  optOutKeywords: jsonb<string[]>()('opt_out_keywords').notNull().default(['STOP', 'UNSUBSCRIBE', 'CANCEL']),
  doubleOptInEnabled: boolean('double_opt_in_enabled').notNull().default(false),
  encryptedDoubleOptInMessage: ciphertext('encrypted_double_opt_in_message'),
  encryptedWelcomeMessage: ciphertext('encrypted_welcome_message'),
  encryptedByeMessage: ciphertext('encrypted_bye_message'),
})
```

Service: encrypt on save, decrypt on read. Blast processor decrypts JIT when sending SMS.

### Audit Log

Two fields encrypted with server-key. The hash chain continues to work because `hashAuditEntry()` is computed on plaintext BEFORE encryption:

```
Write flow:
1. Compute hashAuditEntry(plaintext event + details) → entry_hash
2. Encrypt event + details with server-key
3. Store: encrypted event, encrypted details, plaintext entry_hash

Read flow:
1. Decrypt event + details with server-key
2. Verify: hashAuditEntry(decrypted) === entry_hash
```

| Field | Label |
|---|---|
| `event` | `LABEL_AUDIT_EVENT` (new) |
| `details` | `LABEL_AUDIT_EVENT` (same label, different column) |

Schema change:
```typescript
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedEvent: ciphertext('encrypted_event').notNull(),
  actorPubkey: text('actor_pubkey').notNull(),
  encryptedDetails: ciphertext('encrypted_details').notNull(),
  previousEntryHash: text('previous_entry_hash'),
  entryHash: text('entry_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Note: `actorPubkey` stays plaintext — it's a pseudonymous Nostr pubkey, not PII. Encrypting it would prevent the server from filtering audit logs by actor.

### IVR Audio

Binary audio data (base64-encoded) encrypted with server-key. These blobs can be large (minutes of audio).

| Field | Label |
|---|---|
| `audio_data` | `LABEL_IVR_AUDIO` (new) |

Schema change:
```typescript
export const ivrAudio = pgTable('ivr_audio', {
  hubId: text('hub_id').notNull().default('global'),
  promptType: text('prompt_type').notNull(),
  language: text('language').notNull(),
  encryptedAudioData: ciphertext('encrypted_audio_data').notNull(),
  mimeType: text('mime_type').notNull().default('audio/mpeg'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.hubId, table.promptType, table.language] })])
```

`promptType` and `language` stay plaintext — the server needs them to select the correct audio file for a caller's language choice. They reveal "this hub has Spanish IVR" but not the content.

### Hub Slug Removal

Replace slug-based routing with hub ID routing:

1. Drop `slug` column from `hubs` schema
2. Update all API routes that use `:slug` parameters to use `:hubId`
3. Update client-side routing to use hub IDs in URLs
4. Any UI that displays the slug switches to hub name (which will be E2EE in Phase 2B — for now, display the plaintext name)

This is a breaking URL change but since there's no real data yet, it's safe.

## New Crypto Labels

```typescript
export const LABEL_AUDIT_EVENT = 'llamenos:audit-event:v1'
export const LABEL_IVR_AUDIO = 'llamenos:ivr-audio:v1'
```

`blast_settings` messages reuse `LABEL_VOLUNTEER_PII` since they're subscriber-facing communication in the same domain.

## Migration

Same three-phase pattern as Phase 1:
1. Add encrypted columns alongside plaintext
2. Backfill: encrypt existing data, compute hashes
3. Drop plaintext columns

## Testing

- Audit log hash chain integrity: verify chain still validates after encrypt/decrypt round-trip
- Blast settings: encrypt → decrypt → send SMS flow
- IVR audio: encrypt → decrypt → serve to telephony bridge
- Hub routing: all hub-scoped API calls work with ID instead of slug
