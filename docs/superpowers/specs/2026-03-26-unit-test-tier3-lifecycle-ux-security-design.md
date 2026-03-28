# Unit Test Tier 3: Lifecycle & UX Security

**Date:** 2026-03-26
**Status:** Draft
**Tier:** 3 of 3 (Core Primitives → E2EE Application Layer → **Lifecycle & UX Security**)
**Depends on:** Tier 1 and 2 (primitives and E2EE application layer tested and passing)

## Overview

Tiers 1 and 2 proved the crypto primitives and E2EE workflows are correct. This spec covers the lifecycle and UX security layer: the singleton key manager (in-memory key, auto-lock, idle timers), backup/recovery file creation and restoration, device provisioning (QR-based device linking via ephemeral ECDH), and the panic wipe (triple-Escape emergency key destruction).

These modules are where human factors intersect with cryptography. A bug here can expose a volunteer's identity even if the underlying crypto is perfect — for example, a key that doesn't actually zero on lock, a backup that decrypts with the wrong PIN, or a panic wipe that leaves IndexedDB data behind.

## Goals

- Every state transition in key-manager is tested: locked → unlocked → locked, import, wipe
- Auto-lock timers (idle + tab-hide grace period) are tested with timer mocks — not real delays
- `lock()` zeroes the key bytes in place before clearing the reference
- Backup roundtrips prove PIN-recovery and recovery-key-recovery both work
- Timestamp rounding to the nearest hour is proven with boundary cases
- Recovery key format (Base32, dash-grouped, 128 bits) is structurally validated
- Provisioning SAS codes are identical on both sides of the ECDH (MITM-free path)
- `encryptNsecForDevice` / `decryptProvisionedNsec` roundtrip is proven
- QR encode/decode, short code extraction, and `computeProvisioningSAS` determinism are tested
- Panic wipe clears localStorage, sessionStorage, and IndexedDB; unregisters service workers; calls `wipeKey()`
- Triple-Escape timing logic: 3 presses within 1 s triggers wipe; 3 presses spread > 1 s does not
- A non-Escape key resets the escape counter

## Non-Goals

- Browser rendering or React component tests (those belong in E2E)
- `downloadBackupFile` — requires DOM Blob/anchor manipulation, belongs in E2E smoke tests
- `createProvisioningRoom`, `pollProvisioningRoom`, `getProvisioningRoom`, `sendProvisionedKey` — these are thin fetch wrappers; their network behavior is covered by API integration tests, not unit tests
- Testing PBKDF2 iteration counts in backup (those were verified in Tier 1)
- `key-store.ts` functions in isolation — already covered by Tier 1; key-manager tests drive through key-store via mocked module

---

## Part A: key-manager.ts

**File:** `src/client/lib/key-manager.test.ts` (new file)

The key manager is a singleton with module-level mutable state. Tests must reset state between cases. The recommended approach is to mock the `key-store` module and `nostr-tools` so tests never touch localStorage and run fast. Timer tests mock `setTimeout`/`clearTimeout` via `bun:test`'s fake timer support.

**Module mock strategy:**
- Mock `./key-store` with `mock.module(...)` — replace `decryptStoredKey`, `storeEncryptedKey`, `clearStoredKey`, `hasStoredKey` with controllable stubs
- Mock `nostr-tools` `nip19.decode` and `getPublicKey` to return deterministic test values without real key derivation
- Use `vi.useFakeTimers()` (or `bun:test` fake timer equivalent) for all timer-dependent tests
- Between tests: call `lock()` to reset key state; reset all mock return values

### A1: `isValidPin(pin)`

| Test | Assert |
|------|--------|
| Valid 6-digit | `"123456"` → `true` |
| Valid 7-digit | `"1234567"` → `true` |
| Valid 8-digit | `"12345678"` → `true` |
| Too short | `"12345"` → `false` |
| Too long | `"123456789"` → `false` |
| Non-numeric | `"12345a"` → `false` |
| Empty string | `""` → `false` |
| With spaces | `"123 456"` → `false` |

### A2: `unlock(pin)` — state transitions

