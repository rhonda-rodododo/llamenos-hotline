# Unit Test Tier 1: Core Primitives + Integration Test Separation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate integration tests from unit tests and add pure unit test coverage for all core cryptographic primitives.

**Architecture:** Rename 5 DB-dependent test files to `*.integration.test.ts` so `test:unit` runs without PostgreSQL. Add ~64 new pure unit tests across 4 new test files and 1 expanded test file, covering ECIES, Schnorr, PBKDF2, HMAC, HKDF, and audit hash chains.

**Tech Stack:** bun:test, @noble/curves, @noble/ciphers, @noble/hashes, nostr-tools

**Spec:** `docs/superpowers/specs/2026-03-26-unit-test-tier1-core-primitives-design.md`

---

### Task 1: Separate Integration Tests from Unit Tests

**Files:**
- Rename: `src/server/services/identity.test.ts` → `src/server/services/identity.integration.test.ts`
- Rename: `src/server/services/settings-hub-keys.test.ts` → `src/server/services/settings-hub-keys.integration.test.ts`
- Rename: `src/server/services/records.test.ts` → `src/server/services/records.integration.test.ts`
- Rename: `src/server/services/settings-rate-limiter.test.ts` → `src/server/services/settings-rate-limiter.integration.test.ts`
- Rename: `src/server/services/push.test.ts` → `src/server/services/push.integration.test.ts`
- Modify: `package.json` (test scripts)

- [ ] **Step 1: Rename the 5 DB-dependent test files**

```bash
cd /home/rikki/projects/llamenos-hotline
git mv src/server/services/identity.test.ts src/server/services/identity.integration.test.ts
git mv src/server/services/settings-hub-keys.test.ts src/server/services/settings-hub-keys.integration.test.ts
git mv src/server/services/records.test.ts src/server/services/records.integration.test.ts
git mv src/server/services/settings-rate-limiter.test.ts src/server/services/settings-rate-limiter.integration.test.ts
git mv src/server/services/push.test.ts src/server/services/push.integration.test.ts
```

- [ ] **Step 2: Update package.json test scripts**

In `package.json`, update these scripts:

```jsonc
"test:unit": "bun test src/ --bail --path-ignore-patterns='**/*.integration.test.ts'",
"test:integration": "bun test src/**/*.integration.test.ts",
"test:all": "bun test src/ --bail --path-ignore-patterns='**/*.integration.test.ts' && bun test src/**/*.integration.test.ts && bunx playwright test",
```

Note: Bun uses `--path-ignore-patterns` (not `--ignore`).

- [ ] **Step 3: Verify test:unit runs without Docker**

```bash
bun run test:unit
```

