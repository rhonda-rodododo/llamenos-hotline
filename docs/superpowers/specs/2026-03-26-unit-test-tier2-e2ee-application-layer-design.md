# Unit Test Tier 2: E2EE Application Layer

**Date:** 2026-03-26
**Status:** Draft
**Tier:** 2 of 3 (Core Primitives → **E2EE Application Layer** → Lifecycle & UX Security)
**Depends on:** Tier 1 (core primitives tested and passing)

## Overview

Tier 1 proved the crypto primitives work (ECIES, Schnorr, PBKDF2, HMAC, HKDF). This spec covers the application-layer functions that compose those primitives into E2EE workflows: note encryption with forward secrecy, message encryption, file encryption with checksums, call record encryption, hub key distribution, and draft/export encryption.

## Goals

- Every E2EE encrypt→decrypt path has a roundtrip unit test
- Multi-recipient scenarios are tested (volunteer + N admins)
- Domain separation between note/message/file/call labels is enforced
- Hub key distribution lifecycle (generate → wrap → unwrap → encrypt → decrypt → rotate) is tested end-to-end
- File checksum verification is tested
- Legacy V1 note decryption is tested for backward compatibility
- Hub key cache lifecycle (load → get → clear → stale prevention) is tested with mocked API

## Non-Goals

- Standalone server-side encryption tests (covered in tier 1)
- Testing key manager lifecycle, backup, provisioning (tier 3)
- Integration testing against real APIs

---

## Part A: Client `crypto.ts` — E2EE Functions

**File:** `src/client/lib/crypto.test.ts` (expand existing tier 1 tests)

### A1: `encryptNoteV2 / decryptNoteV2` — Per-Note Forward Secrecy

| Test | Assert |
|------|--------|
| Author roundtrip | Encrypt note → decrypt with author's secretKey via authorEnvelope = original NotePayload |
| Admin roundtrip | Encrypt with 2 admin pubkeys → each admin decrypts via their envelope = original |
| Wrong key fails | Decrypt with unrelated secretKey returns null |
| Forward secrecy | Two encryptions of same payload produce different encryptedContent (random per-note key) |
| Cross-label isolation | Unwrap authorEnvelope with LABEL_MESSAGE instead of LABEL_NOTE_KEY throws |

### A2: `encryptMessage / decryptMessage` — E2EE Messaging

| Test | Assert |
|------|--------|
| Single-reader roundtrip | Encrypt → decryptMessage with matching pubkey = original |
| Multi-reader | Encrypt for 3 readers → each decrypts independently |
| Wrong pubkey lookup | decryptMessage with non-matching readerPubkey returns null (no envelope found) |
| Wrong secretKey | Correct pubkey but wrong secretKey returns null |
| Nonce uniqueness | Same plaintext → different encryptedContent |

### A3: `decryptCallRecord` — Call Metadata Decryption

| Test | Assert |
|------|--------|
| Roundtrip | Use server's `encryptCallRecordForStorage` to encrypt → client's `decryptCallRecord` to decrypt = original metadata |
| Multi-admin | Encrypt for 2 admins → each decrypts |
| Non-admin pubkey | decryptCallRecord with non-admin pubkey returns null |

Note: This is a cross-boundary test — server encrypts, client decrypts. Proves interop.

### A4: `decryptTranscription` — Server-Encrypted Transcription

| Test | Assert |
|------|--------|
| Roundtrip | Manually ECDH-encrypt a transcription string with ephemeral key → decryptTranscription recovers it |
| Wrong secretKey | Returns null |

Implementation note: Since there's no `encryptTranscription` on the client, the test must manually construct the encrypted payload using the same ECDH + SHA-256(LABEL_TRANSCRIPTION || sharedX) + XChaCha20 pattern.

### A5: `encryptDraft / decryptDraft` — Local Draft Encryption

| Test | Assert |
|------|--------|
| Roundtrip | Encrypt draft → decrypt with same secretKey = original |
| Wrong key | Different secretKey returns null |
| Nonce uniqueness | Same plaintext → different ciphertext |

### A6: `encryptExport` — Export Blob Encryption

| Test | Assert |
|------|--------|
| Roundtrip | encryptExport → manually decrypt with same HKDF-derived key = original |
| Returns Uint8Array | Output is Uint8Array, not hex string |
| Wrong key | Different secretKey fails to decrypt |

Note: There's no `decryptExport` function — the test manually decrypts using the same HKDF derivation pattern.

### A7: `decryptNote` — Legacy V1 Backward Compatibility

| Test | Assert |
|------|--------|
| Roundtrip | Manually encrypt with HKDF_CONTEXT_NOTES derived key → decryptNote recovers payload |
| Wrong key | Returns null |

Note: No `encryptNote` V1 function exists anymore — test manually constructs the packed format.

---

## Part B: Client `hub-key-manager.ts` — Hub Key Distribution

**File:** `src/client/lib/hub-key-manager.test.ts` (new)

### B1: `generateHubKey`

| Test | Assert |
|------|--------|
| Returns 32 bytes | Length is 32, instance of Uint8Array |
| Random | Two calls produce different keys |

