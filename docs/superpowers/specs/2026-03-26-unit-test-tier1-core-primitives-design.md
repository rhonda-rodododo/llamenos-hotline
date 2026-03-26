# Unit Test Tier 1: Core Primitives + Integration Test Separation

**Date:** 2026-03-26
**Status:** Draft
**Tier:** 1 of 3 (Core Primitives → E2EE Application Layer → Lifecycle & UX Security)

## Overview

Unit tests for security-critical cryptographic primitives are almost entirely absent. Integration and E2E tests exercise some of these paths indirectly, but the core crypto functions — ECIES key wrapping, Schnorr auth, PBKDF2 key derivation, HMAC hashing, HKDF derivation, and audit hash chains — have no isolated unit coverage.

This spec covers two concerns:

1. **Separate integration tests from unit tests** — 6 test files currently require PostgreSQL but live alongside pure unit tests. Rename to `*.integration.test.ts` and update scripts so `test:unit` runs fast without backing services.
2. **Add pure unit tests for tier 1 crypto primitives** — the foundational functions that all higher-level E2EE operations depend on.

## Goals

- `bun run test:unit` runs in seconds with zero infrastructure dependencies
- Every crypto primitive has roundtrip, wrong-key rejection, nonce uniqueness, and domain separation tests
- Client↔server auth token compatibility is proven by cross-validation tests
- PBKDF2 iteration counts are asserted (not just "decryption works")

## Non-Goals

- Testing higher-level E2EE functions (notes, messages, files) — that's spec 2
- Testing key manager lifecycle, backup/recovery, provisioning — that's spec 3
- Replacing integration tests — they stay as `*.integration.test.ts`
- Known-answer test vectors for every function (only where determinism matters: HMAC, HKDF, audit hash)

---

## Part A: Integration Test Separation

### File Renames

| Current | New |
|---------|-----|
| `src/server/services/identity.test.ts` | `src/server/services/identity.integration.test.ts` |
| `src/server/services/settings-hub-keys.test.ts` | `src/server/services/settings-hub-keys.integration.test.ts` |
| `src/server/services/records.test.ts` | `src/server/services/records.integration.test.ts` |
| `src/server/services/settings-rate-limiter.test.ts` | `src/server/services/settings-rate-limiter.integration.test.ts` |
| `src/server/services/push.test.ts` | `src/server/services/push.integration.test.ts` |

### Script Updates (`package.json`)

```jsonc
{
  "test:unit": "bun test src/ --bail --ignore='**/*.integration.test.ts'",
  "test:integration": "bun test src/**/*.integration.test.ts",
  "test:api": "bunx playwright test --project=api",
  "test:e2e": "bunx playwright test --project=ui",
  "test:all": "bun test src/ --bail --ignore='**/*.integration.test.ts' && bun test src/**/*.integration.test.ts && bunx playwright test"
}
```

### Validation

- `bun run test:unit` passes without `bun run dev:docker`
- `bun run test:integration` passes with `bun run dev:docker` running
- `bun run test:all` runs the full chain

---

## Part B: Server `crypto.ts` — Expand Existing Tests

**File:** `src/server/lib/crypto.test.ts` (existing, add new describe blocks)

### B1: `hashPhone(phone, secret)` — HMAC-SHA256

| Test | Assert |
|------|--------|
| Deterministic | Same phone + same secret = same hash |
| Different phones | Different inputs = different hashes |
| Different secrets | Same phone + different secret = different hash |
| Valid hex output | Output matches `/^[0-9a-f]+$/` |

### B2: `hashIP(ip, secret)` — HMAC-SHA256 truncated

| Test | Assert |
|------|--------|
| Deterministic | Same IP + same secret = same hash |
| Truncated to 96 bits | Output is exactly 24 hex chars |
| Different IPs | Different inputs = different hashes |

### B3: `eciesWrapKeyServer / eciesUnwrapKeyServer` — ECIES primitives