| Test | Assert |
|------|--------|
| Correct PIN | `decryptStoredKey` returns valid nsec → `unlock` returns hex pubkey string |
| Wrong PIN | `decryptStoredKey` returns null → `unlock` returns null |
| After correct unlock | `isUnlocked()` → `true` |
| After wrong unlock | `isUnlocked()` → `false` |
| Fires unlock callbacks | Registered callback via `onUnlock` is invoked exactly once |
| Does not fire lock callbacks | Lock callback is NOT invoked on successful unlock |

### A3: `lock()` — key zeroing

| Test | Assert |
|------|--------|
| Zeros key bytes | After unlock: capture the secretKey reference (via `getSecretKey()`), then call `lock()`. The captured `Uint8Array` contains all zeros |
| isUnlocked after lock | `isUnlocked()` → `false` |
| getSecretKey after lock | Throws `KeyLockedError` |
| Fires lock callbacks | Registered callback via `onLock` is invoked exactly once |
| Clears idle timer | setTimeout was cancelled (clearTimeout called with timer ID) |
| Double lock is safe | Calling `lock()` twice does not throw |
| publicKey preserved | `getPublicKeyHex()` still returns pubkey after lock (pubkey is not secret) |

### A4: `importKey(nsec, pin)`

| Test | Assert |
|------|--------|
| Valid nsec | Returns hex pubkey; `isUnlocked()` → `true` |
| Calls storeEncryptedKey | Mock is called with the nsec and pin |
| Fires unlock callbacks | Registered callback invoked |
| Invalid nsec type | Decoding a non-nsec bech32 → throws with descriptive error |

### A5: `getSecretKey()` — resets idle timer

| Test | Assert |
|------|--------|
| While unlocked | Returns the `Uint8Array` |
| While locked | Throws `KeyLockedError` |
| Resets idle timer | After `getSecretKey()` call, the idle timer is rescheduled (clearTimeout + setTimeout called) |

### A6: `createAuthToken(timestamp, method, path)` — locked/unlocked

| Test | Assert |
|------|--------|
| While locked | Throws `KeyLockedError` |
| While unlocked | Returns a string (delegates to `_createAuthToken`) |
| Resets idle timer | setTimeout rescheduled after the call |

### A7: `onLock` / `onUnlock` callback management

| Test | Assert |
|------|--------|
| Register and unregister lock | Call unsubscribe fn → lock no longer calls the callback |
| Register and unregister unlock | Call unsubscribe fn → unlock no longer calls the callback |
| Multiple callbacks | Two callbacks both receive the event |

### A8: `wipeKey()`

| Test | Assert |
|------|--------|
| Calls lock() | `isUnlocked()` → `false` after wipe |
| Calls clearStoredKey | `clearStoredKey` mock is invoked |

### A9: Auto-lock idle timer (fake timers required)

| Test | Assert |
|------|--------|
| No timer while locked | setTimeout not called when unlock fails |
| Timer set on unlock | setTimeout called with 5-minute delay after successful unlock |
| Timer reset on getSecretKey | clearTimeout + setTimeout called again after key access |
| Timer fires and locks | Advance fake clock 5 minutes → `isUnlocked()` becomes `false` |
| `disableAutoLock()` prevents timer | After `disableAutoLock()`, unlock does not call setTimeout |
| `disableAutoLock()` cancels active timer | If timer is running, it is cleared immediately |

### A10: `setLockDelay` / `getLockDelayMs`

| Test | Assert |
|------|--------|
| Store and retrieve | `setLockDelay(60000)` → `getLockDelayMs()` returns `60000` |
| Clamps at 0 | `setLockDelay(-1000)` → `getLockDelayMs()` returns `0` |
| Clamps at 600000 | `setLockDelay(999999)` → `getLockDelayMs()` returns `600000` |
| Default when no stored value | Fresh localStorage mock (no key) → `getLockDelayMs()` returns `30000` |

### A11: `getNsec()`

| Test | Assert |
|------|--------|
| While locked | Returns `null` |
| While unlocked | Returns bech32 `nsec1…` string matching the imported nsec |

### A12: `KeyLockedError`

