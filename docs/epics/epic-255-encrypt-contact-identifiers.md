# Epic 255: Encrypt Contact Identifiers in ConversationDO

**Priority**: P1 — Security
**Severity**: MEDIUM
**Category**: Data Protection / Zero-Knowledge Violation
**Status**: Pending

## Problem

When an inbound SMS/WhatsApp/Signal message arrives, the raw sender phone number (e.g., `+15551234567`) is stored in plaintext in Durable Object storage at `contact:${conversationId}` (line 423 of `conversation-do.ts`). This identifier is needed for outbound reply routing.

This contradicts the documented threat model:
- `THREAT_MODEL.md`: "Caller phone numbers — Hashed in DO/PostgreSQL — HMAC-SHA256 with operator secret"
- The stated security property "irreversible without operator's HMAC secret" is false because the plaintext is stored alongside the hash
- Storage is indefinite — no TTL, alarm, or deletion mechanism

An adversary who subpoenas Cloudflare obtains the plaintext phone numbers of every person who has texted the crisis hotline. GDPR Articles 17 and 32 are also implicated.

## Affected Files

- `apps/worker/durable-objects/conversation-do.ts:423` — Plaintext storage
- `apps/worker/durable-objects/conversation-do.ts:468-474` — Contact retrieval for outbound sends
- `apps/worker/routes/conversations.ts:227-234` — Uses retrieved identifier for sending

## Solution

### Approach: ECIES-encrypt the contact identifier at storage time

The same envelope encryption pattern used for message content (already implemented in `apps/worker/lib/crypto.ts:82-107`) can be applied to the contact identifier. Encrypt with `ADMIN_DECRYPTION_PUBKEY` so only the server (which holds the decryption capability via ECIES) can recover it for outbound sends.

However, the server can't ECIES-decrypt (it doesn't hold any nsec). The server uses ECIES to *encrypt* for recipients but can't decrypt. We need a different approach.

### Revised Approach: Symmetric encryption with server-derived key

Use `HKDF(HMAC_SECRET, "llamenos:contact-identifier")` to derive a symmetric key. Encrypt the contact identifier with XChaCha20-Poly1305 before storage. The server can decrypt at send time because it has `HMAC_SECRET`.

This provides:
- **Protection against Cloudflare subpoena**: CF doesn't have `HMAC_SECRET` (it's in env vars, not DO storage)
- **Protection against DO storage export**: Ciphertext only, key not stored alongside
- **Operational continuity**: Server can still decrypt for outbound reply routing

```typescript
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'

const LABEL_CONTACT_ID = 'llamenos:contact-identifier'

function encryptContactIdentifier(identifier: string, hmacSecret: string): string {
  const key = hkdf(sha256, hexToBytes(hmacSecret), new Uint8Array(0), utf8ToBytes(LABEL_CONTACT_ID), 32)
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce)
  const ct = cipher.encrypt(utf8ToBytes(identifier))
  const packed = new Uint8Array(24 + ct.length)
  packed.set(nonce)
  packed.set(ct, 24)
  return bytesToHex(packed)
}

function decryptContactIdentifier(encrypted: string, hmacSecret: string): string {
  const key = hkdf(sha256, hexToBytes(hmacSecret), new Uint8Array(0), utf8ToBytes(LABEL_CONTACT_ID), 32)
  const data = hexToBytes(encrypted)
  const nonce = data.slice(0, 24)
  const ct = data.slice(24)
  const cipher = xchacha20poly1305(key, nonce)
  return new TextDecoder().decode(cipher.decrypt(ct))
}
```

### Changes

1. **Add `LABEL_CONTACT_ID`** to `packages/shared/crypto-labels.ts`
2. **Add `encryptContactIdentifier` / `decryptContactIdentifier`** to `apps/worker/lib/crypto.ts`
3. **`conversation-do.ts:423`** — Encrypt before storing:
   ```typescript
   await this.ctx.storage.put(`contact:${conv.id}`, encryptContactIdentifier(incoming.senderIdentifier, this.env.HMAC_SECRET))
   ```
4. **`conversation-do.ts:468-474`** — Decrypt when retrieving:
   ```typescript
   const encrypted = await this.ctx.storage.get<string>(`contact:${conversationId}`)
   const identifier = decryptContactIdentifier(encrypted, this.env.HMAC_SECRET)
   ```
5. **Run `bun run codegen`** to regenerate the new crypto label across platforms

### Migration

Use a version prefix to distinguish encrypted from plaintext values:
- Encrypted values stored as `enc:` + hex ciphertext
- On read, check for `enc:` prefix: if present, strip and decrypt; if absent, it's legacy plaintext — encrypt in-place and re-store (lazy migration)
- This avoids fragile hex-format detection and is forward-compatible
- The `getContactIdentifier` method handles both formats transparently

## Testing

- Unit test `encryptContactIdentifier` / `decryptContactIdentifier` round-trip
- Integration test: inbound message → verify `contact:${id}` storage is ciphertext
- E2E test: outbound reply still works (decrypt-then-send flow)
- Migration test: plaintext entries are encrypted on first run
