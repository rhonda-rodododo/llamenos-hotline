# Blast Content Encryption at Rest

**Date:** 2026-03-26
**Status:** Draft

## Overview

Blast content (message text, media URLs, channel overrides) is stored as plaintext in the `blasts.content` column. This is inconsistent with the project's E2EE security model where notes, messages, call records, files, and subscriber identifiers are all encrypted at rest.

This spec adds ECIES envelope encryption for blast content, following the same pattern used for notes and messages. The blast processor already has server key access (it decrypts subscriber identifiers via `unwrapHubKeyForServer`), so it can decrypt blast content just-in-time for delivery without any admin client being online.

Also fixes the FIXME band-aid: the `blastWithParsedContent` JSON.parse workaround is eliminated since content becomes opaque ciphertext on the server.

## Goals

- Blast content encrypted at rest using ECIES envelope pattern
- Only admins and the server can decrypt (role-scoped via envelope recipients)
- Blast processor decrypts once per blast, not per recipient
- Scheduled blasts work without admin client online (server has its own envelope)
- Schema migrated from `text` to proper encrypted fields
- `blastWithParsedContent` band-aid removed

## Non-Goals

- Encrypting blast name, tags, or scheduling metadata (these are operational, not PII)
- Changing the subscriber identifier encryption (already hub-key encrypted)
- Encrypting blast delivery status/stats
- Production migration (pre-production, no legacy data)

---

## Design

### Crypto Pattern

Same envelope pattern as `encryptMessageForStorage`:

1. Generate random 32-byte per-blast symmetric key
2. XChaCha20-Poly1305 encrypt content JSON with that key
3. ECIES-wrap the key for each recipient (admins + server pubkey) using `LABEL_BLAST_CONTENT`
4. Store `encryptedContent` (hex: nonce(24) + ciphertext) and `contentEnvelopes` (array of `{ pubkey, wrappedKey, ephemeralPubkey }`)

Domain separation constant: `LABEL_BLAST_CONTENT = 'llamenos:blast-content'`

### Schema Changes

Replace in `src/server/db/schema/blasts.ts`:

```
- content: text('content').notNull().default('')
+ encryptedContent: text('encrypted_content').notNull().default('')
+ contentEnvelopes: jsonb<MessageKeyEnvelope[]>()('content_envelopes').notNull().default([])
```

Generate a Drizzle migration for this change.

### Encryption Flow (Client → Server → DB)

**Create blast (POST /api/blasts):**
1. Client encrypts `BlastContent` JSON with `encryptMessageForStorage(JSON.stringify(content), adminPubkeys + serverPubkey, LABEL_BLAST_CONTENT)` — reuse existing function with custom label
2. Client sends `{ encryptedContent, contentEnvelopes, name, ... }` to API
3. Server stores encrypted fields directly (no plaintext touches the DB)

**Edit blast (PATCH /api/blasts/:id):**
1. Client decrypts existing content using admin's envelope
2. Admin edits
3. Client re-encrypts with fresh key + fresh envelopes for current admin list + server
4. Client sends updated `{ encryptedContent, contentEnvelopes }` to API

**Read blast (GET /api/blasts):**
1. Server returns `{ encryptedContent, contentEnvelopes, ... }` (no plaintext)
2. Client finds admin's envelope, ECIES-unwraps content key, decrypts
3. UI renders `BlastContent` object

### Decryption Flow (Blast Processor → Messaging Adapter)

**Delivery (background job):**
1. `BlastProcessor.processBlast()` fetches blast from DB
2. Derives server private key from `SERVER_NOSTR_SECRET` via HKDF (already does this for hub key)
3. Finds server's envelope in `blast.contentEnvelopes` by matching server pubkey
4. ECIES-unwraps content key, XChaCha20 decrypts content — once per blast
5. Parses `BlastContent` JSON, extracts `.text`
6. Appends opt-out footer, sends to each subscriber via messaging adapter (unchanged)

### Server Pubkey in Envelopes

The client needs the server's pubkey to include it in the envelope list. This is already available — the server's Nostr pubkey is derivable from `SERVER_NOSTR_SECRET` and is exposed to admins (it's used for hub key distribution).

The client should fetch the server pubkey from `GET /api/auth/me` or a settings endpoint and include it when encrypting blast content.

### Files Changed

| File | Change |
|------|--------|
| `src/shared/crypto-labels.ts` | Add `LABEL_BLAST_CONTENT` |
| `src/server/db/schema/blasts.ts` | Replace `content` with `encryptedContent` + `contentEnvelopes` |
| `src/shared/types.ts` | Update `Blast` interface, `BlastContent` stays as-is (client-side type) |
| `src/server/types.ts` | Update `CreateBlastData` |
| `src/server/services/blasts.ts` | Update `createBlast`, `updateBlast`, `#rowToBlast` — pass through encrypted fields |
| `src/server/routes/blasts.ts` | Remove `blastWithParsedContent`, update POST/PATCH/GET handlers |
| `src/server/jobs/blast-processor.ts` | Add content decryption before delivery |
| `src/client/lib/api.ts` | Update blast API functions — send/receive encrypted fields |
| `src/client/` components | Update blast create/edit/list UI to encrypt/decrypt client-side |
| `drizzle/migrations/` | New migration for schema change |

### Reuse Existing Crypto

No new crypto functions needed. Reuse:
- **Client**: `encryptMessage(content, pubkeys)` with `LABEL_BLAST_CONTENT` label — or call the lower-level `eciesWrapKey` directly via the existing message encryption pattern
- **Server**: `eciesUnwrapKeyServer(envelope, serverPrivateKey, LABEL_BLAST_CONTENT)` + XChaCha20 decrypt — same pattern as hub key unwrapping
- **Server**: `encryptMessageForStorage(content, pubkeys, LABEL_BLAST_CONTENT)` if the server ever needs to encrypt (e.g., API-created blasts without client encryption)

### Error Handling

- If blast content decryption fails in the processor: mark blast as `failed` with error "content decryption failed", skip delivery
- If admin can't decrypt in UI (wrong key, corrupted): show "encrypted content unavailable" placeholder
- If `contentEnvelopes` is empty (shouldn't happen): treat as unrecoverable error

### Testing

- Unit test: encrypt blast content → decrypt with admin key = original
- Unit test: decrypt with server key (HKDF-derived) = original
- Unit test: wrong key returns null
- Unit test: domain separation (LABEL_BLAST_CONTENT vs LABEL_MESSAGE incompatible)
- API test: create blast → GET returns encrypted content → client decrypts = original
- API test: blast processor decrypts and delivers (integration with TestAdapter)
