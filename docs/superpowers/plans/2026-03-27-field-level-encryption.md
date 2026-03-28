# Field-Level Encryption Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic, type-safe encryption infrastructure and encrypt all identity, credential, and device data across 12 database tables so that a seized database yields zero actionable intelligence.

**Architecture:** Shared crypto primitives (`src/shared/crypto-primitives.ts`) provide the low-level ECIES/XChaCha20/HMAC operations. Server-side `CryptoService` and client-side `ClientCryptoService` wrap these with key management. Branded TypeScript types (`Ciphertext`, `HmacHash`) with Drizzle column helpers make it a compile-time error to store plaintext in encrypted columns. Schema migrations add encrypted columns alongside plaintext, a backfill script encrypts existing data, and a final migration drops plaintext columns.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), @noble/ciphers (XChaCha20-Poly1305), @noble/curves (secp256k1 ECIES), @noble/hashes (SHA-256, HMAC, HKDF), bun:test

**Spec:** `docs/superpowers/specs/2026-03-27-field-level-encryption-design.md`

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `src/shared/crypto-types.ts` | Branded types: `Ciphertext`, `HmacHash` |
| `src/shared/crypto-primitives.ts` | Pure crypto functions shared between server and client |
| `src/shared/crypto-primitives.test.ts` | Unit tests for shared primitives |
| `src/server/lib/crypto-service.ts` | `CryptoService` class — unified server-side encryption API |
| `src/server/lib/crypto-service.test.ts` | Unit tests for CryptoService |
| `src/client/lib/crypto-service.ts` | `ClientCryptoService` class — unified client-side encryption API |
| `src/client/lib/crypto-service.test.ts` | Unit tests for ClientCryptoService |
| `src/server/db/crypto-columns.ts` | Drizzle column helpers: `ciphertext()`, `hmacHashed()` |
| `scripts/migrate-encrypt-pii.ts` | One-time backfill script to encrypt existing plaintext data |

### Modified files

| File | Changes |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_VOLUNTEER_PII`, `LABEL_EPHEMERAL_CALL`, `LABEL_PUSH_CREDENTIAL` |
| `src/server/lib/crypto.ts` | Refactor all functions to delegate to `crypto-primitives.ts`, then delete |
| `src/client/lib/crypto.ts` | Refactor all functions to delegate to `crypto-primitives.ts`, then delete |
| `src/server/db/schema/identity.ts` | Encrypt volunteer name/phone, invite name/phone, webauthn label |
| `src/server/db/schema/calls.ts` | Encrypt active_calls.caller_number, call_legs.phone |
| `src/server/db/schema/records.ts` | Encrypt bans phone/reason, call_records.caller_last4 |
| `src/server/db/schema/conversations.ts` | Encrypt conversations.contact_last4 |
| `src/server/db/schema/settings.ts` | Encrypt geocoding_config.api_key, signal_registration_pending.number, provider_config SIDs |
| `src/server/db/schema/push-subscriptions.ts` | Encrypt endpoint, auth_key, p256dh_key, device_label |
| `src/server/services/index.ts` | Pass `CryptoService` to all services that need it |
| `src/server/services/identity.ts` | Use CryptoService for volunteer/invite encrypt/decrypt |
| `src/server/services/records.ts` | Use CryptoService for bans, call records |
| `src/server/services/calls.ts` | Use CryptoService for active calls, call legs |
| `src/server/services/conversations.ts` | Use CryptoService for contact_last4 |
| `src/server/services/settings.ts` | Use CryptoService for geocoding, signal reg, provider config |
| `src/server/lib/ringing.ts` | Decrypt volunteer phone JIT for routing |
| `src/server/server.ts` | Create CryptoService instance, pass to createServices |

---

## Task 1: Shared Crypto Types

**Files:**
- Create: `src/shared/crypto-types.ts`

- [ ] **Step 1: Create branded types file**

```typescript
// src/shared/crypto-types.ts

/**
 * Branded types for field-level encryption.
 *
 * These types are structurally identical to `string` at runtime but TypeScript
 * treats them as incompatible with plain `string`. This makes it a compile-time
 * error to store plaintext in an encrypted column or read ciphertext without
 * going through the CryptoService.
 */

/** Encrypted ciphertext — hex-encoded nonce(24) || XChaCha20-Poly1305 ciphertext */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' }

/** HMAC-SHA256 hash — hex-encoded, one-way, cannot be reversed */
export type HmacHash = string & { readonly __brand: 'HmacHash' }
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && npx tsc --noEmit src/shared/crypto-types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/crypto-types.ts
git commit -m "feat(crypto): add branded Ciphertext and HmacHash types"
```

---

## Task 2: Drizzle Column Helpers

**Files:**
- Create: `src/server/db/crypto-columns.ts`

- [ ] **Step 1: Create column helpers**

```typescript
// src/server/db/crypto-columns.ts
import { text } from 'drizzle-orm/pg-core'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'

/** Text column storing XChaCha20-Poly1305 ciphertext (hex-encoded nonce || ciphertext) */
export const ciphertext = (name: string) => text(name).$type<Ciphertext>()

/** Text column storing an HMAC-SHA256 hash (hex-encoded) */
export const hmacHashed = (name: string) => text(name).$type<HmacHash>()
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && npx tsc --noEmit src/server/db/crypto-columns.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/db/crypto-columns.ts
git commit -m "feat(crypto): add Drizzle ciphertext() and hmacHashed() column helpers"
```

---

## Task 3: New Crypto Labels

**Files:**
- Modify: `src/shared/crypto-labels.ts`

- [ ] **Step 1: Add new domain separation labels**

Append to `src/shared/crypto-labels.ts`:

```typescript
// --- Field-Level Encryption (Phase 1) ---

/** Server-key encryption of volunteer/invite PII (phone numbers) */
export const LABEL_VOLUNTEER_PII = 'llamenos:volunteer-pii:v1'

/** Server-key encryption of ephemeral call data (caller numbers during active calls) */
export const LABEL_EPHEMERAL_CALL = 'llamenos:ephemeral-call:v1'

