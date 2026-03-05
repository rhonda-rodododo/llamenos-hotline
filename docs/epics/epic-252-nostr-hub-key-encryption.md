# Epic 252: Nostr Event Hub-Key Encryption

**Priority**: P0 — Security
**Severity**: HIGH
**Category**: E2EE / Data Confidentiality
**Status**: Pending

## Problem

All Nostr relay events are published with plaintext JSON content. The protocol spec (Section 2.8) requires hub-key encryption: `XChaCha20-Poly1305(HKDF(hub_key, "llamenos:hub-event"), nonce)`. The `LABEL_HUB_EVENT` constant exists but is never used in the publisher path.

Exposed data includes:
- `callerLast4` — partial caller phone number
- `answeredByPubkey` — volunteer's persistent Nostr identity
- `callId`, `language`, `duration` — call timing metadata
- Presence updates, voicemail notifications, conversation assignments

An adversary who operates, compromises, or subpoenas the Nostr relay reads all real-time events in plaintext.

## Affected Files

Two independent publishing paths both have the same bug:

1. **`apps/worker/durable-objects/call-router.ts:484-502`** — `publishNostrEvent()` private method
2. **`apps/worker/lib/nostr-events.ts:5-17`** — `publishNostrEvent()` shared helper used by:
   - `apps/worker/routes/conversations.ts` (lines 268, 312, 380)
   - `apps/worker/routes/reports.ts` (lines 104, 234, 262)
   - `apps/worker/messaging/router.ts`

## Solution

### 1. Add hub-event encryption utility

Create `apps/worker/lib/hub-event-crypto.ts`:

```typescript
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_HUB_EVENT } from '@shared/crypto-labels'

/**
 * Encrypt event content with the hub key per PROTOCOL.md Section 2.8.
 *
 * event_key = HKDF(SHA-256, hub_key, salt=empty, info="llamenos:hub-event", 32)
 * nonce = random(24)
 * ciphertext = XChaCha20-Poly1305(event_key, nonce).encrypt(UTF-8(json))
 * output = hex(nonce || ciphertext)
 */
export function encryptHubEvent(content: Record<string, unknown>, hubKey: Uint8Array): string {
  const eventKey = hkdf(sha256, hubKey, new Uint8Array(0), utf8ToBytes(LABEL_HUB_EVENT), 32)
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(eventKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(content)))
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}
```

### 2. Hub key retrieval

The hub key is stored in SettingsDO at `hub-key:{hubId}` as ECIES-wrapped envelopes. For server-side encryption, we need the raw hub key. Since the server already wraps the hub key for distribution, it must have access to the raw key during wrapping.

**Option A (simpler)**: Store the raw hub key alongside the envelopes in SettingsDO at `hub-key-raw:{hubId}`. The server already has the key during `PUT /api/hubs/:hubId/key`. This is acceptable because the server is trusted for relay event encryption — the E2EE boundary is at the relay, not the server.

**Option B (if hub key not available server-side)**: Fall back to a server-derived symmetric key (`HKDF(SERVER_NOSTR_SECRET, "llamenos:server-event-key")`). This still encrypts against the relay but uses a server key instead of a hub key. Clients would need to know to use this key. Less ideal but functional.

Go with Option A. Update `SettingsDO.setHubKey()` to also store the raw key.

### 3. Update both publishing paths

**`apps/worker/lib/nostr-events.ts`** — Update `publishNostrEvent` to accept a hub key and encrypt:

```typescript
export function publishNostrEvent(
  env: AppEnv['Bindings'],
  kind: number,
  content: Record<string, unknown>,
  hubKey?: Uint8Array,
): void {
  const publisher = getNostrPublisher(env)
  const eventContent = hubKey
    ? encryptHubEvent(content, hubKey)
    : JSON.stringify(content) // Fallback: plaintext only if no hub key configured
  publisher.publish({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'global'], ['t', 'llamenos:event']],
    content: eventContent,
  }).catch(() => {})
}
```

**`apps/worker/durable-objects/call-router.ts`** — Same pattern for the private `publishNostrEvent` method. The CallRouterDO needs access to the hub key. Fetch it from SettingsDO on first use, cache for the DO lifetime.

### 4. Client-side decryption

Clients already have the hub key (received via ECIES-wrapped envelopes). Add `decryptHubEvent()` to:
- `src/client/lib/platform.ts` (desktop — route through Rust IPC)
- `packages/crypto/src/lib.rs` (Rust implementation)
- iOS/Android crypto services

The Rust crate already has `LABEL_HUB_EVENT` in `packages/crypto/src/labels.rs:56`.

## Testing

- Unit test `encryptHubEvent` / `decryptHubEvent` round-trip
- Integration test: publish event, verify relay receives ciphertext not plaintext JSON
- Verify existing Playwright E2E tests still pass (events are decrypted on client)

## Dependencies

- Hub key must be set up via `PUT /api/hubs/:hubId/key` before encryption is active
- Graceful fallback: if no hub key is configured, log a warning but don't crash