| Test | Assert |
|------|--------|
| Roundtrip | Wrap key → unwrap with correct privkey = original key |
| Wrong key rejects | Unwrap with different privkey throws |
| Nonce uniqueness | Two wraps of same key produce different `wrappedKey` |
| Domain separation | Wrap with label A, unwrap with label B throws |
| Ephemeral pubkey format | 66 hex chars (33 bytes compressed) |

### B4: `encryptMessageForStorage` — Envelope encryption

| Test | Assert |
|------|--------|
| Single-recipient roundtrip | Encrypt → unwrap envelope → decrypt = original |
| Multi-recipient | Each of N readers can decrypt independently |
| Nonce uniqueness | Same plaintext produces different ciphertext |
| Envelope structure | Each envelope has `pubkey`, `wrappedKey`, `ephemeralPubkey` |

### B5: `encryptCallRecordForStorage` — Call metadata encryption

| Test | Assert |
|------|--------|
| Roundtrip with admin pubkeys | Encrypt metadata → admin unwraps → decrypt = original |
| Uses LABEL_CALL_META | Cross-label unwrap fails (wrap as call, unwrap as message) |

### B6: `encryptForHub / decryptFromHub` — Symmetric hub encryption

| Test | Assert |
|------|--------|
| Roundtrip | Encrypt → decrypt with same hub key = original |
| Wrong key fails | Different 32-byte key returns null or throws |
| Nonce uniqueness | Same input produces different ciphertext |

### B7: `unwrapHubKeyForServer` — HKDF + ECIES

| Test | Assert |
|------|--------|
| Full roundtrip | Derive server pubkey from secret → wrap hub key for that pubkey → `unwrapHubKeyForServer` recovers hub key |
| Wrong secret fails | Different `SERVER_NOSTR_SECRET` throws (wrong pubkey, no matching envelope) |

### B8: `hashAuditEntry` — SHA-256 chain

| Test | Assert |
|------|--------|
| Deterministic | Same entry fields = same hash |
| Field sensitivity | Changing any single field changes the hash |
| Chain linkage | Entry with `previousEntryHash` ≠ entry without |
| Output format | 64 hex chars (SHA-256) |

---

## Part C: Server `auth.ts` — New Test File

**File:** `src/server/lib/auth.test.ts` (new)

### C1: `parseAuthHeader`

| Test | Assert |
|------|--------|
| Valid Bearer JSON | Parses to AuthPayload with pubkey, timestamp, token |
| Missing header | Returns null |
| Non-Bearer prefix | Returns null |
| Malformed JSON | Returns null |

### C2: `parseSessionHeader`

| Test | Assert |
|------|--------|
| Valid Session header | Extracts token string |
| Missing header | Returns null |
| Non-Session prefix | Returns null |

### C3: `validateToken`

| Test | Assert |
|------|--------|
| Current timestamp | Returns true |
| 4 minutes ago | Returns true (within window) |
| 6 minutes ago | Returns false (expired) |
| 6 minutes in future | Returns false (too far ahead) |

### C4: `verifyAuthToken` — Client↔Server Cross-Validation

This is the most critical test — it proves that tokens created by the client's `createAuthToken` are accepted by the server's `verifyAuthToken`.

| Test | Assert |
|------|--------|
| Valid token roundtrip | Client `createAuthToken` → server `verifyAuthToken` = true |
| Wrong pubkey | Verify with different pubkey = false |
| Tampered signature | Flip a byte in token = false |
| Wrong method | Created for GET, verified for POST = false |
| Wrong path | Created for /api/a, verified for /api/b = false |

**Import note:** This test imports `createAuthToken` from `src/client/lib/crypto.ts` and `verifyAuthToken` from `src/server/lib/auth.ts`, proving cross-boundary compatibility.

---

## Part D: Server `hub-event-crypto.ts` — New Test File

**File:** `src/server/lib/hub-event-crypto.test.ts` (new)

### D1: `deriveServerEventKey`

| Test | Assert |
|------|--------|
| Deterministic | Same secret = same 32-byte key |
| Different secrets | Different inputs = different keys |
| Key length | Returns exactly 32 bytes |

### D2: `encryptHubEvent / decryptHubEvent`