/** Server-key encryption of push notification credentials (endpoints, auth keys) */
export const LABEL_PUSH_CREDENTIAL = 'llamenos:push-credential:v1'
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/crypto-labels.ts
git commit -m "feat(crypto): add LABEL_VOLUNTEER_PII, LABEL_EPHEMERAL_CALL, LABEL_PUSH_CREDENTIAL labels"
```

---

## Task 4: Shared Crypto Primitives

**Files:**
- Create: `src/shared/crypto-primitives.ts`
- Create: `src/shared/crypto-primitives.test.ts`

- [ ] **Step 1: Write failing tests for shared primitives**

```typescript
// src/shared/crypto-primitives.test.ts
import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  eciesWrapKey,
  eciesUnwrapKey,
  symmetricEncrypt,
  symmetricDecrypt,
  hmacSha256,
  hkdfDerive,
} from './crypto-primitives'

describe('symmetricEncrypt / symmetricDecrypt', () => {
  test('round-trip with random key', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const plaintext = new TextEncoder().encode('hello world')

    const packed = symmetricEncrypt(plaintext, key)
    const recovered = symmetricDecrypt(packed, key)

    expect(new TextDecoder().decode(recovered)).toBe('hello world')
  })

  test('different nonce each time', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const plaintext = new TextEncoder().encode('same input')

    const a = symmetricEncrypt(plaintext, key)
    const b = symmetricEncrypt(plaintext, key)

    expect(a).not.toBe(b)
  })

  test('wrong key fails', () => {
    const key1 = new Uint8Array(32)
    crypto.getRandomValues(key1)
    const key2 = new Uint8Array(32)
    crypto.getRandomValues(key2)
    const plaintext = new TextEncoder().encode('secret')

    const packed = symmetricEncrypt(plaintext, key1)
    expect(() => symmetricDecrypt(packed, key2)).toThrow()
  })
})

describe('eciesWrapKey / eciesUnwrapKey', () => {
  test('round-trip key wrapping', () => {
    const recipientSecret = new Uint8Array(32)
    crypto.getRandomValues(recipientSecret)
    const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))

    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)

    const envelope = eciesWrapKey(messageKey, recipientPubkey, 'test:label')
    const recovered = eciesUnwrapKey(envelope, recipientSecret, 'test:label')

    expect(bytesToHex(recovered)).toBe(bytesToHex(messageKey))
  })

  test('wrong label fails', () => {
    const recipientSecret = new Uint8Array(32)
    crypto.getRandomValues(recipientSecret)
    const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))

    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)

    const envelope = eciesWrapKey(messageKey, recipientPubkey, 'label:a')
    expect(() => eciesUnwrapKey(envelope, recipientSecret, 'label:b')).toThrow()
  })
})

describe('hmacSha256', () => {
  test('deterministic', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const input = new TextEncoder().encode('phone:+15551234567')

    const a = hmacSha256(key, input)
    const b = hmacSha256(key, input)

    expect(bytesToHex(a)).toBe(bytesToHex(b))
  })

  test('different input gives different hash', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)

    const a = hmacSha256(key, new TextEncoder().encode('a'))
    const b = hmacSha256(key, new TextEncoder().encode('b'))

    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })
})