Expected: All pure unit tests pass. No DB connection errors. Integration tests are excluded.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: separate integration tests from unit tests via *.integration.test.ts naming"
```

---

### Task 2: Expand Server `crypto.test.ts` — HMAC, Hub, Audit Hash

**Files:**
- Modify: `src/server/lib/crypto.test.ts`

- [ ] **Step 1: Write hashPhone tests**

Add to `src/server/lib/crypto.test.ts`:

```typescript
describe('hashPhone', () => {
  const SECRET = 'ab'.repeat(32)

  test('deterministic — same input produces same hash', () => {
    const a = hashPhone('+15551234567', SECRET)
    const b = hashPhone('+15551234567', SECRET)
    expect(a).toBe(b)
  })

  test('different phones produce different hashes', () => {
    const a = hashPhone('+15551234567', SECRET)
    const b = hashPhone('+15559999999', SECRET)
    expect(a).not.toBe(b)
  })

  test('different secrets produce different hashes', () => {
    const secret2 = 'cd'.repeat(32)
    const a = hashPhone('+15551234567', SECRET)
    const b = hashPhone('+15551234567', secret2)
    expect(a).not.toBe(b)
  })

  test('output is valid hex', () => {
    const hash = hashPhone('+15551234567', SECRET)
    expect(hash).toMatch(/^[0-9a-f]+$/)
    expect(hash).toHaveLength(64) // SHA-256 = 32 bytes = 64 hex chars
  })
})
```

Add the `hashPhone` import to the existing import block at the top of the file.

- [ ] **Step 2: Write hashIP tests**

```typescript
describe('hashIP', () => {
  const SECRET = 'ab'.repeat(32)

  test('deterministic — same input produces same hash', () => {
    const a = hashIP('192.168.1.1', SECRET)
    const b = hashIP('192.168.1.1', SECRET)
    expect(a).toBe(b)
  })

  test('truncated to 96 bits (24 hex chars)', () => {
    const hash = hashIP('10.0.0.1', SECRET)
    expect(hash).toHaveLength(24)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  test('different IPs produce different hashes', () => {
    const a = hashIP('192.168.1.1', SECRET)
    const b = hashIP('10.0.0.1', SECRET)
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 3: Write encryptMessageForStorage tests**

```typescript
describe('encryptMessageForStorage', () => {
  test('single-recipient roundtrip', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const plaintext = 'Hello from SMS webhook'
    const result = encryptMessageForStorage(plaintext, [pubkey])

    expect(result.encryptedContent).toBeDefined()
    expect(result.readerEnvelopes).toHaveLength(1)
    expect(result.readerEnvelopes[0].pubkey).toBe(pubkey)

    // Unwrap the message key and manually decrypt
    const messageKey = eciesUnwrapKeyServer(
      result.readerEnvelopes[0],
      privkey,
      LABEL_MESSAGE
    )
    const packed = hexToBytes(result.encryptedContent)
    const nonce = packed.slice(0, 24)
    const ciphertext = packed.slice(24)
    const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js')
    const decrypted = new TextDecoder().decode(
      xchacha20poly1305(messageKey, nonce).decrypt(ciphertext)
    )
    expect(decrypted).toBe(plaintext)
  })

  test('multi-recipient — each reader can decrypt', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const priv1 = schnorr.utils.randomSecretKey()
    const pub1 = Buffer.from(schnorr.getPublicKey(priv1)).toString('hex')
    const priv2 = schnorr.utils.randomSecretKey()
    const pub2 = Buffer.from(schnorr.getPublicKey(priv2)).toString('hex')

    const result = encryptMessageForStorage('shared secret', [pub1, pub2])
    expect(result.readerEnvelopes).toHaveLength(2)

    // Both can unwrap the message key
    const key1 = eciesUnwrapKeyServer(result.readerEnvelopes[0], priv1, LABEL_MESSAGE)
    const key2 = eciesUnwrapKeyServer(result.readerEnvelopes[1], priv2, LABEL_MESSAGE)
    expect(Buffer.from(key1)).toEqual(Buffer.from(key2))
  })

  test('nonce uniqueness — same plaintext produces different ciphertext', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const a = encryptMessageForStorage('same message', [pubkey])
    const b = encryptMessageForStorage('same message', [pubkey])
    expect(a.encryptedContent).not.toBe(b.encryptedContent)
  })
})
```

- [ ] **Step 4: Write encryptCallRecordForStorage tests**

```typescript
describe('encryptCallRecordForStorage', () => {
  test('roundtrip with admin pubkeys', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const adminPriv = schnorr.utils.randomSecretKey()
    const adminPub = Buffer.from(schnorr.getPublicKey(adminPriv)).toString('hex')

    const metadata = { answeredBy: 'vol-pubkey-hex', callerNumber: '+15551234567' }
    const result = encryptCallRecordForStorage(metadata, [adminPub])

    expect(result.adminEnvelopes).toHaveLength(1)

    // Unwrap key and decrypt
    const recordKey = eciesUnwrapKeyServer(
      result.adminEnvelopes[0],
      adminPriv,
      LABEL_CALL_META
    )
    const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js')
    const { hexToBytes } = await import('@noble/hashes/utils.js')
    const packed = hexToBytes(result.encryptedContent)
    const decrypted = JSON.parse(
      new TextDecoder().decode(
        xchacha20poly1305(recordKey, packed.slice(0, 24)).decrypt(packed.slice(24))
      )
    )
    expect(decrypted).toEqual(metadata)
  })

  test('cross-label unwrap fails — LABEL_MESSAGE cannot unwrap LABEL_CALL_META', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const adminPriv = schnorr.utils.randomSecretKey()
    const adminPub = Buffer.from(schnorr.getPublicKey(adminPriv)).toString('hex')

    const result = encryptCallRecordForStorage({ test: true }, [adminPub])
    expect(() =>
      eciesUnwrapKeyServer(result.adminEnvelopes[0], adminPriv, LABEL_MESSAGE)
    ).toThrow()
  })
})
```

- [ ] **Step 5: Write encryptForHub / decryptFromHub tests**

```typescript
describe('encryptForHub / decryptFromHub', () => {
  test('roundtrip with known hub key', () => {
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)

    const plaintext = 'hub-scoped data'
    const encrypted = encryptForHub(plaintext, hubKey)
    const decrypted = decryptFromHub(encrypted, hubKey)
    expect(decrypted).toBe(plaintext)
  })

  test('wrong key returns null', () => {
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)
    const wrongKey = new Uint8Array(32)
    crypto.getRandomValues(wrongKey)

    const encrypted = encryptForHub('secret', hubKey)
    const result = decryptFromHub(encrypted, wrongKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness — same input produces different ciphertext', () => {
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)

    const a = encryptForHub('same data', hubKey)
    const b = encryptForHub('same data', hubKey)
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 6: Write eciesUnwrapKeyServer domain separation test**

```typescript
describe('eciesUnwrapKeyServer', () => {
  test('domain separation — wrap with LABEL_MESSAGE, unwrap with LABEL_CALL_META throws', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const result = encryptMessageForStorage('test', [pubkey])
    expect(() =>
      eciesUnwrapKeyServer(result.readerEnvelopes[0], privkey, LABEL_CALL_META)
    ).toThrow()
  })

  test('wrong private key throws', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')
    const wrongPrivkey = schnorr.utils.randomSecretKey()

    const result = encryptMessageForStorage('test', [pubkey])
    expect(() =>
      eciesUnwrapKeyServer(result.readerEnvelopes[0], wrongPrivkey, LABEL_MESSAGE)
    ).toThrow()
  })
})
```

- [ ] **Step 7: Write unwrapHubKeyForServer tests**

```typescript
describe('unwrapHubKeyForServer', () => {
  test('full roundtrip — derive server pubkey, wrap hub key, unwrap succeeds', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const { secp256k1 } = await import('@noble/curves/secp256k1.js')
    const { hkdf } = await import('@noble/hashes/hkdf.js')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { hexToBytes, bytesToHex } = await import('@noble/hashes/utils.js')
    const { utf8ToBytes } = await import('@noble/ciphers/utils.js')
    const { LABEL_SERVER_NOSTR_KEY, LABEL_SERVER_NOSTR_KEY_INFO, LABEL_HUB_KEY_WRAP } = await import('@shared/crypto-labels')

    // Generate a fake SERVER_NOSTR_SECRET (64 hex chars)
    const serverSecret = bytesToHex(schnorr.utils.randomSecretKey())

    // Derive the server's pubkey the same way unwrapHubKeyForServer does
    const secretBytes = hexToBytes(serverSecret)
    const serverPrivateKey = hkdf(sha256, secretBytes, utf8ToBytes(LABEL_SERVER_NOSTR_KEY), utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO), 32)
    const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

    // Generate a hub key and wrap it for the server pubkey using client-side eciesWrapKey
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)
    const { eciesWrapKey } = await import('@/lib/crypto')
    const envelope = eciesWrapKey(hubKey, serverPubkey, LABEL_HUB_KEY_WRAP)

    // Create the envelopes array with the server's pubkey
    const envelopes = [{ pubkey: serverPubkey, ...envelope }]

    // Unwrap should recover the hub key
    const recovered = unwrapHubKeyForServer(serverSecret, envelopes)
    expect(Buffer.from(recovered)).toEqual(Buffer.from(hubKey))
  })

  test('wrong server secret throws — no matching envelope', () => {
    const wrongSecret = 'ff'.repeat(32)
    const envelopes = [{ pubkey: 'ab'.repeat(32), wrappedKey: 'cd'.repeat(48), ephemeralPubkey: '02' + 'ef'.repeat(32) }]
    expect(() => unwrapHubKeyForServer(wrongSecret, envelopes)).toThrow()
  })
})
```

- [ ] **Step 8: Write hashAuditEntry tests**

```typescript
describe('hashAuditEntry', () => {
  const baseEntry = {
    id: 'entry-001',
    event: 'call.answered',
    actorPubkey: 'ab'.repeat(32),
    details: { callSid: 'CA123' },
    createdAt: '2026-03-26T12:00:00.000Z',
  }

  test('deterministic — same entry produces same hash', () => {
    const a = hashAuditEntry(baseEntry)
    const b = hashAuditEntry(baseEntry)
    expect(a).toBe(b)
  })

  test('output is valid SHA-256 hex (64 chars)', () => {
    const hash = hashAuditEntry(baseEntry)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('changing any field changes the hash', () => {
    const original = hashAuditEntry(baseEntry)
    expect(hashAuditEntry({ ...baseEntry, id: 'entry-002' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, event: 'call.missed' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, actorPubkey: 'cd'.repeat(32) })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, details: { callSid: 'CA456' } })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, createdAt: '2026-03-27T00:00:00.000Z' })).not.toBe(original)
  })

  test('chain linkage — entry with previousEntryHash differs from entry without', () => {
    const withoutPrev = hashAuditEntry(baseEntry)
    const withPrev = hashAuditEntry({ ...baseEntry, previousEntryHash: 'ff'.repeat(32) })
    expect(withPrev).not.toBe(withoutPrev)
  })
})
```

- [ ] **Step 9: Update imports and run tests**

Add all new imports to the top of `src/server/lib/crypto.test.ts`:

```typescript
import {
  decryptBinaryFromStorage,
  decryptFromHub,
  decryptProviderCredentials,
  eciesUnwrapKeyServer,
  encryptBinaryForStorage,
  encryptCallRecordForStorage,
  encryptForHub,
  encryptMessageForStorage,
  encryptProviderCredentials,
  hashAuditEntry,
  hashIP,
  hashPhone,
  unwrapHubKeyForServer,
} from './crypto'
import { LABEL_CALL_META, LABEL_MESSAGE, LABEL_VOICEMAIL_WRAP } from '@shared/crypto-labels'
```

Run:
```bash
bun test src/server/lib/crypto.test.ts
```

Expected: All tests pass (existing + new).

- [ ] **Step 10: Commit**

```bash
git add src/server/lib/crypto.test.ts
git commit -m "test: add unit tests for hashPhone, hashIP, ECIES unwrap, message/call/hub encryption, audit hash chain"
```

---

### Task 3: Create Server `auth.test.ts` — Schnorr Verification

**Files:**
- Create: `src/server/lib/auth.test.ts`

- [ ] **Step 1: Write parseAuthHeader tests**

Create `src/server/lib/auth.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { parseAuthHeader, parseSessionHeader, validateToken, verifyAuthToken } from './auth'

