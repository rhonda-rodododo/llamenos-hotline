# Unit Test Tier 2: E2EE Application Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pure unit tests for all E2EE application-layer crypto functions.

**Architecture:** Expand existing client crypto test file and create 3 new test files for hub-key-manager, file-crypto, and hub-key-cache.

**Tech Stack:** bun:test, @noble/curves, @noble/ciphers, @noble/hashes, nostr-tools

**Spec:** `docs/superpowers/specs/2026-03-26-unit-test-tier2-e2ee-application-layer-design.md`

---

## Task 1: Expand `crypto.test.ts` with E2EE Functions (Parts A1–A7)

**File to modify:** `src/client/lib/crypto.test.ts`

Adds ~22 tests covering encryptNoteV2/decryptNoteV2, encryptMessage/decryptMessage, decryptCallRecord, decryptTranscription, encryptDraft/decryptDraft, encryptExport, and legacy decryptNote.

- [ ] **Step 1.1:** Add the following imports to the top of `src/client/lib/crypto.test.ts`:

```ts
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  HKDF_CONTEXT_EXPORT,
  HKDF_CONTEXT_NOTES,
  HKDF_SALT,
  LABEL_MESSAGE,
  LABEL_TRANSCRIPTION,
} from '@shared/crypto-labels'
import type { NotePayload } from '@shared/types'
```

Update the existing crypto import to include all needed functions:

```ts
import {
  createAuthToken,
  decryptCallRecord,
  decryptDraft,
  decryptMessage,
  decryptNote,
  decryptNoteV2,
  decryptTranscription,
  eciesUnwrapKey,
  eciesWrapKey,
  encryptDraft,
  encryptExport,
  encryptMessage,
  encryptNoteV2,
  generateKeyPair,
  isValidNsec,
  keyPairFromNsec,
} from './crypto'
```

- [ ] **Step 1.2:** Add A1 — `encryptNoteV2 / decryptNoteV2` describe block after the existing `createAuthToken` describe block:

```ts
describe('encryptNoteV2 / decryptNoteV2', () => {
  const testPayload: NotePayload = { text: 'Crisis situation reported at location X' }

  test('author roundtrip: encrypt → decrypt via authorEnvelope = original payload', () => {
    const author = generateKeyPair()
    const admin = generateKeyPair()
    const encrypted = encryptNoteV2(testPayload, author.publicKey, [admin.publicKey])
    const decrypted = decryptNoteV2(encrypted.encryptedContent, encrypted.authorEnvelope, author.secretKey)
    expect(decrypted).toEqual(testPayload)
  })

  test('admin roundtrip: each admin decrypts via their envelope', () => {
    const author = generateKeyPair()
    const admin1 = generateKeyPair()
    const admin2 = generateKeyPair()
    const encrypted = encryptNoteV2(testPayload, author.publicKey, [admin1.publicKey, admin2.publicKey])

    const env1 = encrypted.adminEnvelopes.find((e) => e.pubkey === admin1.publicKey)!
    const env2 = encrypted.adminEnvelopes.find((e) => e.pubkey === admin2.publicKey)!
    expect(decryptNoteV2(encrypted.encryptedContent, env1, admin1.secretKey)).toEqual(testPayload)
    expect(decryptNoteV2(encrypted.encryptedContent, env2, admin2.secretKey)).toEqual(testPayload)
  })

  test('wrong key fails: decrypt with unrelated secretKey returns null', () => {
    const author = generateKeyPair()
    const attacker = generateKeyPair()
    const encrypted = encryptNoteV2(testPayload, author.publicKey, [])
    const result = decryptNoteV2(encrypted.encryptedContent, encrypted.authorEnvelope, attacker.secretKey)
    expect(result).toBeNull()
  })

  test('forward secrecy: two encryptions produce different encryptedContent', () => {
    const author = generateKeyPair()
    const e1 = encryptNoteV2(testPayload, author.publicKey, [])
    const e2 = encryptNoteV2(testPayload, author.publicKey, [])
    expect(e1.encryptedContent).not.toBe(e2.encryptedContent)
  })

  test('cross-label isolation: unwrap authorEnvelope with LABEL_MESSAGE throws', () => {
    const author = generateKeyPair()
    const encrypted = encryptNoteV2(testPayload, author.publicKey, [])
    expect(() => eciesUnwrapKey(encrypted.authorEnvelope, author.secretKey, LABEL_MESSAGE)).toThrow()
  })
})
```

- [ ] **Step 1.3:** Add A2 — `encryptMessage / decryptMessage` describe block:

