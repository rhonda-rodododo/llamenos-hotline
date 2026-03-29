# Crypto Test Rewrite: IdP Auth Worker Migration

**Date:** 2026-03-28
**Context:** Merging main's crypto test suite (#19, 396 tests) into feat/idp-auth-hardening. Many tests reference old sync APIs that were replaced by async Web Worker-based crypto.

## Tests Deleted (incompatible with worker-based crypto)

### 1. `src/server/lib/auth.test.ts`
- **Tested:** `parseAuthHeader`, `parseSessionHeader`, `validateToken`, `verifyAuthToken` (Schnorr-based auth)
- **Why deleted:** Schnorr signature auth completely replaced by JWT. These functions no longer exist.
- **Replacement needed:** Tests for JWT middleware (`src/server/middleware/auth.ts`), `signAccessToken`/`verifyAccessToken` in `src/server/lib/jwt.ts`

### 2. `src/client/lib/key-store.test.ts`
- **Tested:** `storeEncryptedKey`, `decryptStoredKey`, `hasStoredKey`, `clearStoredKey`, `reEncryptKey`, `isValidPin`, `getStoredKeyId` (key-store v1, PIN-only)
- **Why deleted:** key-store v1 replaced by key-store-v2 with multi-factor KEK (PIN + IdP value + WebAuthn PRF)
- **Replacement needed:** Tests for `key-store-v2.ts`: `encryptNsec`, `storeEncryptedKeyV2`, `loadEncryptedKeyV2`, `deriveKEK` with all factor combinations

### 3. `src/client/lib/key-manager.test.ts`
- **Tested:** `unlock`, `lock`, `isUnlocked`, `getPublicKeyHex`, `importKey`, `wipeKey` with sync key access (`getSecretKey`, `getNsec`, `createAuthToken`)
- **Why deleted:** key-manager now delegates all private key operations to Web Worker. `getSecretKey`/`getNsec`/`createAuthToken` removed. `isUnlocked()` is now async. `importKey` takes 6 args (multi-factor).
- **Replacement needed:** Tests for async worker-based key-manager: `unlock(pin)` with IdP value fetch, `importKey` with multi-factor params, `isUnlocked()` async, `onUnlock`/`onLock` callbacks

### 4. `src/client/lib/hub-key-manager.test.ts`
- **Tested:** Hub key decryption via `eciesUnwrapKey(envelope, secretKey, label)` — takes explicit secretKey
- **Why deleted:** `eciesUnwrapKey` no longer takes secretKey — it uses the Web Worker internally
- **Replacement needed:** Tests for `eciesUnwrapKey(envelope, label)` (worker-based), `loadHubKeysForUser`, hub key cache

### 5. `src/client/lib/file-crypto.test.ts`
- **Tested:** File encryption/decryption with explicit secretKey parameter
- **Why deleted:** File crypto functions no longer take secretKey — worker-based
- **Replacement needed:** Tests for `encryptFile`, `decryptFileKey` (worker-based), `encryptFileMetadata`

### 6. `src/client/lib/hub-key-cache.test.ts`
- **Tested:** Hub key caching with explicit secretKey in ECIES unwrap
- **Why deleted:** ECIES unwrap no longer takes secretKey
- **Replacement needed:** Tests for `getHubKey`, `loadHubKeysForUser`, cache invalidation on lock

## Tests That Still Need Fixing (not deleted)

### `src/client/lib/crypto.test.ts`
- References `createAuthToken` (removed), `verifyAuthToken` (removed)
- `eciesUnwrapKey` signature changed (no secretKey param)
- Needs partial rewrite: keep ECIES encrypt/wrap tests, remove Schnorr auth token tests, update unwrap calls

### Contact Components (from PR #26)
- `contact-relationship-section.tsx`, `contact-select.tsx` — import `tryDecryptField` (removed)
- `create-contact-dialog.tsx` — calls `getSecretKey()` (removed, now async worker)
- Need migration to decrypt-on-fetch hooks and async worker API

## Priority
These tests should be rewritten AFTER the idp-auth branch is stable and merged. The crypto protocol hasn't changed (same ECIES, XChaCha20, PBKDF2) — only the key access method changed (sync closure → async worker postMessage).