| Test | Assert |
|------|--------|
| Is instanceof Error | `new KeyLockedError() instanceof Error` → `true` |
| name property | `error.name === 'KeyLockedError'` |
| message content | Message includes "PIN" or "locked" |

---

## Part B: backup.ts

**File:** `src/client/lib/backup.test.ts` (new file)

All functions except `downloadBackupFile` are testable. `createBackup` and `restoreFrom*` are async and use `crypto.subtle` — these work in Bun's runtime without mocking. The roundtrip tests are the most important: they prove the dual-PBKDF2 encryption scheme is symmetric.

**Note on test speed:** PBKDF2 at 600k iterations takes ~300–600 ms per call. Each `createBackup` call runs two PBKDF2 derivations. Tests should be grouped under a single shared backup fixture to minimize total derivation time. Mark the suite with a generous timeout (10 s).

### B1: `generateRecoveryKey()`

| Test | Assert |
|------|--------|
| Format | Matches `/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/` (8 groups of 4, dash-separated) |
| Length | Decoded from Base32 = 128 bits (16 bytes) of entropy; string length = 39 chars |
| Uniqueness | Two calls return different strings |
| Only valid Base32 chars | All non-dash chars are in `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567` |

### B2: `createBackup(nsec, pin, pubkey, recoveryKey)` — structure

| Test | Assert |
|------|--------|
| Version field | `backup.v === 1` |
| Has both blocks | `backup.d` and `backup.r` are present |
| PIN block fields | `d.s`, `d.i`, `d.n`, `d.c` are non-empty hex strings |
| Recovery block fields | `r.s`, `r.i`, `r.n`, `r.c` are non-empty hex strings |
| PIN iterations | `backup.d.i === 600000` |
| Recovery iterations | `backup.r.i === 100000` |
| Id is truncated hash | `backup.id` is 6 hex chars (matches `/^[0-9a-f]{6}$/`) |
| Timestamp is rounded | `backup.t % 3600 === 0` (unix seconds, rounded to hour) |
| Randomness | Two calls with same inputs produce different salts (`d.s` differs) |

### B3: `restoreFromBackupWithPin(backup, pin)` — roundtrip

| Test | Assert |
|------|--------|
| Correct PIN | Returns the original nsec string |
| Wrong PIN | Returns `null` |
| Corrupted ciphertext | Manually flip a hex char in `backup.d.c` → returns `null` |

### B4: `restoreFromBackupWithRecoveryKey(backup, recoveryKey)` — roundtrip

| Test | Assert |
|------|--------|
| Correct recovery key | Returns the original nsec string |
| Wrong recovery key | Returns `null` |
| Missing `r` block | `backup.r = undefined` → returns `null` immediately |
| Dashes are stripped | Recovery key with dashes decrypts same as without |
| Case insensitive | Lowercase recovery key decrypts same as uppercase |

### B5: `roundToHour` — timestamp rounding (test via `createBackup`)

| Test | Assert |
|------|--------|
| Exact hour | Input `new Date(3600000)` (hour 1) → `backup.t === 3600` |
| 29 min past | Input `new Date(3600000 + 29*60*1000)` → rounds down to `3600` |
| 30 min past | Input `new Date(3600000 + 30*60*1000)` → rounds up to `7200` |
| 31 min past | Input `new Date(3600000 + 31*60*1000)` → rounds up to `7200` |

Implementation note: `roundToHour` is not exported. Test indirectly by passing a fake `Date` to `createBackup`, or by extracting the logic into a separate helper and testing it directly. The cleanest approach is to add `export { roundToHour }` in the test environment via import of the internal. Alternatively, verify the invariant `backup.t % 3600 === 0` holds for any timestamp input.

### B6: `readBackupFile(file)` — parsing

| Test | Assert |
|------|--------|
| Valid backup JSON | Returns a `BackupFile` object |
| Missing `v` field | Returns `null` |
| Missing `d` field | Returns `null` |
| `d.s` is not a string | Returns `null` |
| Malformed JSON | Returns `null` |
| Old/unknown format | Returns `null` |

---