```ts
describe('encryptMessage / decryptMessage', () => {
  const plaintext = 'Help needed at 5th and Main'

  test('single-reader roundtrip', () => {
    const reader = generateKeyPair()
    const encrypted = encryptMessage(plaintext, [reader.publicKey])
    const result = decryptMessage(encrypted.encryptedContent, encrypted.readerEnvelopes, reader.secretKey, reader.publicKey)
    expect(result).toBe(plaintext)
  })

  test('multi-reader: each of 3 readers decrypts independently', () => {
    const r1 = generateKeyPair()
    const r2 = generateKeyPair()
    const r3 = generateKeyPair()
    const encrypted = encryptMessage(plaintext, [r1.publicKey, r2.publicKey, r3.publicKey])

    expect(decryptMessage(encrypted.encryptedContent, encrypted.readerEnvelopes, r1.secretKey, r1.publicKey)).toBe(plaintext)
    expect(decryptMessage(encrypted.encryptedContent, encrypted.readerEnvelopes, r2.secretKey, r2.publicKey)).toBe(plaintext)
    expect(decryptMessage(encrypted.encryptedContent, encrypted.readerEnvelopes, r3.secretKey, r3.publicKey)).toBe(plaintext)
  })

  test('wrong pubkey lookup: non-matching readerPubkey returns null', () => {
    const reader = generateKeyPair()
    const outsider = generateKeyPair()
    const encrypted = encryptMessage(plaintext, [reader.publicKey])
    const result = decryptMessage(encrypted.encryptedContent, encrypted.readerEnvelopes, outsider.secretKey, outsider.publicKey)
    expect(result).toBeNull()
  })

  test('wrong secretKey: correct pubkey but wrong secretKey returns null', () => {
    const reader = generateKeyPair()
    const attacker = generateKeyPair()
    const encrypted = encryptMessage(plaintext, [reader.publicKey])
    // Use reader's pubkey but attacker's secret key
    const result = decryptMessage(encrypted.encryptedContent, encrypted.readerEnvelopes, attacker.secretKey, reader.publicKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness: same plaintext → different encryptedContent', () => {
    const reader = generateKeyPair()
    const e1 = encryptMessage(plaintext, [reader.publicKey])
    const e2 = encryptMessage(plaintext, [reader.publicKey])
    expect(e1.encryptedContent).not.toBe(e2.encryptedContent)
  })
})
```

- [ ] **Step 1.4:** Add A3 — `decryptCallRecord` describe block (cross-boundary with server crypto):