| Test | Assert |
|------|--------|
| Roundtrip | Encrypt JSON → decrypt = deep equal original |
| Wrong key | Different key returns null |
| Nonce uniqueness | Same input produces different ciphertext |
| Complex payloads | Nested objects, arrays, unicode strings all roundtrip |

---

## Part E: Client `crypto.ts` — Core Primitives Only

**File:** `src/client/lib/crypto.test.ts` (new)

Only tier 1 primitives. Note/message/file encryption tests go in spec 2.

### E1: `generateKeyPair`

| Test | Assert |
|------|--------|
| Valid structure | secretKey is 32 bytes, publicKey is 64 hex chars |
| Bech32 encoding | nsec starts with "nsec1", npub starts with "npub1" |
| Uniqueness | Two calls produce different keys |

### E2: `keyPairFromNsec / isValidNsec`

| Test | Assert |
|------|--------|
| Roundtrip | generateKeyPair → nsec → keyPairFromNsec = same pubkey |
| Invalid nsec | Returns null |
| isValidNsec | True for valid, false for garbage |

### E3: `eciesWrapKey / eciesUnwrapKey`

| Test | Assert |
|------|--------|
| Roundtrip | Wrap 32-byte key → unwrap = original |
| Wrong key rejects | Different privkey throws |
| Nonce uniqueness | Two wraps produce different wrappedKey |
| Domain separation | Wrap with label A, unwrap with label B throws |

### E4: `createAuthToken`

| Test | Assert |
|------|--------|
| Valid structure | Returns JSON with pubkey, timestamp, token fields |
| Pubkey matches | Token's pubkey matches input key's pubkey |
| Signature verifiable | Cross-validate with server `verifyAuthToken` |

---

## Part F: Client `key-store.ts` — PBKDF2 PIN Encryption

**File:** `src/client/lib/key-store.test.ts` (new)

**Mocking strategy:** Mock `localStorage` via a simple in-memory Map object. No browser needed — the functions just call `localStorage.getItem/setItem/removeItem`.

### F1: `isValidPin`

| Test | Assert |
|------|--------|
| 6 digits | Valid |
| 7 digits | Valid |
| 8 digits | Valid |
| 5 digits | Invalid |
| 9 digits | Invalid |
| Letters | Invalid |
| Empty string | Invalid |

### F2: `storeEncryptedKey / decryptStoredKey`

| Test | Assert |
|------|--------|
| Correct PIN roundtrip | Store nsec → decrypt with same PIN = original nsec |
| Wrong PIN | Returns null |
| Stored format | Parsed JSON has salt, nonce, ciphertext (all hex), iterations=600000, pubkey hash |
| PBKDF2 iterations | `stored.iterations === 600_000` |

### F3: `reEncryptKey`

| Test | Assert |
|------|--------|
| PIN change | Store with PIN A → reEncrypt with PIN B → decrypt with B works, decrypt with A fails |

### F4: `hasStoredKey / getStoredKeyId / clearStoredKey`

| Test | Assert |
|------|--------|
| Lifecycle | store → hasStoredKey=true → getStoredKeyId returns non-null → clear → hasStoredKey=false → getStoredKeyId=null |

---

## Test Patterns

All tests follow existing conventions from `src/server/lib/crypto.test.ts`:

- **Pure functions only** — no DB, no network, no running services
- **Real crypto** — use actual `@noble/curves`, `@noble/ciphers`, `@noble/hashes` (not mocked)
- **Mock only I/O** — localStorage gets an in-memory mock
- **Dynamic imports** where needed: `const { schnorr } = await import('@noble/curves/secp256k1.js')`
- **`bun:test`** — `describe`, `test`, `expect`, `beforeAll`/`afterAll`

## Test Count Estimate

| Section | Tests |
|---------|-------|
| B: Server crypto expansion | ~25 |
| C: Server auth | ~12 |
| D: Hub event crypto | ~7 |
| E: Client crypto primitives | ~10 |
| F: Client key-store | ~10 |
| **Total new unit tests** | **~64** |

## Dependencies

- No new npm packages
- No infrastructure requirements (that's the point)
- Specs 2 and 3 build on these primitives being tested