## Part C: provisioning.ts

**File:** `src/client/lib/provisioning.test.ts` (new file)

Focus is on the pure crypto and encoding functions. The fetch-dependent functions (`createProvisioningRoom`, `pollProvisioningRoom`, `getProvisioningRoom`, `sendProvisionedKey`) have a separate section with mocked `fetch`.

### C1: `computeProvisioningSAS(sharedX)` — determinism and format

| Test | Assert |
|------|--------|
| Deterministic | Same `sharedX` → same SAS string |
| Format | Matches `/^\d{3} \d{3}$/` |
| Sensitivity | One-bit flip in `sharedX` → different SAS string |
| Range | Numeric value of the 6 digits is in `[0, 999999]` |
| Zero-padded | Short codes are zero-padded to 6 digits (e.g. `"000 042"`) |

### C2: `computeSASForNewDevice` / `computeSASForPrimaryDevice` — ECDH symmetry

This is the critical MITM-prevention test. Both functions must produce the same SAS from opposite sides of the same ECDH exchange.

| Test | Assert |
|------|--------|
| Symmetric SAS | Generate a real secp256k1 keypair for "new device" and "primary device"; compute SAS from each side → strings are identical |
| x-only pubkey accepted | `computeSASForNewDevice` with 64-char hex (x-only) pubkey computes same result as with 66-char compressed |
| Different keypairs | SAS from one keypair does not equal SAS from an unrelated keypair (no false positives) |

### C3: `encryptNsecForDevice` / `decryptProvisionedNsec` — roundtrip

This tests the full provisioning payload path: primary encrypts the nsec, new device decrypts it.

| Test | Assert |
|------|--------|
| Roundtrip | Generate ephemeral keypair; encrypt nsec with `encryptNsecForDevice(nsec, ePubHex, primarySK)`; decrypt with `decryptProvisionedNsec(encrypted, primaryPubHex, ephemeralSK)` = original nsec |
| Wrong secret key | Using a different secret key to decrypt returns garbage or throws |
| Nonce prefix | Encrypted hex is at least 48 chars (24 bytes nonce prefix + ciphertext) |
| Different nonces | Two encryptions of the same nsec produce different hex strings |

### C4: `encodeProvisioningQR` / `decodeProvisioningQR`

| Test | Assert |
|------|--------|
| Roundtrip | `decodeProvisioningQR(encodeProvisioningQR(roomId, token))` returns `{ r: roomId, t: token }` |
| Invalid JSON | `decodeProvisioningQR("not json")` returns `null` |
| Missing `r` field | `decodeProvisioningQR('{"t":"abc"}')` returns `null` |
| Missing `t` field | `decodeProvisioningQR('{"r":"abc"}')` returns `null` |
| Extra fields preserved | Additional fields in the JSON do not cause `null` return |

### C5: `getShortCode(roomId)`

| Test | Assert |
|------|--------|
| Takes first 8 chars | `getShortCode("abcd1234xyz")` → `"ABCD1234"` |
| Uppercased | Output is uppercase |
| Short roomId | `getShortCode("abc")` → `"ABC"` (no crash) |

### C6: `createProvisioningRoom` — mocked fetch

| Test | Assert |
|------|--------|
| Success | Mock `fetch` to return `{ roomId: "r1", token: "t1" }` → returns `ProvisioningSession` with `roomId`, `token`, `ephemeralSecret`, `ephemeralPubkey` |
| Generates fresh ephemeral key | `ephemeralSecret` is a 32-byte `Uint8Array`, `ephemeralPubkey` is 66-char hex |
| HTTP error | Mock `fetch` to return status 500 → throws |

### C7: `pollProvisioningRoom` — mocked fetch

| Test | Assert |
|------|--------|
| Waiting status | Mock returns `{ status: "waiting" }` → returns `{ status: "waiting" }` |
| Ready status | Mock returns `{ status: "ready", encryptedNsec: "...", primaryPubkey: "..." }` → returns all fields |
| 404 response | Mock returns status 404 → returns `{ status: "expired" }` |
| 410 response | Mock returns status 410 → returns `{ status: "expired" }` |
| Other HTTP error | Mock returns status 500 → throws |