```ts
describe('decryptCallRecord', () => {
  test('roundtrip: server encryptCallRecordForStorage → client decryptCallRecord', async () => {
    const { encryptCallRecordForStorage } = await import('../../server/lib/crypto')
    const admin = generateKeyPair()
    const metadata = { answeredBy: 'volunteer-abc', callerNumber: '+15551234567' }
    const encrypted = encryptCallRecordForStorage(metadata, [admin.publicKey])
    const decrypted = decryptCallRecord(encrypted.encryptedContent, encrypted.adminEnvelopes, admin.secretKey, admin.publicKey)
    expect(decrypted).toEqual(metadata)
  })

  test('multi-admin: each admin decrypts independently', async () => {
    const { encryptCallRecordForStorage } = await import('../../server/lib/crypto')
    const admin1 = generateKeyPair()
    const admin2 = generateKeyPair()
    const metadata = { answeredBy: null, callerNumber: '+15559876543' }
    const encrypted = encryptCallRecordForStorage(metadata, [admin1.publicKey, admin2.publicKey])

    expect(decryptCallRecord(encrypted.encryptedContent, encrypted.adminEnvelopes, admin1.secretKey, admin1.publicKey)).toEqual(metadata)
    expect(decryptCallRecord(encrypted.encryptedContent, encrypted.adminEnvelopes, admin2.secretKey, admin2.publicKey)).toEqual(metadata)
  })

  test('non-admin pubkey returns null', async () => {
    const { encryptCallRecordForStorage } = await import('../../server/lib/crypto')
    const admin = generateKeyPair()
    const nonAdmin = generateKeyPair()
    const metadata = { answeredBy: 'vol-1', callerNumber: '+15550001111' }
    const encrypted = encryptCallRecordForStorage(metadata, [admin.publicKey])
    const result = decryptCallRecord(encrypted.encryptedContent, encrypted.adminEnvelopes, nonAdmin.secretKey, nonAdmin.publicKey)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 1.5:** Add A4 — `decryptTranscription` describe block. Manually constructs the encrypted payload since there is no `encryptTranscription` on the client:

```ts
describe('decryptTranscription', () => {
  test('roundtrip: manually ECDH-encrypt → decryptTranscription recovers plaintext', () => {
    const volunteer = generateKeyPair()
    const transcriptionText = 'This is the transcribed audio content'

    // Manually construct encrypted transcription (simulating server-side encryption)
    const ephemeralSecret = new Uint8Array(32)
    crypto.getRandomValues(ephemeralSecret)
    const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

    const recipientCompressed = hexToBytes(`02${volunteer.publicKey}`)
    const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
    const sharedX = shared.slice(1, 33)

    const label = utf8ToBytes(LABEL_TRANSCRIPTION)
    const keyInput = new Uint8Array(label.length + sharedX.length)
    keyInput.set(label)
    keyInput.set(sharedX, label.length)
    const symmetricKey = sha256(keyInput)

    const nonce = new Uint8Array(24)
    crypto.getRandomValues(nonce)
    const cipher = xchacha20poly1305(symmetricKey, nonce)
    const ciphertext = cipher.encrypt(utf8ToBytes(transcriptionText))

    const packed = new Uint8Array(nonce.length + ciphertext.length)
    packed.set(nonce)
    packed.set(ciphertext, nonce.length)

    const ephemeralPubkeyHex = bytesToHex(ephemeralPublicKey)
    const packedHex = bytesToHex(packed)

    const result = decryptTranscription(packedHex, ephemeralPubkeyHex, volunteer.secretKey)
    expect(result).toBe(transcriptionText)
  })

  test('wrong secretKey returns null', () => {
    const volunteer = generateKeyPair()
    const attacker = generateKeyPair()

    // Construct for volunteer
    const ephemeralSecret = new Uint8Array(32)
    crypto.getRandomValues(ephemeralSecret)
    const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

    const recipientCompressed = hexToBytes(`02${volunteer.publicKey}`)
    const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
    const sharedX = shared.slice(1, 33)

    const label = utf8ToBytes(LABEL_TRANSCRIPTION)
    const keyInput = new Uint8Array(label.length + sharedX.length)
    keyInput.set(label)
    keyInput.set(sharedX, label.length)
    const symmetricKey = sha256(keyInput)

    const nonce = new Uint8Array(24)
    crypto.getRandomValues(nonce)
    const cipher = xchacha20poly1305(symmetricKey, nonce)
    const ciphertext = cipher.encrypt(utf8ToBytes('secret text'))

    const packed = new Uint8Array(nonce.length + ciphertext.length)
    packed.set(nonce)
    packed.set(ciphertext, nonce.length)

    const result = decryptTranscription(bytesToHex(packed), bytesToHex(ephemeralPublicKey), attacker.secretKey)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 1.6:** Add A5 — `encryptDraft / decryptDraft` describe block:

```ts
describe('encryptDraft / decryptDraft', () => {
  const draftText = 'Caller described situation involving...'

  test('roundtrip: encrypt → decrypt with same secretKey', () => {
    const kp = generateKeyPair()
    const encrypted = encryptDraft(draftText, kp.secretKey)
    const decrypted = decryptDraft(encrypted, kp.secretKey)
    expect(decrypted).toBe(draftText)
  })

  test('wrong key: different secretKey returns null', () => {
    const kp = generateKeyPair()
    const other = generateKeyPair()
    const encrypted = encryptDraft(draftText, kp.secretKey)
    const result = decryptDraft(encrypted, other.secretKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness: same plaintext → different ciphertext', () => {
    const kp = generateKeyPair()
    const e1 = encryptDraft(draftText, kp.secretKey)
    const e2 = encryptDraft(draftText, kp.secretKey)
    expect(e1).not.toBe(e2)
  })
})
```

- [ ] **Step 1.7:** Add A6 — `encryptExport` describe block. Manually decrypts using the same HKDF pattern since there is no `decryptExport`:

```ts
describe('encryptExport', () => {
  const exportJson = JSON.stringify({ notes: [{ id: '1', text: 'test' }] })

  test('roundtrip: encryptExport → manually decrypt with HKDF-derived key', () => {
    const kp = generateKeyPair()
    const encrypted = encryptExport(exportJson, kp.secretKey)

    // Manually decrypt
    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, kp.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)
    const nonce = encrypted.slice(0, 24)
    const ciphertext = encrypted.slice(24)
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = new TextDecoder().decode(cipher.decrypt(ciphertext))
    expect(plaintext).toBe(exportJson)
  })

  test('returns Uint8Array', () => {
    const kp = generateKeyPair()
    const encrypted = encryptExport(exportJson, kp.secretKey)
    expect(encrypted).toBeInstanceOf(Uint8Array)
  })

  test('wrong key fails to decrypt', () => {
    const kp = generateKeyPair()
    const other = generateKeyPair()
    const encrypted = encryptExport(exportJson, kp.secretKey)

    const salt = utf8ToBytes(HKDF_SALT)
    const wrongKey = hkdf(sha256, other.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)
    const nonce = encrypted.slice(0, 24)
    const ciphertext = encrypted.slice(24)
    const cipher = xchacha20poly1305(wrongKey, nonce)
    expect(() => cipher.decrypt(ciphertext)).toThrow()
  })
})
```

- [ ] **Step 1.8:** Add A7 — `decryptNote` (legacy V1) describe block. Manually constructs the packed format:

```ts
describe('decryptNote (legacy V1)', () => {
  test('roundtrip: manually encrypt with HKDF-derived key → decryptNote recovers payload', () => {
    const kp = generateKeyPair()
    const payload: NotePayload = { text: 'Legacy V1 note content' }

    // Manually encrypt using V1 pattern
    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, kp.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_NOTES), 32)
    const nonce = new Uint8Array(24)
    crypto.getRandomValues(nonce)
    const cipher = xchacha20poly1305(key, nonce)
    const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(payload)))

    const packed = new Uint8Array(nonce.length + ciphertext.length)
    packed.set(nonce)
    packed.set(ciphertext, nonce.length)
    const packedHex = bytesToHex(packed)

    const decrypted = decryptNote(packedHex, kp.secretKey)
    expect(decrypted).toEqual(payload)
  })

  test('wrong key returns null', () => {
    const kp = generateKeyPair()
    const other = generateKeyPair()

    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, kp.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_NOTES), 32)
    const nonce = new Uint8Array(24)
    crypto.getRandomValues(nonce)
    const cipher = xchacha20poly1305(key, nonce)
    const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify({ text: 'secret' })))

    const packed = new Uint8Array(nonce.length + ciphertext.length)
    packed.set(nonce)
    packed.set(ciphertext, nonce.length)

    const result = decryptNote(bytesToHex(packed), other.secretKey)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 1.9:** Run tests and verify:

```bash
bun test src/client/lib/crypto.test.ts
```

**Expected:** All existing tier 1 tests + ~22 new tier 2 tests pass.

**Commit message:** `test: add tier 2 E2EE application-layer tests to crypto.test.ts`

---

## Task 2: Create `hub-key-manager.test.ts` (Part B)

**File to create:** `src/client/lib/hub-key-manager.test.ts`

Adds ~15 tests covering generateHubKey, wrapHubKeyForMember/unwrapHubKey, wrapHubKeyForMembers, encryptForHub/decryptFromHub, rotateHubKey, and client-server interop.

- [ ] **Step 2.1:** Create `src/client/lib/hub-key-manager.test.ts` with the full test file:

```ts
import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import { generateKeyPair } from './crypto'
import {
  decryptFromHub,
  encryptForHub,
  generateHubKey,
  rotateHubKey,
  unwrapHubKey,
  wrapHubKeyForMember,
  wrapHubKeyForMembers,
} from './hub-key-manager'

describe('generateHubKey', () => {
  test('returns 32-byte Uint8Array', () => {
    const key = generateHubKey()
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
  })

  test('two calls produce different keys', () => {
    const k1 = generateHubKey()
    const k2 = generateHubKey()
    expect(bytesToHex(k1)).not.toBe(bytesToHex(k2))
  })
})

describe('wrapHubKeyForMember / unwrapHubKey', () => {
  test('roundtrip: wrap → unwrap with member secretKey = original hub key', () => {
    const hubKey = generateHubKey()
    const member = generateKeyPair()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)
    const unwrapped = unwrapHubKey(envelope, member.secretKey)
    expect(bytesToHex(unwrapped)).toBe(bytesToHex(hubKey))
  })

  test('wrong key throws on unwrap', () => {
    const hubKey = generateHubKey()
    const member = generateKeyPair()
    const attacker = generateKeyPair()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)
    expect(() => unwrapHubKey(envelope, attacker.secretKey)).toThrow()
  })

  test('envelope has pubkey, wrappedKey, ephemeralPubkey fields', () => {
    const hubKey = generateHubKey()
    const member = generateKeyPair()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)
    expect(typeof envelope.pubkey).toBe('string')
    expect(typeof envelope.wrappedKey).toBe('string')
    expect(typeof envelope.ephemeralPubkey).toBe('string')
    expect(envelope.pubkey).toBe(member.publicKey)
  })
})

describe('wrapHubKeyForMembers', () => {
  test('multi-member: wrap for 3 → each unwraps to same hub key', () => {
    const hubKey = generateHubKey()
    const m1 = generateKeyPair()
    const m2 = generateKeyPair()
    const m3 = generateKeyPair()
    const envelopes = wrapHubKeyForMembers(hubKey, [m1.publicKey, m2.publicKey, m3.publicKey])

    expect(envelopes.length).toBe(3)
    const u1 = unwrapHubKey(envelopes[0], m1.secretKey)
    const u2 = unwrapHubKey(envelopes[1], m2.secretKey)
    const u3 = unwrapHubKey(envelopes[2], m3.secretKey)
    const hex = bytesToHex(hubKey)
    expect(bytesToHex(u1)).toBe(hex)
    expect(bytesToHex(u2)).toBe(hex)
    expect(bytesToHex(u3)).toBe(hex)
  })

  test('envelope count matches member count', () => {
    const hubKey = generateHubKey()
    const members = [generateKeyPair(), generateKeyPair()]
    const envelopes = wrapHubKeyForMembers(hubKey, members.map((m) => m.publicKey))
    expect(envelopes.length).toBe(2)
  })
})

describe('encryptForHub / decryptFromHub', () => {
  test('roundtrip: encrypt → decrypt with same hub key', () => {
    const hubKey = generateHubKey()
    const plaintext = 'Hub-scoped data: shift schedule'
    const encrypted = encryptForHub(plaintext, hubKey)
    const decrypted = decryptFromHub(encrypted, hubKey)
    expect(decrypted).toBe(plaintext)
  })

  test('wrong key returns null', () => {
    const hubKey = generateHubKey()
    const wrongKey = generateHubKey()
    const encrypted = encryptForHub('secret', hubKey)
    const result = decryptFromHub(encrypted, wrongKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness: same input → different ciphertext', () => {
    const hubKey = generateHubKey()
    const plaintext = 'same text'
    const e1 = encryptForHub(plaintext, hubKey)
    const e2 = encryptForHub(plaintext, hubKey)
    expect(e1).not.toBe(e2)
  })
})

describe('rotateHubKey', () => {
  test('new key differs from original', () => {
    const original = generateHubKey()
    const { hubKey: rotated } = rotateHubKey([generateKeyPair().publicKey])
    expect(bytesToHex(rotated)).not.toBe(bytesToHex(original))
  })

  test('members can unwrap rotated key', () => {
    const m1 = generateKeyPair()
    const m2 = generateKeyPair()
    const { hubKey, envelopes } = rotateHubKey([m1.publicKey, m2.publicKey])

    const u1 = unwrapHubKey(envelopes[0], m1.secretKey)
    const u2 = unwrapHubKey(envelopes[1], m2.secretKey)
    expect(bytesToHex(u1)).toBe(bytesToHex(hubKey))
    expect(bytesToHex(u2)).toBe(bytesToHex(hubKey))
  })

  test('old key cannot decrypt data encrypted with new key', () => {
    const oldKey = generateHubKey()
    const { hubKey: newKey } = rotateHubKey([generateKeyPair().publicKey])
    const encrypted = encryptForHub('new data', newKey)
    const result = decryptFromHub(encrypted, oldKey)
    expect(result).toBeNull()
  })
})

describe('client↔server hub key interop', () => {
  test('client wrapHubKeyForMember → server eciesUnwrapKeyServer recovers key', async () => {
    const { eciesUnwrapKeyServer } = await import('../../server/lib/crypto')
    const hubKey = generateHubKey()
    const member = generateKeyPair()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)
    const recovered = eciesUnwrapKeyServer(envelope, member.secretKey, LABEL_HUB_KEY_WRAP)
    expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
  })

  test('client encryptForHub → server decryptFromHub', async () => {
    const serverCrypto = await import('../../server/lib/crypto')
    const hubKey = generateHubKey()
    const plaintext = 'client-originated hub data'
    const encrypted = encryptForHub(plaintext, hubKey)
    const decrypted = serverCrypto.decryptFromHub(encrypted, hubKey)
    expect(decrypted).toBe(plaintext)
  })

  test('server encryptForHub → client decryptFromHub', async () => {
    const serverCrypto = await import('../../server/lib/crypto')
    const hubKey = generateHubKey()
    const plaintext = 'server-originated hub data'
    const encrypted = serverCrypto.encryptForHub(plaintext, hubKey)
    const decrypted = decryptFromHub(encrypted, hubKey)
    expect(decrypted).toBe(plaintext)
  })
})
```

- [ ] **Step 2.2:** Run tests and verify:

```bash
bun test src/client/lib/hub-key-manager.test.ts
```

**Expected:** ~15 tests pass.

**Commit message:** `test: add hub-key-manager unit tests (tier 2 E2EE)`

---

## Task 3: Create `file-crypto.test.ts` (Part C)

**File to create:** `src/client/lib/file-crypto.test.ts`

Adds ~10 tests covering encryptFile/decryptFile, decryptFileMetadata (via encryptFile output), unwrapFileKey, and rewrapFileKey.

- [ ] **Step 3.1:** Create `src/client/lib/file-crypto.test.ts` with the full test file:

```ts
import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_FILE_KEY } from '@shared/crypto-labels'
import { eciesWrapKey, generateKeyPair } from './crypto'
import {
  decryptFile,
  decryptFileMetadata,
  encryptFile,
  rewrapFileKey,
  unwrapFileKey,
} from './file-crypto'