describe('hkdfDerive', () => {
  test('deterministic derivation', () => {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    const salt = new Uint8Array(0)
    const info = new TextEncoder().encode('test:context')

    const a = hkdfDerive(secret, salt, info, 32)
    const b = hkdfDerive(secret, salt, info, 32)

    expect(bytesToHex(a)).toBe(bytesToHex(b))
  })

  test('different info gives different key', () => {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    const salt = new Uint8Array(0)

    const a = hkdfDerive(secret, salt, new TextEncoder().encode('context:a'), 32)
    const b = hkdfDerive(secret, salt, new TextEncoder().encode('context:b'), 32)

    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test src/shared/crypto-primitives.test.ts`
Expected: FAIL — module `./crypto-primitives` not found

- [ ] **Step 3: Implement shared primitives**

```typescript
// src/shared/crypto-primitives.ts
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

/**
 * Symmetric encryption using XChaCha20-Poly1305.
 * Returns hex-encoded: nonce(24 bytes) || ciphertext.
 */
export function symmetricEncrypt(plaintext: Uint8Array, key: Uint8Array): string {
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

/**
 * Symmetric decryption using XChaCha20-Poly1305.
 * Input: hex-encoded nonce(24) || ciphertext.
 */
export function symmetricDecrypt(packed: string, key: Uint8Array): Uint8Array {
  const data = hexToBytes(packed)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(key, nonce)
  return cipher.decrypt(ciphertext)
}

/**
 * ECIES key wrapping for a single recipient.
 * Generates ephemeral secp256k1 keypair, derives shared secret via ECDH,
 * derives symmetric key via SHA-256(label || sharedX), wraps with XChaCha20-Poly1305.
 */
export function eciesWrapKey(
  key: Uint8Array,
  recipientPubkeyHex: string,
  label: string
): { wrappedKey: string; ephemeralPubkey: string } {
  const ephemeralSecret = new Uint8Array(32)
  crypto.getRandomValues(ephemeralSecret)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(key)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    wrappedKey: bytesToHex(packed),
    ephemeralPubkey: bytesToHex(ephemeralPublicKey),
  }
}

/**
 * ECIES key unwrapping. Recovers the symmetric key from an ECIES envelope.
 */
export function eciesUnwrapKey(
  envelope: { wrappedKey: string; ephemeralPubkey: string },
  privateKey: Uint8Array,
  label: string
): Uint8Array {
  const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
  const shared = secp256k1.getSharedSecret(privateKey, ephemeralPub)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const packed = hexToBytes(envelope.wrappedKey)
  const nonce = packed.slice(0, 24)
  const ciphertext = packed.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
}

/**
 * HMAC-SHA256. Returns raw bytes (caller converts to hex as needed).
 */
export function hmacSha256(key: Uint8Array, input: Uint8Array): Uint8Array {
  return hmac(sha256, key, input)
}

/**
 * HKDF-SHA256 key derivation.
 */
export function hkdfDerive(
  secret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  return hkdf(sha256, secret, salt, info, length)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test src/shared/crypto-primitives.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-primitives.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto): add shared crypto primitives with tests"
```

---

## Task 5: Server-Side CryptoService

**Files:**
- Create: `src/server/lib/crypto-service.ts`
- Create: `src/server/lib/crypto-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/lib/crypto-service.test.ts
import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { HMAC_PHONE_PREFIX, LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { CryptoService } from './crypto-service'

const TEST_SERVER_SECRET = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000002'

describe('CryptoService', () => {
  const crypto = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)

  describe('serverEncrypt / serverDecrypt', () => {
    test('round-trip', () => {
      const ct = crypto.serverEncrypt('hello', LABEL_VOLUNTEER_PII)
      const pt = crypto.serverDecrypt(ct, LABEL_VOLUNTEER_PII)
      expect(pt).toBe('hello')
    })

    test('different nonce each time', () => {
      const a = crypto.serverEncrypt('same', LABEL_VOLUNTEER_PII)
      const b = crypto.serverEncrypt('same', LABEL_VOLUNTEER_PII)
      expect(a).not.toBe(b)
    })

    test('wrong label fails', () => {
      const ct = crypto.serverEncrypt('secret', LABEL_VOLUNTEER_PII)
      expect(() => crypto.serverDecrypt(ct, 'wrong:label')).toThrow()
    })
  })

  describe('hmac', () => {
    test('deterministic', () => {
      const a = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      const b = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      expect(a).toBe(b)
    })

    test('different label gives different hash', () => {
      const a = crypto.hmac('+15551234567', 'label:a')
      const b = crypto.hmac('+15551234567', 'label:b')
      expect(a).not.toBe(b)
    })
  })

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('round-trip with single recipient', () => {
      const recipientSecret = new Uint8Array(32)
      crypto.getRandomValues(recipientSecret)
      const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'secret message',
        [recipientPubkey],
        LABEL_VOLUNTEER_PII
      )

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(recipientPubkey)

      const pt = crypto.envelopeDecrypt(encrypted, envelopes[0], recipientSecret, LABEL_VOLUNTEER_PII)
      expect(pt).toBe('secret message')
    })

    test('multiple recipients can each decrypt', () => {
      const secret1 = new Uint8Array(32)
      crypto.getRandomValues(secret1)
      const pub1 = bytesToHex(secp256k1.getPublicKey(secret1, true).slice(1))

      const secret2 = new Uint8Array(32)
      crypto.getRandomValues(secret2)
      const pub2 = bytesToHex(secp256k1.getPublicKey(secret2, true).slice(1))

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'shared secret',
        [pub1, pub2],
        LABEL_VOLUNTEER_PII
      )

      expect(envelopes).toHaveLength(2)

      const env1 = envelopes.find(e => e.pubkey === pub1)!
      const env2 = envelopes.find(e => e.pubkey === pub2)!

      expect(crypto.envelopeDecrypt(encrypted, env1, secret1, LABEL_VOLUNTEER_PII)).toBe('shared secret')
      expect(crypto.envelopeDecrypt(encrypted, env2, secret2, LABEL_VOLUNTEER_PII)).toBe('shared secret')
    })
  })

  describe('hubEncrypt / hubDecrypt', () => {
    test('round-trip', () => {
      const hubKey = new Uint8Array(32)
      crypto.getRandomValues(hubKey)

      const ct = crypto.hubEncrypt('hub data', hubKey)
      const pt = crypto.hubDecrypt(ct, hubKey)
      expect(pt).toBe('hub data')
    })

    test('wrong key returns null', () => {
      const key1 = new Uint8Array(32)
      crypto.getRandomValues(key1)
      const key2 = new Uint8Array(32)
      crypto.getRandomValues(key2)

      const ct = crypto.hubEncrypt('data', key1)
      expect(crypto.hubDecrypt(ct, key2)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test src/server/lib/crypto-service.test.ts`
Expected: FAIL — module `./crypto-service` not found

- [ ] **Step 3: Implement CryptoService**

```typescript
// src/server/lib/crypto-service.ts
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import {
  LABEL_HUB_KEY_WRAP,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
} from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import {
  eciesWrapKey,
  eciesUnwrapKey,
  symmetricEncrypt,
  symmetricDecrypt,
  hmacSha256,
  hkdfDerive,
} from '@shared/crypto-primitives'

export class CryptoService {
  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string
  ) {}

  // ── Server-key encryption ──

  serverEncrypt(plaintext: string, label: string): Ciphertext {
    const key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    return symmetricEncrypt(utf8ToBytes(plaintext), key) as Ciphertext
  }

  serverDecrypt(ct: Ciphertext, label: string): string {
    const key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    return new TextDecoder().decode(symmetricDecrypt(ct, key))
  }

  // ── Hub-key encryption ──

  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey) as Ciphertext
  }

  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null {
    try {
      return new TextDecoder().decode(symmetricDecrypt(ct, hubKey))
    } catch {
      return null
    }
  }

  // ── HMAC hashing ──

  hmac(input: string, label: string): HmacHash {
    const key = hexToBytes(this.hmacSecret)
    const data = utf8ToBytes(`${label}${input}`)
    return bytesToHex(hmacSha256(key, data)) as HmacHash
  }

  // ── Envelope encryption ──

  envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)

    const encrypted = symmetricEncrypt(utf8ToBytes(plaintext), messageKey) as Ciphertext

    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(messageKey, pk, label),
    }))

    return { encrypted, envelopes }
  }

  envelopeDecrypt(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    secretKey: Uint8Array,
    label: string
  ): string {
    const messageKey = eciesUnwrapKey(envelope, secretKey, label)
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey))
  }

  // ── Binary envelope ──

  envelopeEncryptBinary(
    data: Uint8Array,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)

    const encrypted = symmetricEncrypt(data, dataKey) as Ciphertext

    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(dataKey, pk, label),
    }))

    return { encrypted, envelopes }
  }

  envelopeDecryptBinary(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    secretKey: Uint8Array,
    label: string
  ): Uint8Array {
    const dataKey = eciesUnwrapKey(envelope, secretKey, label)
    return symmetricDecrypt(ct, dataKey)
  }

  // ── Hub key management ──

  unwrapHubKey(
    envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
  ): Uint8Array {
    const serverPrivateKey = hkdfDerive(
      hexToBytes(this.serverSecret),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
      32
    )
    const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

    const envelope = envelopes.find((e) => e.pubkey === serverPubkey)
    if (!envelope) {
      throw new Error(`No hub key envelope for server pubkey ${serverPubkey}`)
    }

    return eciesUnwrapKey(envelope, serverPrivateKey, LABEL_HUB_KEY_WRAP)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test src/server/lib/crypto-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/crypto-service.ts src/server/lib/crypto-service.test.ts
git commit -m "feat(crypto): add CryptoService with server-key, hub-key, HMAC, and envelope encryption"
```

---

## Task 6: Client-Side CryptoService

**Files:**
- Create: `src/client/lib/crypto-service.ts`
- Create: `src/client/lib/crypto-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/crypto-service.test.ts
import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { ClientCryptoService } from './crypto-service'

describe('ClientCryptoService', () => {
  const secretKey = new Uint8Array(32)
  crypto.getRandomValues(secretKey)
  const pubkey = bytesToHex(secp256k1.getPublicKey(secretKey, true).slice(1))
  const client = new ClientCryptoService(secretKey, pubkey)

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('self-encrypt round-trip', () => {
      const { encrypted, envelopes } = client.envelopeEncrypt(
        'my name',
        [pubkey],
        LABEL_VOLUNTEER_PII
      )

      const pt = client.envelopeDecrypt(encrypted, envelopes, LABEL_VOLUNTEER_PII)
      expect(pt).toBe('my name')
    })

    test('encrypt for self + other recipient', () => {
      const otherSecret = new Uint8Array(32)
      crypto.getRandomValues(otherSecret)
      const otherPub = bytesToHex(secp256k1.getPublicKey(otherSecret, true).slice(1))
      const otherClient = new ClientCryptoService(otherSecret, otherPub)

      const { encrypted, envelopes } = client.envelopeEncrypt(
        'shared',
        [pubkey, otherPub],
        LABEL_VOLUNTEER_PII
      )

      expect(client.envelopeDecrypt(encrypted, envelopes, LABEL_VOLUNTEER_PII)).toBe('shared')
      expect(otherClient.envelopeDecrypt(encrypted, envelopes, LABEL_VOLUNTEER_PII)).toBe('shared')
    })
  })

  describe('hubEncrypt / hubDecrypt', () => {
    test('round-trip', () => {
      const hubKey = new Uint8Array(32)
      crypto.getRandomValues(hubKey)

      const ct = client.hubEncrypt('hub data', hubKey)
      expect(client.hubDecrypt(ct, hubKey)).toBe('hub data')
    })
  })

  describe('encryptDraft / decryptDraft', () => {
    test('round-trip', () => {
      const ct = client.encryptDraft('draft text')
      const pt = client.decryptDraft(ct)
      expect(pt).toBe('draft text')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test src/client/lib/crypto-service.test.ts`
Expected: FAIL — module `./crypto-service` not found

- [ ] **Step 3: Implement ClientCryptoService**

```typescript
// src/client/lib/crypto-service.ts
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { Ciphertext } from '@shared/crypto-types'
import { HKDF_SALT } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import {
  eciesWrapKey,
  eciesUnwrapKey,
  symmetricEncrypt,
  symmetricDecrypt,
  hkdfDerive,
} from '@shared/crypto-primitives'

export class ClientCryptoService {
  constructor(
    private readonly secretKey: Uint8Array,
    private readonly pubkey: string
  ) {}

  // ── Envelope encryption ──

  envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)

    const encrypted = symmetricEncrypt(utf8ToBytes(plaintext), messageKey) as Ciphertext

    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(messageKey, pk, label),
    }))

    return { encrypted, envelopes }
  }

  envelopeDecrypt(
    ct: Ciphertext,
    envelopes: RecipientEnvelope[],
    label: string
  ): string {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const messageKey = eciesUnwrapKey(envelope, this.secretKey, label)
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey))
  }

  // ── Hub-key operations ──

  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey) as Ciphertext
  }

  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null {
    try {
      return new TextDecoder().decode(symmetricDecrypt(ct, hubKey))
    } catch {
      return null
    }
  }

  // ── Binary envelope ──

  envelopeEncryptBinary(
    data: Uint8Array,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)

    const encrypted = symmetricEncrypt(data, dataKey) as Ciphertext

    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(dataKey, pk, label),
    }))

    return { encrypted, envelopes }
  }

  envelopeDecryptBinary(
    ct: Ciphertext,
    envelopes: RecipientEnvelope[],
    label: string
  ): Uint8Array {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const dataKey = eciesUnwrapKey(envelope, this.secretKey, label)
    return symmetricDecrypt(ct, dataKey)
  }

  // ── Draft encryption ──

  encryptDraft(plaintext: string): Ciphertext {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes('llamenos:drafts'),
      32
    )
    return symmetricEncrypt(utf8ToBytes(plaintext), key) as Ciphertext
  }

  decryptDraft(ct: Ciphertext): string {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes('llamenos:drafts'),
      32
    )
    return new TextDecoder().decode(symmetricDecrypt(ct, key))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test src/client/lib/crypto-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/crypto-service.ts src/client/lib/crypto-service.test.ts