describe('parseAuthHeader', () => {
  test('parses valid Bearer JSON', () => {
    const payload = { pubkey: 'ab'.repeat(32), timestamp: Date.now(), token: 'cd'.repeat(32) }
    const header = `Bearer ${JSON.stringify(payload)}`
    const result = parseAuthHeader(header)
    expect(result).toEqual(payload)
  })

  test('returns null for missing header', () => {
    expect(parseAuthHeader(null)).toBeNull()
  })

  test('returns null for non-Bearer prefix', () => {
    expect(parseAuthHeader('Basic dXNlcjpwYXNz')).toBeNull()
  })

  test('returns null for malformed JSON', () => {
    expect(parseAuthHeader('Bearer {not-json}')).toBeNull()
  })
})
```

- [ ] **Step 2: Write parseSessionHeader tests**

```typescript
describe('parseSessionHeader', () => {
  test('extracts token from valid Session header', () => {
    expect(parseSessionHeader('Session abc123token')).toBe('abc123token')
  })

  test('returns null for missing header', () => {
    expect(parseSessionHeader(null)).toBeNull()
  })

  test('returns null for non-Session prefix', () => {
    expect(parseSessionHeader('Bearer abc123')).toBeNull()
  })
})
```

- [ ] **Step 3: Write validateToken tests**

```typescript
describe('validateToken', () => {
  test('accepts token with current timestamp', () => {
    const auth = { pubkey: 'ab'.repeat(32), timestamp: Date.now(), token: 'cd'.repeat(32) }
    expect(validateToken(auth)).toBe(true)
  })

  test('accepts token 4 minutes old (within 5-min window)', () => {
    const auth = { pubkey: 'ab'.repeat(32), timestamp: Date.now() - 4 * 60 * 1000, token: 'cd'.repeat(32) }
    expect(validateToken(auth)).toBe(true)
  })

  test('rejects token 6 minutes old (expired)', () => {
    const auth = { pubkey: 'ab'.repeat(32), timestamp: Date.now() - 6 * 60 * 1000, token: 'cd'.repeat(32) }
    expect(validateToken(auth)).toBe(false)
  })

  test('rejects token 6 minutes in the future', () => {
    const auth = { pubkey: 'ab'.repeat(32), timestamp: Date.now() + 6 * 60 * 1000, token: 'cd'.repeat(32) }
    expect(validateToken(auth)).toBe(false)
  })

  test('rejects when pubkey is empty', () => {
    const auth = { pubkey: '', timestamp: Date.now(), token: 'cd'.repeat(32) }
    expect(validateToken(auth)).toBe(false)
  })
})
```

- [ ] **Step 4: Write verifyAuthToken cross-validation tests**

This is the critical test — proves client-generated tokens are accepted by the server verifier.

```typescript
describe('verifyAuthToken — client↔server cross-validation', () => {
  test('valid token roundtrip — client createAuthToken → server verifyAuthToken', async () => {
    const { createAuthToken, generateKeyPair } = await import('@/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const method = 'GET'
    const path = '/api/notes'

    const tokenJson = createAuthToken(kp.secretKey, timestamp, method, path)
    const auth = JSON.parse(tokenJson)

    const result = await verifyAuthToken(auth, method, path)
    expect(result).toBe(true)
  })

  test('wrong pubkey fails verification', async () => {
    const { createAuthToken, generateKeyPair } = await import('@/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()

    const tokenJson = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/notes')
    const auth = JSON.parse(tokenJson)

    // Replace pubkey with a different one
    const other = generateKeyPair()
    auth.pubkey = other.publicKey

    const result = await verifyAuthToken(auth, 'GET', '/api/notes')
    expect(result).toBe(false)
  })

  test('tampered signature fails', async () => {
    const { createAuthToken, generateKeyPair } = await import('@/lib/crypto')
    const kp = generateKeyPair()

    const tokenJson = createAuthToken(kp.secretKey, Date.now(), 'GET', '/api/notes')
    const auth = JSON.parse(tokenJson)

    // Flip a byte in the signature
    const tampered = auth.token.slice(0, -2) + (auth.token.slice(-2) === '00' ? 'ff' : '00')
    auth.token = tampered

    const result = await verifyAuthToken(auth, 'GET', '/api/notes')
    expect(result).toBe(false)
  })

  test('wrong method fails — cross-endpoint replay protection', async () => {
    const { createAuthToken, generateKeyPair } = await import('@/lib/crypto')
    const kp = generateKeyPair()

    const tokenJson = createAuthToken(kp.secretKey, Date.now(), 'GET', '/api/notes')
    const auth = JSON.parse(tokenJson)

    const result = await verifyAuthToken(auth, 'POST', '/api/notes')
    expect(result).toBe(false)
  })

  test('wrong path fails — cross-endpoint replay protection', async () => {
    const { createAuthToken, generateKeyPair } = await import('@/lib/crypto')
    const kp = generateKeyPair()

    const tokenJson = createAuthToken(kp.secretKey, Date.now(), 'GET', '/api/notes')
    const auth = JSON.parse(tokenJson)

    const result = await verifyAuthToken(auth, 'GET', '/api/admin/volunteers')
    expect(result).toBe(false)
  })

  test('missing method/path returns false', async () => {
    const { createAuthToken, generateKeyPair } = await import('@/lib/crypto')
    const kp = generateKeyPair()

    const tokenJson = createAuthToken(kp.secretKey, Date.now(), 'GET', '/api/notes')
    const auth = JSON.parse(tokenJson)

    const result = await verifyAuthToken(auth)
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
bun test src/server/lib/auth.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/auth.test.ts
git commit -m "test: add unit tests for auth token parsing, validation, and Schnorr cross-verification"
```

---

### Task 4: Create Server `hub-event-crypto.test.ts`

**Files:**
- Create: `src/server/lib/hub-event-crypto.test.ts`

- [ ] **Step 1: Write all hub-event-crypto tests**

Create `src/server/lib/hub-event-crypto.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { deriveServerEventKey, decryptHubEvent, encryptHubEvent } from './hub-event-crypto'

describe('deriveServerEventKey', () => {
  test('deterministic — same secret produces same key', () => {
    const secret = 'ab'.repeat(32)
    const a = deriveServerEventKey(secret)
    const b = deriveServerEventKey(secret)
    expect(bytesToHex(a)).toBe(bytesToHex(b))
  })

  test('different secrets produce different keys', () => {
    const a = deriveServerEventKey('ab'.repeat(32))
    const b = deriveServerEventKey('cd'.repeat(32))
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })

  test('returns exactly 32 bytes', () => {
    const key = deriveServerEventKey('ab'.repeat(32))
    expect(key).toHaveLength(32)
  })
})

describe('encryptHubEvent / decryptHubEvent', () => {
  const eventKey = deriveServerEventKey('ab'.repeat(32))

  test('roundtrip — encrypt then decrypt recovers original', () => {
    const content = { type: 'call.started', hubId: 'hub-123', data: { callSid: 'CA456' } }
    const encrypted = encryptHubEvent(content, eventKey)
    const decrypted = decryptHubEvent(encrypted, eventKey)
    expect(decrypted).toEqual(content)
  })

  test('wrong key returns null', () => {
    const wrongKey = deriveServerEventKey('cd'.repeat(32))
    const encrypted = encryptHubEvent({ test: true }, eventKey)
    const result = decryptHubEvent(encrypted, wrongKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness — same input produces different ciphertext', () => {
    const content = { same: 'data' }
    const a = encryptHubEvent(content, eventKey)
    const b = encryptHubEvent(content, eventKey)
    expect(a).not.toBe(b)
  })

  test('handles complex payloads — nested objects, arrays, unicode', () => {
    const content = {
      type: 'notification',
      data: {
        nested: { deep: true },
        list: [1, 'two', null],
        unicode: '¡Hola! 你好 🔐',
      },
    }
    const encrypted = encryptHubEvent(content, eventKey)
    const decrypted = decryptHubEvent(encrypted, eventKey)
    expect(decrypted).toEqual(content)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
bun test src/server/lib/hub-event-crypto.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/lib/hub-event-crypto.test.ts
git commit -m "test: add unit tests for hub event crypto — HKDF derivation and XChaCha20 roundtrips"
```

---

### Task 5: Create Client `crypto.test.ts` — Core Primitives

**Files:**
- Create: `src/client/lib/crypto.test.ts`

- [ ] **Step 1: Write generateKeyPair tests**

Create `src/client/lib/crypto.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  eciesUnwrapKey,
  eciesWrapKey,
  generateKeyPair,
  isValidNsec,
  keyPairFromNsec,
  createAuthToken,
} from './crypto'

describe('generateKeyPair', () => {
  test('secretKey is 32 bytes', () => {
    const kp = generateKeyPair()
    expect(kp.secretKey).toHaveLength(32)
    expect(kp.secretKey).toBeInstanceOf(Uint8Array)
  })

  test('publicKey is 64 hex chars (x-only)', () => {
    const kp = generateKeyPair()
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
  })

  test('nsec starts with nsec1, npub starts with npub1', () => {
    const kp = generateKeyPair()
    expect(kp.nsec.startsWith('nsec1')).toBe(true)
    expect(kp.npub.startsWith('npub1')).toBe(true)
  })

  test('each call produces different keys', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    expect(a.publicKey).not.toBe(b.publicKey)
    expect(bytesToHex(a.secretKey)).not.toBe(bytesToHex(b.secretKey))
  })
})
```

- [ ] **Step 2: Write keyPairFromNsec / isValidNsec tests**

```typescript
describe('keyPairFromNsec / isValidNsec', () => {
  test('roundtrip — generateKeyPair nsec → keyPairFromNsec recovers same pubkey', () => {
    const original = generateKeyPair()
    const restored = keyPairFromNsec(original.nsec)
    expect(restored).not.toBeNull()
    expect(restored!.publicKey).toBe(original.publicKey)
    expect(bytesToHex(restored!.secretKey)).toBe(bytesToHex(original.secretKey))
  })

  test('invalid nsec returns null', () => {
    expect(keyPairFromNsec('not-a-valid-nsec')).toBeNull()
    expect(keyPairFromNsec('')).toBeNull()
    expect(keyPairFromNsec('npub1abc')).toBeNull() // npub, not nsec
  })

  test('isValidNsec returns true for valid, false for garbage', () => {
    const kp = generateKeyPair()
    expect(isValidNsec(kp.nsec)).toBe(true)
    expect(isValidNsec('not-valid')).toBe(false)
    expect(isValidNsec('')).toBe(false)
    expect(isValidNsec(kp.npub)).toBe(false) // npub, not nsec
  })
})
```

- [ ] **Step 3: Write eciesWrapKey / eciesUnwrapKey tests**

```typescript
describe('eciesWrapKey / eciesUnwrapKey', () => {
  const TEST_LABEL = 'llamenos:test-label'

  test('roundtrip — wrap 32-byte key then unwrap recovers original', () => {
    const kp = generateKeyPair()
    const originalKey = new Uint8Array(32)
    crypto.getRandomValues(originalKey)

    const envelope = eciesWrapKey(originalKey, kp.publicKey, TEST_LABEL)
    const recovered = eciesUnwrapKey(envelope, kp.secretKey, TEST_LABEL)
    expect(Buffer.from(recovered)).toEqual(Buffer.from(originalKey))
  })

  test('wrong private key throws', () => {
    const kp = generateKeyPair()
    const wrongKp = generateKeyPair()
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)

    const envelope = eciesWrapKey(key, kp.publicKey, TEST_LABEL)
    expect(() => eciesUnwrapKey(envelope, wrongKp.secretKey, TEST_LABEL)).toThrow()
  })

  test('nonce uniqueness — two wraps produce different wrappedKey', () => {
    const kp = generateKeyPair()
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)

    const a = eciesWrapKey(key, kp.publicKey, TEST_LABEL)
    const b = eciesWrapKey(key, kp.publicKey, TEST_LABEL)
    expect(a.wrappedKey).not.toBe(b.wrappedKey)
  })

  test('domain separation — wrap with label A, unwrap with label B throws', () => {
    const kp = generateKeyPair()
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)

    const envelope = eciesWrapKey(key, kp.publicKey, 'llamenos:label-a')
    expect(() => eciesUnwrapKey(envelope, kp.secretKey, 'llamenos:label-b')).toThrow()
  })

  test('ephemeral pubkey is 66 hex chars (33 bytes compressed)', () => {
    const kp = generateKeyPair()
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)

    const envelope = eciesWrapKey(key, kp.publicKey, TEST_LABEL)
    expect(envelope.ephemeralPubkey).toMatch(/^[0-9a-f]{66}$/)
  })
})
```

- [ ] **Step 4: Write createAuthToken tests**

```typescript
describe('createAuthToken', () => {
  test('returns valid JSON with pubkey, timestamp, token fields', () => {
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const result = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/notes')
    const parsed = JSON.parse(result)

    expect(parsed.pubkey).toBe(kp.publicKey)
    expect(parsed.timestamp).toBe(timestamp)
    expect(parsed.token).toMatch(/^[0-9a-f]+$/)
  })

  test('signature is verifiable by server verifyAuthToken', async () => {
    const { verifyAuthToken } = await import('@server/lib/auth')
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const method = 'POST'
    const path = '/api/notes'

    const tokenJson = createAuthToken(kp.secretKey, timestamp, method, path)
    const auth = JSON.parse(tokenJson)
    const result = await verifyAuthToken(auth, method, path)
    expect(result).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
bun test src/client/lib/crypto.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/crypto.test.ts
git commit -m "test: add unit tests for client crypto primitives — keygen, ECIES, Schnorr auth tokens"
```

---

### Task 6: Create Client `key-store.test.ts` — PBKDF2 PIN Encryption

**Files:**
- Create: `src/client/lib/key-store.test.ts`

- [ ] **Step 1: Write localStorage mock and isValidPin tests**

Create `src/client/lib/key-store.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearStoredKey,
  decryptStoredKey,
  getStoredKeyId,
  hasStoredKey,
  isValidPin,
  reEncryptKey,
  storeEncryptedKey,
} from './key-store'

// Mock localStorage for Bun (no browser)
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
} as Storage

beforeEach(() => store.clear())

describe('isValidPin', () => {
  test('accepts 6 digits', () => expect(isValidPin('123456')).toBe(true))
  test('accepts 7 digits', () => expect(isValidPin('1234567')).toBe(true))
  test('accepts 8 digits', () => expect(isValidPin('12345678')).toBe(true))
  test('rejects 5 digits', () => expect(isValidPin('12345')).toBe(false))
  test('rejects 9 digits', () => expect(isValidPin('123456789')).toBe(false))
  test('rejects letters', () => expect(isValidPin('abcdef')).toBe(false))
  test('rejects empty string', () => expect(isValidPin('')).toBe(false))
  test('rejects mixed', () => expect(isValidPin('123abc')).toBe(false))
})
```

- [ ] **Step 2: Write storeEncryptedKey / decryptStoredKey tests**

```typescript
describe('storeEncryptedKey / decryptStoredKey', () => {
  const TEST_NSEC = 'nsec1' + 'a'.repeat(58) // placeholder — generate a real one in tests
  const TEST_PIN = '123456'
  const TEST_PUBKEY = 'ab'.repeat(32)

  test('correct PIN roundtrip — store then decrypt recovers nsec', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, TEST_PIN, kp.publicKey)
    const recovered = await decryptStoredKey(TEST_PIN)
    expect(recovered).toBe(kp.nsec)
  })

  test('wrong PIN returns null', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, '123456', kp.publicKey)
    const result = await decryptStoredKey('999999')
    expect(result).toBeNull()
  })

  test('stored format has expected fields and PBKDF2 iterations = 600000', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, TEST_PIN, kp.publicKey)
    const raw = localStorage.getItem('llamenos-encrypted-key')
    expect(raw).not.toBeNull()

    const data = JSON.parse(raw!)
    expect(data.salt).toMatch(/^[0-9a-f]{32}$/) // 16 bytes = 32 hex chars
    expect(data.nonce).toMatch(/^[0-9a-f]{48}$/) // 24 bytes = 48 hex chars
    expect(data.ciphertext).toMatch(/^[0-9a-f]+$/)
    expect(data.iterations).toBe(600_000)
    expect(data.pubkey).toMatch(/^[0-9a-f]{16}$/) // truncated hash, 16 hex chars
  })

  test('decryptStoredKey returns null when no key stored', async () => {
    const result = await decryptStoredKey('123456')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Write reEncryptKey tests**

```typescript
describe('reEncryptKey', () => {
  test('PIN change — old PIN fails, new PIN works', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()
    const oldPin = '123456'
    const newPin = '654321'

    await storeEncryptedKey(kp.nsec, oldPin, kp.publicKey)
    await reEncryptKey(kp.nsec, newPin, kp.publicKey)

    const withOld = await decryptStoredKey(oldPin)
    expect(withOld).toBeNull()

    const withNew = await decryptStoredKey(newPin)
    expect(withNew).toBe(kp.nsec)
  })
})
```

- [ ] **Step 4: Write lifecycle tests (hasStoredKey, getStoredKeyId, clearStoredKey)**

```typescript
describe('hasStoredKey / getStoredKeyId / clearStoredKey', () => {
  test('full lifecycle — store → has → getId → clear → gone', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    expect(hasStoredKey()).toBe(false)
    expect(getStoredKeyId()).toBeNull()

    await storeEncryptedKey(kp.nsec, '123456', kp.publicKey)
    expect(hasStoredKey()).toBe(true)
    expect(getStoredKeyId()).not.toBeNull()
    expect(getStoredKeyId()).toMatch(/^[0-9a-f]{16}$/)

    clearStoredKey()
    expect(hasStoredKey()).toBe(false)
    expect(getStoredKeyId()).toBeNull()
  })
})
```

- [ ] **Step 5: Run tests**

```bash
bun test src/client/lib/key-store.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/key-store.test.ts
git commit -m "test: add unit tests for key-store PBKDF2 PIN encryption — roundtrip, iteration count, lifecycle"
```

---

### Task 7: Run Full Unit Suite and Verify

- [ ] **Step 1: Run full unit test suite**

```bash
bun run test:unit
```

Expected: All unit tests pass. No integration tests are included. No DB connection errors.

- [ ] **Step 2: Verify integration tests still work (if Docker is running)**

```bash
bun run test:integration
```

Expected: All integration tests pass (same tests as before, just renamed).

- [ ] **Step 3: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

Expected: Both pass.

- [ ] **Step 4: Final commit if any cleanup needed**

If any adjustments were needed, commit them:

```bash
git add -A
git commit -m "test: finalize tier 1 unit test expansion — all crypto primitives covered"
```
