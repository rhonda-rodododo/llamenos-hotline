# Sub-Project B: Credential Encryption — Design Spec

**Date:** 2026-03-23
**Parent:** [Provider Auto-Registration Master Spec](2026-03-23-provider-auto-registration-design.md)
**Status:** Draft
**Dependencies:** None — can be built in parallel with Sub-Project A

## Problem

Provider credentials are stored insecurely:

1. **`encryptCredentials()` is fake** — In `src/server/provider-setup/index.ts` lines 364-374, it just hex-encodes:
   ```typescript
   function encryptCredentials(plaintext: string): string {
     const _label = LABEL_PROVIDER_CREDENTIAL_WRAP  // UNUSED!
     return bytesToHex(new TextEncoder().encode(plaintext))
   }
   ```

2. **telephonyConfig.config** — Stores `TelephonyProviderConfig` (with `authToken`, `apiSecret`, `ariPassword`, etc.) as plaintext JSONB.

3. **messagingConfig.config** — Stores `MessagingConfig` (with Signal `bridgeApiKey`, WhatsApp `accessToken`, `appSecret`, etc.) as plaintext JSONB.

4. **geocodingConfig.apiKey** — Plaintext text column.

The `LABEL_PROVIDER_CREDENTIAL_WRAP` constant exists in `src/shared/crypto-labels.ts` and is imported but never actually used for encryption. The server has proven ECIES + XChaCha20-Poly1305 implementations in `src/server/lib/crypto.ts` used for notes, messages, and hub keys.

## Goal

Real symmetric encryption for all provider credentials at rest, using the existing crypto primitives and domain separation constants.

## Design

### Encryption Scheme

**XChaCha20-Poly1305** symmetric encryption keyed from `SERVER_NOSTR_SECRET` via HKDF.

- The server needs runtime read access to credentials (to make API calls to providers), so asymmetric encryption (ECIES) is wrong — the server IS the consumer.
- `SERVER_NOSTR_SECRET` is already a required 64-hex-char secret in every deployment. Deriving a separate key from it for credential encryption uses the existing key management infrastructure.

### Key Derivation

Follows the established codebase pattern from `hub-event-crypto.ts` — empty salt, domain label as info:

```
HKDF-SHA256(
  ikm:  hexToBytes(SERVER_NOSTR_SECRET),
  salt: empty (new Uint8Array(0)),
  info: utf8ToBytes(LABEL_PROVIDER_CREDENTIAL_WRAP),  // 'llamenos:provider-credential-wrap:v1'
  len:  32
)
```

### Functions

**File:** `src/server/lib/crypto.ts` (additions)

New imports required: `hkdf` from `@noble/hashes/hkdf.js` (not currently imported in crypto.ts — used in nostr-publisher.ts and hub-event-crypto.ts).

```typescript
import { hkdf } from '@noble/hashes/hkdf.js'
// sha256 already imported from @noble/hashes/sha2.js
// xchacha20poly1305 already imported from @noble/ciphers/chacha.js
// hexToBytes, bytesToHex already imported from @noble/hashes/utils.js

export function encryptProviderCredentials(plaintext: string, serverSecret: string): string {
  const key = deriveProviderKey(serverSecret)
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext))
  // Manual concat — matches existing pattern in crypto.ts
  const packed = new Uint8Array(24 + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, 24)
  return bytesToHex(packed)
}

export function decryptProviderCredentials(encrypted: string, serverSecret: string): string {
  const bytes = hexToBytes(encrypted)
  const nonce = bytes.slice(0, 24)
  const ciphertext = bytes.slice(24)
  const key = deriveProviderKey(serverSecret)
  const cipher = xchacha20poly1305(key, nonce)
  return new TextDecoder().decode(cipher.decrypt(ciphertext))
}

function deriveProviderKey(serverSecret: string): Uint8Array {
  return hkdf(sha256, hexToBytes(serverSecret), new Uint8Array(0), utf8ToBytes(LABEL_PROVIDER_CREDENTIAL_WRAP), 32)
}
```

### Auto-Migration Concurrency Note

The read-then-re-encrypt migration has a theoretical race condition with concurrent requests. Mitigate with idempotent writes — only update if the stored value hasn't changed since read. Low risk in pre-production but the implementation should handle this.

### Schema Migration

**telephonyConfig.config**: `jsonb` → `text` (encrypted string)
**messagingConfig.config**: `jsonb` → `text` (encrypted string)

New Drizzle migration file. Pre-production, so this is a clean schema change.

### SettingsService Changes

**File:** `src/server/services/settings.ts`

All credential read/write methods gain encrypt/decrypt wrappers:

- `getTelephonyProvider(hubId?)`: decrypt config text → JSON parse → return typed config
- `updateTelephonyProvider(config, hubId?)`: JSON stringify → encrypt → store as text
- `getMessagingConfig(hubId?)`: decrypt → parse → return
- `updateMessagingConfig(data, hubId?)`: merge → stringify → encrypt → store
- `getProviderConfig()`: replace hex-decode with real decrypt
- `setProviderConfig()`: replace hex-encode with real encrypt

The `serverSecret` is passed from the Hono env (`c.env.SERVER_NOSTR_SECRET`) to SettingsService at construction or via a method parameter.

### Auto-Migration of Existing Data

Since the app is pre-production, on `getTelephonyProvider()`:
1. Try `decryptProviderCredentials()`. If AEAD succeeds → return decrypted JSON.
2. If AEAD fails → it's plaintext. JSON parse it, re-encrypt, update DB row, return the parsed config.

Same pattern for `getMessagingConfig()` and `getProviderConfig()` (which currently stores hex-encoded data — hex decode will succeed but AEAD will fail since there's no nonce/tag).

### Scope

| Table | Column | Current | After |
|-------|--------|---------|-------|
| `provider_config` | `encryptedCredentials` | Hex-encoded text | XChaCha20-Poly1305 encrypted text |
| `telephony_config` | `config` | Plaintext JSONB | Encrypted text column |
| `messaging_config` | `config` | Plaintext JSONB | Encrypted text column |
| `geocoding_config` | `apiKey` | Plaintext text | Encrypted text |

### Files Changed

- `src/server/lib/crypto.ts` — ADD: `encryptProviderCredentials()`, `decryptProviderCredentials()`, `deriveProviderKey()`
- `src/server/provider-setup/index.ts` — REPLACE: fake `encryptCredentials()`/`decryptCredentials()` with real ones
- `src/server/services/settings.ts` — ADD: encrypt on write, decrypt on read for all credential stores
- `src/server/db/schema/settings.ts` — CHANGE: `telephonyConfig.config` from `jsonb` to `text`, `messagingConfig.config` from `jsonb` to `text`
- `src/server/db/migrations/` — NEW: migration for schema changes
- `src/shared/crypto-labels.ts` — No changes needed (label already exists)

### Testing

- E2E test: encrypt → decrypt roundtrip produces original plaintext
- E2E test: decrypting with wrong key fails with AEAD error
- E2E test: auto-migration detects plaintext data and re-encrypts
- E2E test: SettingsService stores encrypted data, retrieves decrypted data
- E2E test: the `provider_config` hex-encoded legacy data is migrated on read