git commit -m "feat(crypto): add ClientCryptoService with envelope, hub-key, and draft encryption"
```

---

## Task 7: Wire CryptoService into Server Startup

**Files:**
- Modify: `src/server/services/index.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Update createServices to accept CryptoService**

In `src/server/services/index.ts`, change the `createServices` function to accept a `CryptoService` instance and pass it to services that need it. Read the current file first to see exact line numbers, then:

1. Add import: `import type { CryptoService } from '../lib/crypto-service'`
2. Change the `createServices` signature to replace `serverSecret = ''` with `crypto: CryptoService`
3. Pass `crypto` to `SettingsService` (which currently takes `serverSecret`), and to `IdentityService`, `RecordsService`, `CallService`, `ConversationService`, `PushService` — all of which will need it in later tasks

For now, only `SettingsService` uses encryption. The other services will get `crypto` passed but won't use it until their schema tasks are implemented. This avoids breaking changes — each service stores the reference but its behavior is unchanged until the schema migration task.

- [ ] **Step 2: Update SettingsService constructor**

In `src/server/services/settings.ts`, change the constructor to accept `CryptoService` instead of raw `serverSecret`:

```typescript
import { CryptoService } from '../lib/crypto-service'

// In constructor:
constructor(
  protected readonly db: Database,
  private readonly crypto: CryptoService
) {}
```