---

## Part D: panic-wipe.ts

**File:** `src/client/lib/panic-wipe.test.ts` (new file)

Panic wipe requires DOM mocks. Bun's test environment supports `happy-dom` or `jsdom`. The key challenge is isolating the module-level `escapeTimes` state between tests — either re-import the module fresh for each test group, or call `initPanicWipe` to reset state.

**DOM mock strategy:**
- Mock `keyManager.wipeKey` via `mock.module('./key-manager', ...)`
- Mock `localStorage` and `sessionStorage` via `Object.defineProperty(globalThis, 'localStorage', ...)` or the happy-dom built-ins
- Mock `indexedDB.databases()` and `indexedDB.deleteDatabase()` via spies
- Mock `navigator.serviceWorker.getRegistrations()` via spies
- Mock `window.location.href` setter to capture redirect target
- Use fake timers to control the `FLASH_DURATION_MS` (200 ms) setTimeout in `performPanicWipe`

### D1: `performPanicWipe()` — key zeroing and storage clearing

| Test | Assert |
|------|--------|
| Calls `wipeKey` | `keyManager.wipeKey` mock is invoked |
| Fires onWipe callback | Callback registered via `initPanicWipe(cb)` is called immediately (before setTimeout fires) |
| Clears localStorage | `localStorage.clear()` called inside the deferred setTimeout |
| Clears sessionStorage | `sessionStorage.clear()` called inside the deferred setTimeout |
| Redirects to /login | `window.location.href` is set to `"/login"` after timer fires |
| Uses 200ms delay | The redirect and storage clear happen after advancing fake clock 200 ms, not before |
| Deletes IndexedDB databases | `indexedDB.databases()` called; `indexedDB.deleteDatabase(name)` called for each returned DB |
| Unregisters service workers | `navigator.serviceWorker.getRegistrations()` called; `reg.unregister()` called for each registration |
| wipeKey throws | If `wipeKey` throws, wipe continues without propagating error |
| localStorage unavailable | If `localStorage.clear()` throws, wipe continues (sessionStorage still cleared, redirect still fires) |

### D2: `initPanicWipe(onWipe)` — keyboard listener

| Test | Assert |
|------|--------|
| Returns cleanup function | `initPanicWipe()` returns a function |
| Cleanup removes listener | After calling the returned cleanup fn, keydown events no longer trigger wipe |
| Cleanup clears callback | `panicWipeCallback` is set to null after cleanup |
| No callback variant | `initPanicWipe()` (no args) does not crash when wipe fires |

### D3: Triple-Escape detection — timing

All tests dispatch synthetic `KeyboardEvent` via the `handleKeyDown` listener installed by `initPanicWipe`.

| Test | Assert |
|------|--------|
| 3 Escapes within 1 s triggers wipe | Dispatch 3 Escape events with timestamps within 1000 ms → `performPanicWipe` called |
| 2 Escapes does not trigger | Only 2 Escape events → wipe NOT called |
| 3 Escapes spread > 1 s does not trigger | Advance fake clock between presses so oldest is > 1000 ms ago → wipe NOT called |
| Counter resets on non-Escape key | Press Escape twice, then press "a", then press Escape once → counter is 1, wipe NOT called |
| Counter resets after trigger | After a wipe fires, press Escape 3 more times → wipe fires again (state is clean) |
| Exactly at 1000ms boundary | 3rd Escape arrives at exactly 1000 ms after 1st → still triggers (filter is `now - t <= WINDOW_MS`) |
| Just over 1000ms boundary | 3rd Escape arrives at 1001 ms after 1st → 1st press filtered out, count drops to 2 → no wipe |

### D4: Callback lifecycle

| Test | Assert |
|------|--------|
| Callback called before storage clear | `onWipe` fires synchronously; `localStorage.clear` fires in deferred setTimeout — verify order with call sequence tracking |
| Callback replaced on re-init | `initPanicWipe(cb1)` then `initPanicWipe(cb2)` → only `cb2` is called on wipe |

---

## Test Patterns