function makeTestFile(content: string, name = 'test.txt', type = 'text/plain'): File {
  const bytes = new TextEncoder().encode(content)
  return new File([bytes], name, { type })
}

describe('encryptFile / decryptFile', () => {
  test('roundtrip: encrypt → decrypt recovers original bytes', async () => {
    const content = 'Hello, encrypted file!'
    const file = makeTestFile(content)
    const recipient = generateKeyPair()

    const encrypted = await encryptFile(file, [recipient.publicKey])
    const envelope = encrypted.recipientEnvelopes.find((e) => e.pubkey === recipient.publicKey)!

    const { blob } = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      envelope,
      recipient.secretKey
    )
    const decryptedText = await blob.text()
    expect(decryptedText).toBe(content)
  })

  test('checksum matches SHA-256 of original content', async () => {
    const content = 'Checksum verification test data'
    const file = makeTestFile(content)
    const recipient = generateKeyPair()

    // Compute expected checksum
    const originalBytes = new TextEncoder().encode(content)
    const expectedHash = await crypto.subtle.digest('SHA-256', originalBytes)
    const expectedChecksum = bytesToHex(new Uint8Array(expectedHash))

    const encrypted = await encryptFile(file, [recipient.publicKey])
    const envelope = encrypted.recipientEnvelopes.find((e) => e.pubkey === recipient.publicKey)!

    const { checksum } = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      envelope,
      recipient.secretKey
    )
    expect(checksum).toBe(expectedChecksum)
  })

  test('multi-recipient: 2 recipients each decrypt same content', async () => {
    const content = 'Shared file content'
    const file = makeTestFile(content)
    const r1 = generateKeyPair()
    const r2 = generateKeyPair()

    const encrypted = await encryptFile(file, [r1.publicKey, r2.publicKey])

    const env1 = encrypted.recipientEnvelopes.find((e) => e.pubkey === r1.publicKey)!
    const env2 = encrypted.recipientEnvelopes.find((e) => e.pubkey === r2.publicKey)!

    const { blob: blob1 } = await decryptFile(encrypted.encryptedContent.buffer as ArrayBuffer, env1, r1.secretKey)
    const { blob: blob2 } = await decryptFile(encrypted.encryptedContent.buffer as ArrayBuffer, env2, r2.secretKey)

    expect(await blob1.text()).toBe(content)
    expect(await blob2.text()).toBe(content)
  })

  test('wrong key throws on decryptFile', async () => {
    const content = 'Secret file'
    const file = makeTestFile(content)
    const recipient = generateKeyPair()
    const attacker = generateKeyPair()

    const encrypted = await encryptFile(file, [recipient.publicKey])
    const envelope = encrypted.recipientEnvelopes.find((e) => e.pubkey === recipient.publicKey)!

    await expect(
      decryptFile(encrypted.encryptedContent.buffer as ArrayBuffer, envelope, attacker.secretKey)
    ).rejects.toThrow()
  })
})