Then replace all `this.serverSecret` references with calls to `this.crypto.serverEncrypt()` / `this.crypto.serverDecrypt()` using the appropriate labels. Read the file first to identify all call sites (approximately 8 uses of `encryptProviderCredentials`/`decryptProviderCredentials` and the storage credential functions).

- [ ] **Step 3: Update server.ts startup**

In `src/server/server.ts`, create a `CryptoService` instance and pass it to `createServices`:

```typescript
import { CryptoService } from './lib/crypto-service'

// After loadEnv():
const crypto = new CryptoService(env.SERVER_NOSTR_SECRET ?? '', env.HMAC_SECRET)
const services = createServices(db, storage, crypto)
```

- [ ] **Step 4: Run existing tests to verify nothing breaks**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test`
Expected: All existing tests PASS (behavior unchanged, just new plumbing)

- [ ] **Step 5: Commit**

```bash
git add src/server/services/index.ts src/server/services/settings.ts src/server/server.ts
git commit -m "refactor: wire CryptoService into server startup and SettingsService"
```

---

## Task 8: Schema Migration — Add Encrypted Columns

**Files:**
- Modify: `src/server/db/schema/identity.ts`
- Modify: `src/server/db/schema/calls.ts`
- Modify: `src/server/db/schema/records.ts`
- Modify: `src/server/db/schema/conversations.ts`
- Modify: `src/server/db/schema/settings.ts`
- Modify: `src/server/db/schema/push-subscriptions.ts`

This task adds encrypted columns alongside the existing plaintext columns. The plaintext columns remain for the transition period. A Drizzle migration is generated after all schema changes.

- [ ] **Step 1: Update identity.ts schema**

Read `src/server/db/schema/identity.ts` and add encrypted columns to `volunteers`, `inviteCodes`, and `webauthnCredentials`. Add imports for `ciphertext`, `hmacHashed` from `../crypto-columns` and `RecipientEnvelope` from `@shared/types`. The existing plaintext `name`, `phone`, `label` columns stay — they'll be removed in Task 12.

For `volunteers`: add `encryptedName` (ciphertext, nullable), `nameEnvelopes` (jsonb, default []), `encryptedPhone` (ciphertext, nullable).

For `inviteCodes`: add `encryptedName` (ciphertext, nullable), `nameEnvelopes` (jsonb, default []), `encryptedPhone` (ciphertext, nullable). Change `recipientPhoneHash` type to use `hmacHashed()`.

For `webauthnCredentials`: add `encryptedLabel` (ciphertext, nullable), `labelEnvelopes` (jsonb, default []).

- [ ] **Step 2: Update calls.ts schema**

Add `encryptedCallerNumber` (ciphertext, nullable) to `activeCalls`.
Add `encryptedPhone` (ciphertext, nullable) to `callLegs`.

- [ ] **Step 3: Update records.ts schema**

Add to `bans`: `phoneHash` (hmacHashed, nullable), `encryptedPhone` (ciphertext, nullable), `phoneEnvelopes` (jsonb, default []), `encryptedReason` (ciphertext, nullable), `reasonEnvelopes` (jsonb, default []).

Add to `callRecords`: `encryptedCallerLast4` (ciphertext, nullable), `callerLast4Envelopes` (jsonb, default []).

- [ ] **Step 4: Update conversations.ts schema**

Add to `conversations`: `encryptedContactLast4` (ciphertext, nullable), `contactLast4Envelopes` (jsonb, default []).

- [ ] **Step 5: Update settings.ts schema**

Rename `geocodingConfig.apiKey` column to `encryptedApiKey` and change to ciphertext type (nullable during migration).

Rename `signalRegistrationPending.number` column to `encryptedNumber` and change to ciphertext type (nullable during migration).

Add to `providerConfig`: `encryptedBrandSid` (ciphertext, nullable), `encryptedCampaignSid` (ciphertext, nullable), `encryptedMessagingServiceSid` (ciphertext, nullable). Re-type `encryptedCredentials` to use `ciphertext()`.

- [ ] **Step 6: Update push-subscriptions.ts schema**

Add `endpointHash` (hmacHashed, nullable, unique), `encryptedEndpoint` (ciphertext, nullable), `encryptedAuthKey` (ciphertext, nullable), `encryptedP256dhKey` (ciphertext, nullable), `encryptedDeviceLabel` (ciphertext, nullable), `deviceLabelEnvelopes` (jsonb, default []).

- [ ] **Step 7: Generate and verify Drizzle migration**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && npx drizzle-kit generate`

Review the generated SQL migration file in `drizzle/migrations/` to verify:
- All new columns are nullable (no NOT NULL during transition)
- No existing columns are dropped
- Column renames (geocoding, signal) are correct