### B2: `wrapHubKeyForMember / unwrapHubKey`

| Test | Assert |
|------|--------|
| Roundtrip | Generate hub key → wrap for member → unwrap with member's secretKey = original |
| Wrong key fails | Unwrap with different secretKey throws |
| Envelope structure | Has pubkey, wrappedKey, ephemeralPubkey fields |

### B3: `wrapHubKeyForMembers`

| Test | Assert |
|------|--------|
| Multi-member | Wrap for 3 members → each unwraps independently → all get same hub key |
| Envelope count | Returns array with length = number of members |

### B4: `encryptForHub / decryptFromHub`

| Test | Assert |
|------|--------|
| Roundtrip | Encrypt → decrypt with same hub key = original |
| Wrong key | Returns null |
| Nonce uniqueness | Same input → different ciphertext |

### B5: `rotateHubKey`

| Test | Assert |
|------|--------|
| New key differs | rotateHubKey returns hubKey different from original |
| Members can unwrap | Each member unwraps their envelope → gets new hub key |
| Old key incompatible | Data encrypted with old hub key cannot be decrypted with new hub key |

### B6: Client↔Server Hub Key Interop

| Test | Assert |
|------|--------|
| Client wrap → server unwrap | Client `wrapHubKeyForMember` → server `eciesUnwrapKeyServer` with LABEL_HUB_KEY_WRAP recovers key |
| Client encrypt → server decrypt | Client `encryptForHub` → server `decryptFromHub` = original |
| Server encrypt → client decrypt | Server `encryptForHub` → client `decryptFromHub` = original |

---

## Part C: Client `file-crypto.ts` — File E2EE

**File:** `src/client/lib/file-crypto.test.ts` (new)

### C1: `encryptFile / decryptFile`

| Test | Assert |
|------|--------|
| Roundtrip | Create File from bytes → encryptFile → decryptFile = original bytes |
| Checksum matches | decryptFile returns checksum matching SHA-256 of original |
| Multi-recipient | Encrypt for 2 recipients → each decrypts same content |
| Wrong key fails | decryptFile with wrong secretKey throws |

Implementation note: Use `new File([bytes], 'test.txt', { type: 'text/plain' })` to create test files.

### C2: `decryptFileMetadata` (via `encryptFile` output)

`encryptMetadataForPubkey` is not exported — test `decryptFileMetadata` indirectly by extracting encrypted metadata from `encryptFile` results.

| Test | Assert |
|------|--------|
| Roundtrip via encryptFile | encryptFile → extract encryptedMetadata entry → decryptFileMetadata = original metadata |
| Fields preserved | originalName, mimeType, size, checksum all match |
| Wrong key | Returns null |

### C3: `unwrapFileKey`

| Test | Assert |
|------|--------|
| Roundtrip via eciesWrapKey | Wrap a key with LABEL_FILE_KEY → unwrapFileKey recovers it |
| Wrong key throws | Different secretKey throws |

### C4: `rewrapFileKey`

| Test | Assert |
|------|--------|
| Admin re-wrap | Admin wraps file key → admin rewraps for new recipient → new recipient decrypts file |
| Chain: encrypt → rewrap → decrypt | Full workflow: encryptFile for admin → rewrapFileKey for volunteer → volunteer decrypts |

---

## Part D: Client `hub-key-cache.ts` — Cache Lifecycle

**File:** `src/client/lib/hub-key-cache.test.ts` (new)

**Mocking strategy:** Mock the `getMyHubKeyEnvelope` API function. The cache module imports it from the API layer — use `mock.module` or manual module mock.

### D1: `getHubKeyForId / clearHubKeyCache`

| Test | Assert |
|------|--------|
| Returns null when empty | getHubKeyForId('unknown') returns null |
| clearHubKeyCache empties cache | Load → clear → getHubKeyForId returns null |

### D2: `loadHubKeysForUser`

| Test | Assert |
|------|--------|
| Loads and caches keys | Mock API to return valid envelope → loadHubKeysForUser → getHubKeyForId returns unwrapped key |
| Multiple hubs | Load 2 hub IDs → both cached |
| Handles API failure gracefully | Mock API to throw for one hub → other hub still cached |

### D3: Generation Counter (Stale Prevention)

| Test | Assert |
|------|--------|
| Clear during load invalidates | Start load → clearHubKeyCache during fetch → loaded keys NOT cached (generation mismatch) |

---

## Test Patterns

Same patterns as tier 1:
- Pure functions only — no DB, no network (except mocked API for hub-key-cache)
- Real crypto — use actual @noble libraries
- `bun:test` — describe, test, expect
- Cross-boundary imports where needed (server crypto from client tests) via relative paths

## Test Count Estimate

| Section | Tests |
|---------|-------|
| A: Client crypto E2EE functions | ~22 |
| B: Hub key manager | ~15 |
| C: File crypto | ~10 |
| D: Hub key cache | ~6 |
| **Total new unit tests** | **~53** |

## Dependencies

- Tier 1 tests passing (primitives verified)
- No new npm packages
- No infrastructure requirements