describe('decryptFileMetadata (via encryptFile output)', () => {
  test('roundtrip: encryptFile → extract metadata → decryptFileMetadata', async () => {
    const content = 'Metadata test content'
    const file = makeTestFile(content, 'report.pdf', 'application/pdf')
    const recipient = generateKeyPair()

    const encrypted = await encryptFile(file, [recipient.publicKey])
    const metaEntry = encrypted.encryptedMetadata.find((m) => m.pubkey === recipient.publicKey)!

    const metadata = decryptFileMetadata(
      metaEntry.encryptedContent,
      metaEntry.ephemeralPubkey,
      recipient.secretKey
    )

    expect(metadata).not.toBeNull()
    expect(metadata!.originalName).toBe('report.pdf')
    expect(metadata!.mimeType).toBe('application/pdf')
    expect(metadata!.size).toBe(new TextEncoder().encode(content).length)
    expect(typeof metadata!.checksum).toBe('string')
    expect(metadata!.checksum.length).toBe(64) // SHA-256 hex
  })

  test('wrong key returns null', async () => {
    const file = makeTestFile('data')
    const recipient = generateKeyPair()
    const attacker = generateKeyPair()

    const encrypted = await encryptFile(file, [recipient.publicKey])
    const metaEntry = encrypted.encryptedMetadata.find((m) => m.pubkey === recipient.publicKey)!

    const result = decryptFileMetadata(
      metaEntry.encryptedContent,
      metaEntry.ephemeralPubkey,
      attacker.secretKey
    )
    expect(result).toBeNull()
  })
})