- [ ] **Step 8: Apply migration to dev database**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun run src/server/db/migrate.ts` (or equivalent migration command)

Verify with: `docker exec llamenos-postgres-1 psql -U llamenos -d llamenos -c "\d volunteers"` — should show both `name` and `encrypted_name` columns.

- [ ] **Step 9: Commit**

```bash
git add src/server/db/schema/ src/server/db/crypto-columns.ts drizzle/
git commit -m "feat(schema): add encrypted columns alongside plaintext for 12 tables"
```

---

## Task 9: Service Layer — Encrypt on Write, Dual-Read

This is the largest task. Each service that writes to or reads from an affected table must be updated to:
1. Write to encrypted columns (all new writes)
2. Read from encrypted columns when populated, fall back to plaintext

**Files:**
- Modify: `src/server/services/identity.ts` — volunteers, invites
- Modify: `src/server/services/records.ts` — bans, call records
- Modify: `src/server/services/calls.ts` — active calls, call legs
- Modify: `src/server/services/conversations.ts` — contact_last4
- Modify: `src/server/services/settings.ts` — geocoding, signal reg, provider config
- Modify: `src/server/lib/ringing.ts` — volunteer phone decryption for routing

For each service:

- [ ] **Step 1: Update IdentityService**

Add `CryptoService` to the constructor. Read the current file to find all places where `volunteers.name`, `volunteers.phone`, `inviteCodes.name`, `inviteCodes.phone` are read or written.

For writes: encrypt with `crypto.serverEncrypt()` for phone, and for E2EE fields (name), use `crypto.envelopeEncrypt()` with server pubkey + admin pubkeys as bootstrap recipients.

For reads: use dual-read pattern — `row.encryptedPhone ? crypto.serverDecrypt(row.encryptedPhone, LABEL_VOLUNTEER_PII) : row.phone`.

For webauthn credential labels: similar dual-read on label.

- [ ] **Step 2: Update RecordsService**

Add `CryptoService` to the constructor. Update ban creation to hash phone (`crypto.hmac()`) and envelope-encrypt phone + reason. Update ban checking to compare hashes. Update call record creation to envelope-encrypt `callerLast4` for admin pubkeys.

For reads: dual-read pattern on all encrypted fields.

- [ ] **Step 3: Update CallService**

Add `CryptoService` to the constructor. Update `createActiveCall` to encrypt `callerNumber`. Update `createCallLeg` to encrypt `phone`. Update reads to decrypt.

- [ ] **Step 4: Update ConversationService**

Add `CryptoService` to the constructor. Update conversation creation to envelope-encrypt `contactLast4`. Update reads to return encrypted data + envelopes for client-side decryption.

- [ ] **Step 5: Update SettingsService**

Already has `CryptoService` from Task 7. Update geocoding config to encrypt/decrypt `apiKey`. Update signal registration to encrypt/decrypt `number`. Update provider config to encrypt/decrypt `brandSid`, `campaignSid`, `messagingServiceSid`.

- [ ] **Step 6: Update PushService**

Add `CryptoService` to the constructor. Update push subscription creation to encrypt endpoint, auth_key, p256dh_key with server-key and device_label with envelope. Update reads to decrypt.

- [ ] **Step 7: Update ringing.ts**

In `startParallelRinging`, the call to `services.identity.getVolunteers()` now returns encrypted data. Ensure the identity service returns decrypted phones for routing. The service handles decryption internally — `getVolunteers()` returns `{ name: string, phone: string }` (decrypted), not the raw ciphertext. This is the service boundary principle: encryption is transparent above the service layer.

- [ ] **Step 8: Run all tests**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test`
Expected: All tests PASS. The dual-read pattern means existing tests that insert plaintext still work (fallback path).

- [ ] **Step 9: Commit**

```bash
git add src/server/services/ src/server/lib/ringing.ts
git commit -m "feat(crypto): encrypt on write, dual-read for all 12 tables"
```

---

## Task 10: Backfill Script

**Files:**
- Create: `scripts/migrate-encrypt-pii.ts`

- [ ] **Step 1: Write the backfill script**

