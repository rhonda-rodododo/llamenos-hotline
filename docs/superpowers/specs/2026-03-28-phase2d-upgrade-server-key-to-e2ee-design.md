# Field-Level Encryption Phase 2D: Upgrade Display-Only Fields from Server-Key to E2EE

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Upgrade 7 Phase 1 server-key encrypted fields to true E2EE envelope encryption, now that client-side decrypt infrastructure exists from Phase 2B
**Prerequisite:** Phase 2B complete (client-side decryption patterns established)
**Threat model:** These fields are currently encrypted at rest (server-key) but a compromised running server can decrypt them. Upgrading to E2EE means even a fully compromised server cannot read volunteer names, ban details, or call identification data.

## Problem

Phase 1 encrypted these fields with server-key because client-side E2EE infrastructure didn't exist yet. Phase 2B establishes client-side decryption patterns. These 7 fields don't need server access — they're display-only — and should be upgraded to true E2EE for maximum protection against running server compromise and legal compulsion.

## Fields to Upgrade

| Field | Current Mode | E2EE Recipients | Client Context |
|---|---|---|---|
| `volunteer.encryptedName` | Server-key | Self + global admin pubkeys | Admin volunteer list, profile page |
| `ban.encryptedPhone` | Server-key | Creating admin + global admins | Ban list admin view |
| `ban.encryptedReason` | Server-key | Creating admin + global admins | Ban list admin view |
| `invite.encryptedName` | Server-key | Creating admin | Invite list admin view |
| `call_records.encryptedCallerLast4` | Server-key | Admin pubkeys | Call history admin view |
| `conversations.encryptedContactLast4` | Server-key | Assigned volunteer + admin pubkeys | Conversation list |
| `push_subscriptions.encryptedDeviceLabel` | Server-key | Volunteer's own pubkey | Push settings page |

## Design

### Schema Changes

No schema changes needed — the columns are already `ciphertext()` typed. We add companion `jsonb<RecipientEnvelope[]>` envelope columns where they don't already exist.

Fields that already have envelope columns from Phase 1 (just unused):
- `volunteer.nameEnvelopes` — exists, currently empty `[]`
- `call_records.callerLast4Envelopes` — exists
- `conversations.contactLast4Envelopes` — exists

Fields that need new envelope columns:
- `ban.phoneEnvelopes` — exists from Phase 1
- `ban.reasonEnvelopes` — exists from Phase 1
- `invite.nameEnvelopes` — exists from Phase 1
- `push_subscriptions.deviceLabelEnvelopes` — exists from Phase 1

All envelope columns already exist from Phase 1 schema. No migration needed.

### Service Layer Changes

For each field, change from:
```typescript
// Server-key (current)
const encrypted = this.crypto.serverEncrypt(value, LABEL_VOLUNTEER_PII)
// ...
const decrypted = this.crypto.serverDecrypt(row.encryptedX, LABEL_VOLUNTEER_PII)
```

To:
```typescript
// E2EE envelope (upgraded)
const { encrypted, envelopes } = this.crypto.envelopeEncrypt(value, recipientPubkeys, LABEL_VOLUNTEER_PII)
// Store encrypted + envelopes in DB
// Server CANNOT decrypt — returns ciphertext + envelopes to client
```

### API Changes

Each API endpoint that returns these fields changes from returning plaintext to returning `{ encryptedX, xEnvelopes }`:

| Endpoint | Before | After |
|---|---|---|
| `GET /api/volunteers` | `{ name: "Jane" }` | `{ encryptedName: "ab12...", nameEnvelopes: [...] }` |
| `GET /api/bans` | `{ phone: "+1555...", reason: "Spam" }` | `{ encryptedPhone: "cd34...", phoneEnvelopes: [...], encryptedReason: "ef56...", reasonEnvelopes: [...] }` |
| `GET /api/invites` | `{ name: "John" }` | `{ encryptedName: "gh78...", nameEnvelopes: [...] }` |
| `GET /api/calls` | `{ callerLast4: "1234" }` | `{ encryptedCallerLast4: "ij90...", callerLast4Envelopes: [...] }` |
| `GET /api/conversations` | `{ contactLast4: "5678" }` | `{ encryptedContactLast4: "kl12...", contactLast4Envelopes: [...] }` |
| Push settings | `{ deviceLabel: "iPhone" }` | `{ encryptedDeviceLabel: "mn34...", deviceLabelEnvelopes: [...] }` |

### Client Changes

Each component that displays these fields adds decryption after key unlock:

```typescript
// Pattern (same as Phase 2B):
const crypto = new ClientCryptoService(secretKey, pubkey)
const name = crypto.envelopeDecrypt(
  volunteer.encryptedName as Ciphertext,
  volunteer.nameEnvelopes,
  LABEL_VOLUNTEER_PII
)
```

### Write Path Changes

For fields where the CLIENT creates the data (volunteer name, ban phone/reason, invite name, device label):
- Client encrypts with `ClientCryptoService.envelopeEncrypt()` before sending to API
- API stores ciphertext + envelopes directly

For fields where the SERVER creates the data (callerLast4, contactLast4):
- Server uses `CryptoService.envelopeEncrypt()` with admin pubkeys at creation time
- These are "server-originated E2EE" — server sees plaintext once during creation (from the telephony webhook), encrypts for specific recipients, then discards

### Re-encryption of Existing Data

Existing server-key encrypted values must be re-encrypted as E2EE envelopes:
1. Server decrypts with `serverDecrypt()`
2. Re-encrypts with `envelopeEncrypt()` for appropriate recipients
3. Stores new ciphertext + envelopes

This is a one-time migration script, similar to the Phase 1 backfill.

## Testing

- Verify server cannot decrypt E2EE fields (same test pattern as `e2ee-verification.test.ts`)
- Client components display decrypted values after key unlock
- Write path: client-originated data arrives as ciphertext, server stores without decrypting
- Re-encryption migration: verify all existing data re-encrypted with envelopes
- API tests updated to handle encrypted response format