describe('unwrapFileKey', () => {
  test('roundtrip via eciesWrapKey with LABEL_FILE_KEY', () => {
    const fileKey = new Uint8Array(32)
    crypto.getRandomValues(fileKey)
    const recipient = generateKeyPair()

    const { wrappedKey, ephemeralPubkey } = eciesWrapKey(fileKey, recipient.publicKey, LABEL_FILE_KEY)
    const unwrapped = unwrapFileKey(wrappedKey, ephemeralPubkey, recipient.secretKey)
    expect(bytesToHex(unwrapped)).toBe(bytesToHex(fileKey))
  })

  test('wrong key throws', () => {
    const fileKey = new Uint8Array(32)
    crypto.getRandomValues(fileKey)
    const recipient = generateKeyPair()
    const attacker = generateKeyPair()

    const { wrappedKey, ephemeralPubkey } = eciesWrapKey(fileKey, recipient.publicKey, LABEL_FILE_KEY)
    expect(() => unwrapFileKey(wrappedKey, ephemeralPubkey, attacker.secretKey)).toThrow()
  })
})

describe('rewrapFileKey', () => {
  test('admin re-wraps file key for new recipient → new recipient unwraps', async () => {
    const content = 'File for rewrap test'
    const file = makeTestFile(content)
    const admin = generateKeyPair()

    // Encrypt file for admin only
    const encrypted = await encryptFile(file, [admin.publicKey])
    const adminEnvelope = encrypted.recipientEnvelopes.find((e) => e.pubkey === admin.publicKey)!

    // Admin re-wraps for volunteer
    const volunteer = generateKeyPair()
    const rewrapped = rewrapFileKey(
      adminEnvelope.encryptedFileKey,
      adminEnvelope.ephemeralPubkey,
      admin.secretKey,
      volunteer.publicKey
    )

    // Volunteer decrypts with rewrapped envelope
    const { blob } = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      rewrapped,
      volunteer.secretKey
    )
    expect(await blob.text()).toBe(content)
  })
})
```

- [ ] **Step 3.2:** Run tests and verify:

```bash
bun test src/client/lib/file-crypto.test.ts
```

**Expected:** ~10 tests pass.

**Commit message:** `test: add file-crypto unit tests (tier 2 E2EE)`

---

## Task 4: Create `hub-key-cache.test.ts` (Part D)

**File to create:** `src/client/lib/hub-key-cache.test.ts`

Adds ~6 tests covering getHubKeyForId, clearHubKeyCache, loadHubKeysForUser, and generation counter stale prevention. Uses `mock.module` from bun:test to mock the `getMyHubKeyEnvelope` API function.

- [ ] **Step 4.1:** Create `src/client/lib/hub-key-cache.test.ts` with the full test file:

```ts
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { generateKeyPair } from './crypto'
import { generateHubKey, wrapHubKeyForMember } from './hub-key-manager'