```typescript
// scripts/migrate-encrypt-pii.ts
/**
 * One-time migration: encrypt all existing plaintext PII in the database.
 *
 * E2EE fields are bootstrapped with server pubkey + admin pubkeys as envelope recipients.
 * After this script runs, all new writes go to encrypted columns via the service layer.
 * Future E2EE writes originate from the client.
 *
 * Idempotent: skips rows where encrypted columns are already populated.
 *
 * Usage: bun run scripts/migrate-encrypt-pii.ts
 */
import { eq, isNull } from 'drizzle-orm'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { loadEnv } from '../src/server/env'
import { createDatabase } from '../src/server/db'
import { CryptoService } from '../src/server/lib/crypto-service'
import {
  HMAC_PHONE_PREFIX,
  LABEL_VOLUNTEER_PII,
  LABEL_EPHEMERAL_CALL,
  LABEL_PUSH_CREDENTIAL,
  LABEL_PROVIDER_CREDENTIAL_WRAP,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
} from '../src/shared/crypto-labels'
import { hkdfDerive } from '../src/shared/crypto-primitives'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import * as schema from '../src/server/db/schema'

async function main() {
  const env = loadEnv()
  const db = createDatabase(env.DATABASE_URL)
  const crypto = new CryptoService(env.SERVER_NOSTR_SECRET ?? '', env.HMAC_SECRET)

  // Derive server pubkey for E2EE bootstrap envelopes
  const serverPrivateKey = hkdfDerive(
    hexToBytes(env.SERVER_NOSTR_SECRET ?? ''),
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
    32
  )
  const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

  // Get admin pubkey for envelope recipients
  const adminPubkey = env.ADMIN_PUBKEY
  const envelopeRecipients = [serverPubkey, adminPubkey].filter(Boolean)

  console.log('[migrate] Starting PII encryption backfill...')
  console.log(`[migrate] Envelope recipients: ${envelopeRecipients.length} pubkeys`)

  // ── Volunteers ──
  const volunteers = await db.select().from(schema.volunteers).where(isNull(schema.volunteers.encryptedPhone))
  console.log(`[migrate] volunteers: ${volunteers.length} rows to encrypt`)
  for (const row of volunteers) {
    const { encrypted: encName, envelopes: nameEnv } = crypto.envelopeEncrypt(
      row.name, [...envelopeRecipients, row.pubkey], LABEL_VOLUNTEER_PII
    )
    const encPhone = crypto.serverEncrypt(row.phone, LABEL_VOLUNTEER_PII)
    await db.update(schema.volunteers).set({
      encryptedName: encName, nameEnvelopes: nameEnv,
      encryptedPhone: encPhone,
    }).where(eq(schema.volunteers.pubkey, row.pubkey))
  }

  // ── Bans ──
  const bans = await db.select().from(schema.bans).where(isNull(schema.bans.phoneHash))
  console.log(`[migrate] bans: ${bans.length} rows to encrypt`)
  for (const row of bans) {
    const phoneHash = crypto.hmac(row.phone, HMAC_PHONE_PREFIX)
    const { encrypted: encPhone, envelopes: phoneEnv } = crypto.envelopeEncrypt(
      row.phone, envelopeRecipients, LABEL_VOLUNTEER_PII
    )
    const { encrypted: encReason, envelopes: reasonEnv } = crypto.envelopeEncrypt(
      row.reason, envelopeRecipients, LABEL_VOLUNTEER_PII
    )
    await db.update(schema.bans).set({
      phoneHash, encryptedPhone: encPhone, phoneEnvelopes: phoneEnv,
      encryptedReason: encReason, reasonEnvelopes: reasonEnv,
    }).where(eq(schema.bans.id, row.id))
  }

  // ── Invite Codes ──
  const invites = await db.select().from(schema.inviteCodes).where(isNull(schema.inviteCodes.encryptedPhone))
  console.log(`[migrate] invite_codes: ${invites.length} rows to encrypt`)
  for (const row of invites) {
    const { encrypted: encName, envelopes: nameEnv } = crypto.envelopeEncrypt(
      row.name, envelopeRecipients, LABEL_VOLUNTEER_PII
    )
    const encPhone = crypto.serverEncrypt(row.phone, LABEL_VOLUNTEER_PII)
    await db.update(schema.inviteCodes).set({
      encryptedName: encName, nameEnvelopes: nameEnv,
      encryptedPhone: encPhone,
    }).where(eq(schema.inviteCodes.code, row.code))
  }

  // ── Call Records (caller_last4) ──
  const callRecs = await db.select().from(schema.callRecords).where(isNull(schema.callRecords.encryptedCallerLast4))
  console.log(`[migrate] call_records: ${callRecs.length} rows to encrypt`)
  for (const row of callRecs) {
    if (!row.callerLast4) continue
    const { encrypted, envelopes } = crypto.envelopeEncrypt(
      row.callerLast4, envelopeRecipients, LABEL_VOLUNTEER_PII
    )
    await db.update(schema.callRecords).set({
      encryptedCallerLast4: encrypted, callerLast4Envelopes: envelopes,
    }).where(eq(schema.callRecords.id, row.id))
  }

  // ── Conversations (contact_last4) ──
  const convos = await db.select().from(schema.conversations).where(isNull(schema.conversations.encryptedContactLast4))
  console.log(`[migrate] conversations: ${convos.length} rows to encrypt`)
  for (const row of convos) {
    if (!row.contactLast4) continue
    const recipients = row.assignedTo ? [...envelopeRecipients, row.assignedTo] : envelopeRecipients
    const { encrypted, envelopes } = crypto.envelopeEncrypt(
      row.contactLast4, recipients, LABEL_VOLUNTEER_PII
    )
    await db.update(schema.conversations).set({
      encryptedContactLast4: encrypted, contactLast4Envelopes: envelopes,
    }).where(eq(schema.conversations.id, row.id))
  }

  // ── Push Subscriptions ──
  const pushSubs = await db.select().from(schema.pushSubscriptions).where(isNull(schema.pushSubscriptions.encryptedEndpoint))
  console.log(`[migrate] push_subscriptions: ${pushSubs.length} rows to encrypt`)
  for (const row of pushSubs) {
    const endpointHash = crypto.hmac(row.endpoint, LABEL_PUSH_CREDENTIAL)
    const encEndpoint = crypto.serverEncrypt(row.endpoint, LABEL_PUSH_CREDENTIAL)
    const encAuthKey = crypto.serverEncrypt(row.authKey, LABEL_PUSH_CREDENTIAL)
    const encP256dh = crypto.serverEncrypt(row.p256dhKey, LABEL_PUSH_CREDENTIAL)
    const labelData = row.deviceLabel
      ? crypto.envelopeEncrypt(row.deviceLabel, [row.pubkey], LABEL_VOLUNTEER_PII)
      : { encrypted: undefined, envelopes: [] }
    await db.update(schema.pushSubscriptions).set({
      endpointHash, encryptedEndpoint: encEndpoint,
      encryptedAuthKey: encAuthKey, encryptedP256dhKey: encP256dh,
      encryptedDeviceLabel: labelData.encrypted,
      deviceLabelEnvelopes: labelData.envelopes,
    }).where(eq(schema.pushSubscriptions.id, row.id))
  }

  // ── Geocoding Config ──
  // Column was renamed in migration — backfill encrypts the value in-place
  const geoConfigs = await db.select().from(schema.geocodingConfig)
  console.log(`[migrate] geocoding_config: ${geoConfigs.length} rows to encrypt`)
  for (const row of geoConfigs) {
    if (!row.encryptedApiKey || row.encryptedApiKey === '') continue
    // Check if already encrypted (starts with hex nonce pattern — 48+ hex chars)
    if (row.encryptedApiKey.length > 100) continue // likely already encrypted
    const encrypted = crypto.serverEncrypt(row.encryptedApiKey, LABEL_PROVIDER_CREDENTIAL_WRAP)
    await db.update(schema.geocodingConfig).set({
      encryptedApiKey: encrypted,
    }).where(eq(schema.geocodingConfig.id, row.id))
  }

  // ── Provider Config SIDs ──
  const providers = await db.select().from(schema.providerConfig).where(isNull(schema.providerConfig.encryptedBrandSid))
  console.log(`[migrate] provider_config: ${providers.length} rows to encrypt`)
  for (const row of providers) {
    await db.update(schema.providerConfig).set({
      encryptedBrandSid: row.brandSid ? crypto.serverEncrypt(row.brandSid, LABEL_PROVIDER_CREDENTIAL_WRAP) : undefined,
      encryptedCampaignSid: row.campaignSid ? crypto.serverEncrypt(row.campaignSid, LABEL_PROVIDER_CREDENTIAL_WRAP) : undefined,
      encryptedMessagingServiceSid: row.messagingServiceSid ? crypto.serverEncrypt(row.messagingServiceSid, LABEL_PROVIDER_CREDENTIAL_WRAP) : undefined,
    }).where(eq(schema.providerConfig.id, row.id))
  }

  console.log('[migrate] Backfill complete.')
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Run the backfill on dev database**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun run scripts/migrate-encrypt-pii.ts`
Expected: Script completes with row counts logged. Verify with:
`docker exec llamenos-postgres-1 psql -U llamenos -d llamenos -c "SELECT pubkey, encrypted_name IS NOT NULL as has_enc_name, encrypted_phone IS NOT NULL as has_enc_phone FROM volunteers LIMIT 5;"`

- [ ] **Step 3: Verify round-trip integrity**

Run a quick verification query to ensure decryption matches the original plaintext for a sample:

```bash
docker exec llamenos-postgres-1 psql -U llamenos -d llamenos -c "SELECT name, phone FROM volunteers LIMIT 1;"
```

Then verify the service layer returns the same values by running the existing API tests.