### Timer mocking (key-manager, panic-wipe)

Bun's test runner supports fake timers via `mock.timers`. Use `mock.timers.enable(['setTimeout', 'clearTimeout', 'Date'])` at the start of timer-dependent test suites and restore with `mock.timers.restore()` in `afterEach`. Advance time with `mock.timers.tick(ms)`.

For panic-wipe tests, fake `Date.now()` to control the `escapeTimes` window filtering without actually sleeping.

### Module-level singleton state reset

`key-manager.ts` uses module-level variables (`secretKey`, `publicKey`, `autoLockDisabled`, `idleTimer`). Because Bun re-uses module instances across tests in the same file, state leaks between tests. Mitigate by:

1. Calling `lock()` in `beforeEach` to zero the key and clear timers
2. Calling `disableAutoLock()` / resetting via a new `initPanicWipe` call for panic-wipe

`panic-wipe.ts` similarly uses module-level `escapeTimes`. Call `initPanicWipe()` at the start of each test to reset it, and call the returned cleanup fn in `afterEach`.

### Mock `key-store` to avoid localStorage in key-manager tests

```typescript
mock.module('./key-store', () => ({
  decryptStoredKey: mock(() => Promise.resolve(null)),
  storeEncryptedKey: mock(() => Promise.resolve()),
  clearStoredKey: mock(() => {}),
  hasStoredKey: mock(() => false),
}))
```

Return a valid nsec from `decryptStoredKey` in positive-path tests. The nsec can be a real bech32-encoded secp256k1 private key generated once in the test file's `beforeAll`.

### PBKDF2 test speed

`backup.ts` roundtrip tests run PBKDF2 at 600k iterations, which is slow by design. Run the full `createBackup` once in `beforeAll`, then share the fixture across all roundtrip tests. Total wall time for the suite should stay under 5 s with this strategy.

### Key generation for provisioning tests

Use `secp256k1.utils.randomPrivateKey()` from `@noble/curves/secp256k1.js` to generate real keypairs for the ECDH symmetry tests. These are deterministic, fast operations — no mocking needed for the pure crypto tests in Part C.

### IndexedDB and ServiceWorker mocks

For panic-wipe tests, use the `happy-dom` environment (configured in `bunfig.toml` or per-test via `@jest-environment happy-dom`). The relevant properties can be spied on:

```typescript
const mockDeleteDatabase = mock(() => ({ result: undefined }))
const mockDatabases = mock(() => Promise.resolve([{ name: 'llamenos-db' }]))
Object.defineProperty(globalThis, 'indexedDB', {
  value: { databases: mockDatabases, deleteDatabase: mockDeleteDatabase },
  writable: true,
})
```

For `navigator.serviceWorker`, mock `getRegistrations` to return fake registration objects with a spy `unregister()` method.

---

## Test Count Estimate

| Module | Test file | Approx. tests |
|--------|-----------|---------------|
| key-manager.ts | `key-manager.test.ts` | 45 |
| backup.ts | `backup.test.ts` | 28 |
| provisioning.ts | `provisioning.test.ts` | 32 |
| panic-wipe.ts | `panic-wipe.test.ts` | 22 |
| **Total** | 4 new files | **~127** |

Combined with Tier 1 (~80 tests) and Tier 2 (~110 tests), the full unit test suite reaches approximately 317 tests — all running without PostgreSQL, Nostr relay, or any network dependency.

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `bun:test` fake timers | Built-in | `mock.timers.enable` / `tick` |
| `bun:test` module mocks | Built-in | `mock.module(...)` for key-store, key-manager |
| `happy-dom` or `jsdom` | Must configure | Required for localStorage, IndexedDB, navigator.serviceWorker, document.addEventListener |
| `@noble/curves/secp256k1.js` | Already a dep | For generating real keypairs in provisioning tests |
| A valid test nsec | Generated once | Use `secp256k1.utils.randomPrivateKey()` + `nip19.nsecEncode()` in `beforeAll` |
| `bunfig.toml` DOM env | May need update | Confirm `happy-dom` or `jsdom` is configured for `src/client/lib/**` tests |