// Mock the API module before importing the cache module.
// getMyHubKeyEnvelope is called by loadHubKeysForUser internally.
const mockGetMyHubKeyEnvelope = mock(() => Promise.resolve(null as any))

mock.module('./api', () => ({
  getMyHubKeyEnvelope: mockGetMyHubKeyEnvelope,
}))

// Import AFTER mocking so the mock is picked up
const { clearHubKeyCache, getHubKeyForId, loadHubKeysForUser } = await import('./hub-key-cache')

afterEach(() => {
  clearHubKeyCache()
  mockGetMyHubKeyEnvelope.mockReset()
})

describe('getHubKeyForId / clearHubKeyCache', () => {
  test('returns null when cache is empty', () => {
    expect(getHubKeyForId('unknown-hub-id')).toBeNull()
  })

  test('clearHubKeyCache empties cache: load → clear → returns null', async () => {
    const member = generateKeyPair()
    const hubKey = generateHubKey()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)

    mockGetMyHubKeyEnvelope.mockImplementation(() =>
      Promise.resolve({
        wrappedKey: envelope.wrappedKey,
        ephemeralPubkey: envelope.ephemeralPubkey,
      })
    )

    await loadHubKeysForUser(['hub-1'], member.secretKey)
    expect(getHubKeyForId('hub-1')).not.toBeNull()

    clearHubKeyCache()
    expect(getHubKeyForId('hub-1')).toBeNull()
  })
})