- [ ] **Step 4: Run all tests to verify nothing broke**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-encrypt-pii.ts
git commit -m "feat(crypto): add PII backfill migration script"
```

---

## Task 11: Refactor Existing Crypto Callers to CryptoService

**Files:**
- Modify: all files currently importing from `src/server/lib/crypto.ts`
- Modify: `src/server/lib/crypto.ts` (delete after migration)

- [ ] **Step 1: Identify all callers of old crypto functions**

Run: `grep -r "import.*from.*server/lib/crypto" src/server/ --include="*.ts" -l` to find all files importing the old module. For each file, replace the import and function calls with `CryptoService` method calls.

Key replacements (as listed in the spec):
- `hashPhone(phone, secret)` → `crypto.hmac(phone, HMAC_PHONE_PREFIX)`
- `hashIP(ip, secret)` → `crypto.hmac(ip, HMAC_IP_PREFIX)` (keep truncation to 24 chars)
- `encryptMessageForStorage(text, pks)` → `crypto.envelopeEncrypt(text, pks, LABEL_MESSAGE)`
- `encryptCallRecordForStorage(meta, pks)` → `crypto.envelopeEncrypt(JSON.stringify(meta), pks, LABEL_CALL_META)`
- `encryptBinaryForStorage(data, pks, label)` → `crypto.envelopeEncryptBinary(data, pks, label)`
- `decryptBinaryFromStorage(ct, env, key, label)` → `crypto.envelopeDecryptBinary(ct, env, key, label)`
- `encryptForHub(text, hubKey)` → `crypto.hubEncrypt(text, hubKey)`
- `decryptFromHub(ct, hubKey)` → `crypto.hubDecrypt(ct, hubKey)`
- `unwrapHubKeyForServer(secret, envs)` → `crypto.unwrapHubKey(envs)`

`hashAuditEntry` stays standalone — move it to a small utility if needed.

- [ ] **Step 2: Delete old crypto.ts**

After all callers are migrated, delete `src/server/lib/crypto.ts` and `src/server/lib/crypto.test.ts`. The tests have been replaced by `crypto-service.test.ts` and `crypto-primitives.test.ts`.

- [ ] **Step 3: Run all tests**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test`
Expected: All tests PASS

- [ ] **Step 4: Run typecheck**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && npx tsc --noEmit`
Expected: No errors — no remaining imports of the deleted module

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(crypto): migrate all callers to CryptoService, delete legacy crypto.ts"
```

---

## Task 12: Drop Plaintext Columns

**Files:**
- Modify: all schema files from Task 8
- Generate: new Drizzle migration

This task runs AFTER verifying the backfill is complete and all tests pass with encrypted-only reads.

- [ ] **Step 1: Remove plaintext columns from schema**

In each schema file, remove the old plaintext columns and make the encrypted columns NOT NULL:

- `volunteers`: remove `name`, `phone`. Make `encryptedName`, `encryptedPhone` NOT NULL.
- `activeCalls`: remove `callerNumber`. Make `encryptedCallerNumber` NOT NULL.
- `callLegs`: remove `phone`. `encryptedPhone` stays nullable (browser-only volunteers have no phone).
- `callRecords`: remove `callerLast4`. `encryptedCallerLast4` stays nullable (not all records have it).
- `conversations`: remove `contactLast4`. `encryptedContactLast4` stays nullable.
- `bans`: remove `phone`, `reason`. Make `phoneHash`, `encryptedPhone`, `encryptedReason` NOT NULL.
- `inviteCodes`: remove `name`, `phone`. Make `encryptedName`, `encryptedPhone` NOT NULL.
- `providerConfig`: remove `brandSid`, `campaignSid`, `messagingServiceSid`. Encrypted versions stay nullable.
- `pushSubscriptions`: remove `endpoint`, `authKey`, `p256dhKey`, `deviceLabel`. Make `endpointHash`, `encryptedEndpoint`, `encryptedAuthKey`, `encryptedP256dhKey` NOT NULL. `encryptedDeviceLabel` stays nullable.
- `webauthnCredentials`: remove `label`. `encryptedLabel` stays nullable.

- [ ] **Step 2: Remove dual-read fallback code from all services**

Remove all `row.encryptedX ? decrypt(row.encryptedX) : row.x` fallback patterns. All reads now use encrypted columns only.

- [ ] **Step 3: Generate Drizzle migration**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && npx drizzle-kit generate`

Review the generated SQL — should show `DROP COLUMN` for all plaintext columns and `ALTER COLUMN ... SET NOT NULL` where appropriate.

- [ ] **Step 4: Apply migration**

Run the migration against the dev database. Verify with:
`docker exec llamenos-postgres-1 psql -U llamenos -d llamenos -c "\d volunteers"` — should show only encrypted columns, no plaintext `name` or `phone`.

- [ ] **Step 5: Run all tests**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(crypto): drop plaintext columns, encrypted-only reads"
```

---

## Task 13: Security Verification

**Files:** None (verification only)

- [ ] **Step 1: Verify no plaintext PII in database**

```bash
docker exec llamenos-postgres-1 psql -U llamenos -d llamenos -c "
  SELECT 'volunteers' as tbl, count(*) FROM volunteers WHERE encrypted_name IS NULL
  UNION ALL
  SELECT 'bans', count(*) FROM bans WHERE phone_hash IS NULL
  UNION ALL
  SELECT 'invite_codes', count(*) FROM invite_codes WHERE encrypted_phone IS NULL
  UNION ALL
  SELECT 'push_subscriptions', count(*) FROM push_subscriptions WHERE encrypted_endpoint IS NULL;
"
```

Expected: All counts = 0

- [ ] **Step 2: Verify E2EE fields cannot be decrypted with server secret alone**

Write a quick script that attempts to decrypt a volunteer's `encryptedName` using only the server-derived key (without the envelope). It must fail — confirming the server genuinely cannot read E2EE data.

- [ ] **Step 3: Verify branded types prevent plaintext insertion**

Create a temporary test file that attempts to insert a raw `string` into a `ciphertext()` column. Run `tsc --noEmit` — it must fail with a type error.

- [ ] **Step 4: Run full E2E test suite**

Run: `cd /home/rikki/projects/llamenos-hotline-field-encryption && bun test`
Expected: All tests PASS

- [ ] **Step 5: Commit verification results**

```bash
git commit --allow-empty -m "verify: all PII encrypted, E2EE fields verified, branded types enforced"
```