describe('loadHubKeysForUser', () => {
  test('loads and caches keys from API envelope', async () => {
    const member = generateKeyPair()
    const hubKey = generateHubKey()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)

    mockGetMyHubKeyEnvelope.mockImplementation(() =>
      Promise.resolve({
        wrappedKey: envelope.wrappedKey,
        ephemeralPubkey: envelope.ephemeralPubkey,
      })
    )

    await loadHubKeysForUser(['hub-a'], member.secretKey)
    const cached = getHubKeyForId('hub-a')
    expect(cached).not.toBeNull()
    expect(bytesToHex(cached!)).toBe(bytesToHex(hubKey))
  })

  test('loads multiple hubs: both are cached', async () => {
    const member = generateKeyPair()
    const hubKey1 = generateHubKey()
    const hubKey2 = generateHubKey()
    const env1 = wrapHubKeyForMember(hubKey1, member.publicKey)
    const env2 = wrapHubKeyForMember(hubKey2, member.publicKey)

    mockGetMyHubKeyEnvelope.mockImplementation((hubId: string) => {
      if (hubId === 'hub-1') return Promise.resolve({ wrappedKey: env1.wrappedKey, ephemeralPubkey: env1.ephemeralPubkey })
      if (hubId === 'hub-2') return Promise.resolve({ wrappedKey: env2.wrappedKey, ephemeralPubkey: env2.ephemeralPubkey })
      return Promise.resolve(null)
    })

    await loadHubKeysForUser(['hub-1', 'hub-2'], member.secretKey)
    expect(bytesToHex(getHubKeyForId('hub-1')!)).toBe(bytesToHex(hubKey1))
    expect(bytesToHex(getHubKeyForId('hub-2')!)).toBe(bytesToHex(hubKey2))
  })

  test('handles API failure gracefully: one hub fails, other still cached', async () => {
    const member = generateKeyPair()
    const hubKey = generateHubKey()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)

    mockGetMyHubKeyEnvelope.mockImplementation((hubId: string) => {
      if (hubId === 'hub-ok') return Promise.resolve({ wrappedKey: envelope.wrappedKey, ephemeralPubkey: envelope.ephemeralPubkey })
      if (hubId === 'hub-fail') return Promise.reject(new Error('Network error'))
      return Promise.resolve(null)
    })

    await loadHubKeysForUser(['hub-ok', 'hub-fail'], member.secretKey)
    expect(getHubKeyForId('hub-ok')).not.toBeNull()
    expect(getHubKeyForId('hub-fail')).toBeNull()
  })
})

describe('generation counter (stale prevention)', () => {
  test('clearHubKeyCache during load invalidates stale results', async () => {
    const member = generateKeyPair()
    const hubKey = generateHubKey()
    const envelope = wrapHubKeyForMember(hubKey, member.publicKey)

    // Make the mock return a promise that we can control
    let resolveApiCall: ((value: any) => void) | null = null
    mockGetMyHubKeyEnvelope.mockImplementation(
      () => new Promise((resolve) => { resolveApiCall = resolve })
    )

    // Start loading — this will block waiting for the API response
    const loadPromise = loadHubKeysForUser(['hub-stale'], member.secretKey)

    // Wait for the mock to be called
    while (!resolveApiCall) {
      await new Promise((r) => setTimeout(r, 1))
    }

    // Clear the cache mid-flight — bumps the generation counter
    clearHubKeyCache()

    // Now resolve the API call — the result should be discarded (stale generation)
    resolveApiCall!({
      wrappedKey: envelope.wrappedKey,
      ephemeralPubkey: envelope.ephemeralPubkey,
    })

    await loadPromise

    // The key should NOT be cached because the generation was invalidated
    expect(getHubKeyForId('hub-stale')).toBeNull()
  })
})
```

- [ ] **Step 4.2:** Run tests and verify:

```bash
bun test src/client/lib/hub-key-cache.test.ts
```

**Expected:** ~6 tests pass.

**Commit message:** `test: add hub-key-cache unit tests with mock API (tier 2 E2EE)`

---

## Task 5: Run Full Suite and Verify

- [ ] **Step 5.1:** Run all four test files together:

```bash
bun test src/client/lib/crypto.test.ts src/client/lib/hub-key-manager.test.ts src/client/lib/file-crypto.test.ts src/client/lib/hub-key-cache.test.ts
```

**Expected:** ~53 new tests + existing tier 1 tests all pass.

- [ ] **Step 5.2:** Run typecheck:

```bash
bun run typecheck
```

- [ ] **Step 5.3:** Run build:

```bash
bun run build
```

- [ ] **Step 5.4:** Run full unit test suite to confirm no regressions:

```bash
bun run test:unit
```

**Expected:** All unit tests pass, no regressions.

**Commit message:** `test: tier 2 E2EE application-layer unit tests complete (~53 tests)`
