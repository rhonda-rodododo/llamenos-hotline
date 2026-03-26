# Unit Test Tier 3: Lifecycle & UX Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit tests for key lifecycle management, backup/recovery, device provisioning, and panic wipe.

**Architecture:** Create 4 new test files with module mocking, timer mocking, and DOM mocking.

**Tech Stack:** bun:test (mock.module, mock.timers), @noble/curves, nostr-tools

**Spec:** `docs/superpowers/specs/2026-03-26-unit-test-tier3-lifecycle-ux-security-design.md`

---

## Task 1: Create `key-manager.test.ts` (~45 tests)

**File to create:** `src/client/lib/key-manager.test.ts`

The key manager is a singleton with module-level mutable state. Tests must mock `./key-store` to avoid localStorage, use real `nostr-tools` for key encoding, and reset state via `lock()` in `beforeEach`. Timer-dependent tests use `mock.module` to intercept `setTimeout`/`clearTimeout` since `key-manager.ts` calls them at module scope.

**Critical constraint:** `key-manager.ts` imports `./key-store` and `nostr-tools` at the top level, and has a `document.addEventListener('visibilitychange', ...)` side effect. The `typeof document !== 'undefined'` guard protects against crashes in Bun's test environment (no DOM). The `mock.module('./key-store', ...)` call MUST appear before the `import` of `./key-manager` to intercept correctly.

- [ ] **Step 1.1:** Create the test file with mock setup and shared test fixtures:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { nip19 } from 'nostr-tools'

// --- Mock key-store before importing key-manager ---
const mockDecryptStoredKey = mock(() => Promise.resolve(null as string | null))
const mockStoreEncryptedKey = mock(() => Promise.resolve())
const mockClearStoredKey = mock(() => {})
const mockHasStoredKey = mock(() => false)

mock.module('./key-store', () => ({
  decryptStoredKey: mockDecryptStoredKey,
  storeEncryptedKey: mockStoreEncryptedKey,
  clearStoredKey: mockClearStoredKey,
  hasStoredKey: mockHasStoredKey,
}))

// Import AFTER mocking
import {
  KeyLockedError,
  createAuthToken,
  disableAutoLock,
  getLockDelayMs,
  getNsec,
  getPublicKeyHex,
  getSecretKey,
  importKey,
  isUnlocked,
  isValidPin,
  lock,
  onLock,
  onUnlock,
  setLockDelay,
  unlock,
  wipeKey,
} from './key-manager'

// --- Test fixtures ---
const testSecretKey = secp256k1.utils.randomPrivateKey()
const testNsec = nip19.nsecEncode(testSecretKey)
const testPubkey = bytesToHex(secp256k1.getPublicKey(testSecretKey, true).slice(1))
// nostr-tools getPublicKey returns x-only hex, replicate that:
import { getPublicKey as nostrGetPublicKey } from 'nostr-tools'
const testPubkeyHex = nostrGetPublicKey(testSecretKey)

beforeEach(() => {
  lock()
  mockDecryptStoredKey.mockReset()
  mockStoreEncryptedKey.mockReset()
  mockClearStoredKey.mockReset()
  mockHasStoredKey.mockReset()
  // Default: decryptStoredKey returns null (wrong PIN)
  mockDecryptStoredKey.mockImplementation(() => Promise.resolve(null))
})
```

- [ ] **Step 1.2:** Add A1 — `isValidPin` tests:

```ts
describe('isValidPin', () => {
  test('valid 6-digit', () => expect(isValidPin('123456')).toBe(true))
  test('valid 7-digit', () => expect(isValidPin('1234567')).toBe(true))
  test('valid 8-digit', () => expect(isValidPin('12345678')).toBe(true))
  test('too short (5 digits)', () => expect(isValidPin('12345')).toBe(false))
  test('too long (9 digits)', () => expect(isValidPin('123456789')).toBe(false))
  test('non-numeric', () => expect(isValidPin('12345a')).toBe(false))
  test('empty string', () => expect(isValidPin('')).toBe(false))
  test('with spaces', () => expect(isValidPin('123 456')).toBe(false))
})
```

- [ ] **Step 1.3:** Add A2 — `unlock()` state transition tests:

```ts
describe('unlock', () => {
  test('correct PIN returns hex pubkey string', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    const result = await unlock('123456')
    expect(result).toBe(testPubkeyHex)
  })

  test('wrong PIN returns null', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(null))
    const result = await unlock('000000')
    expect(result).toBeNull()
  })

  test('isUnlocked() is true after correct unlock', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    expect(isUnlocked()).toBe(true)
  })

  test('isUnlocked() is false after wrong unlock', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(null))
    await unlock('000000')
    expect(isUnlocked()).toBe(false)
  })

  test('fires unlock callbacks', async () => {
    const cb = mock(() => {})
    onUnlock(cb)
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('does not fire lock callbacks on successful unlock', async () => {
    const cb = mock(() => {})
    onLock(cb)
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    expect(cb).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 1.4:** Add A3 — `lock()` key zeroing tests:

```ts
describe('lock', () => {
  test('zeros key bytes in place', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    const keyRef = getSecretKey()
    lock()
    // The captured reference should be zeroed
    expect(keyRef.every((b) => b === 0)).toBe(true)
  })

  test('isUnlocked() is false after lock', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    lock()
    expect(isUnlocked()).toBe(false)
  })

  test('getSecretKey() throws KeyLockedError after lock', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    lock()
    expect(() => getSecretKey()).toThrow(KeyLockedError)
  })

  test('fires lock callbacks', async () => {
    const cb = mock(() => {})
    onLock(cb)
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    cb.mockClear()
    lock()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('double lock is safe', () => {
    lock()
    expect(() => lock()).not.toThrow()
  })

  test('publicKey preserved after lock', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    const pk = getPublicKeyHex()
    lock()
    expect(getPublicKeyHex()).toBe(pk)
  })
})
```

- [ ] **Step 1.5:** Add A4 — `importKey()` tests:

```ts
describe('importKey', () => {
  test('valid nsec returns hex pubkey and unlocks', async () => {
    const result = await importKey(testNsec, '123456')
    expect(typeof result).toBe('string')
    expect(result.length).toBe(64)
    expect(isUnlocked()).toBe(true)
  })

  test('calls storeEncryptedKey', async () => {
    await importKey(testNsec, '123456')
    expect(mockStoreEncryptedKey).toHaveBeenCalledTimes(1)
  })

  test('fires unlock callbacks', async () => {
    const cb = mock(() => {})
    onUnlock(cb)
    await importKey(testNsec, '123456')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('invalid nsec type throws', async () => {
    // npub is not nsec
    const npub = nip19.npubEncode(testPubkeyHex)
    expect(importKey(npub, '123456')).rejects.toThrow()
  })
})
```

- [ ] **Step 1.6:** Add A5 — `getSecretKey()` tests:

```ts
describe('getSecretKey', () => {
  test('returns Uint8Array while unlocked', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    const sk = getSecretKey()
    expect(sk).toBeInstanceOf(Uint8Array)
    expect(sk.length).toBe(32)
  })

  test('throws KeyLockedError while locked', () => {
    expect(() => getSecretKey()).toThrow(KeyLockedError)
  })
})
```

- [ ] **Step 1.7:** Add A6 — `createAuthToken()` tests:

```ts
describe('createAuthToken', () => {
  test('throws KeyLockedError while locked', () => {
    expect(() => createAuthToken(Date.now(), 'GET', '/api/test')).toThrow(KeyLockedError)
  })

  test('returns string while unlocked', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    const token = createAuthToken(Date.now(), 'GET', '/api/test')
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 1.8:** Add A7 — callback management tests:

```ts
describe('onLock / onUnlock callback management', () => {
  test('unregister lock callback stops invocation', async () => {
    const cb = mock(() => {})
    const unsub = onLock(cb)
    unsub()
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    lock()
    expect(cb).not.toHaveBeenCalled()
  })

  test('unregister unlock callback stops invocation', async () => {
    const cb = mock(() => {})
    const unsub = onUnlock(cb)
    unsub()
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    expect(cb).not.toHaveBeenCalled()
  })

  test('multiple callbacks all fire', async () => {
    const cb1 = mock(() => {})
    const cb2 = mock(() => {})
    onUnlock(cb1)
    onUnlock(cb2)
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 1.9:** Add A8 — `wipeKey()` tests:

```ts
describe('wipeKey', () => {
  test('locks the key manager', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    wipeKey()
    expect(isUnlocked()).toBe(false)
  })

  test('calls clearStoredKey', () => {
    wipeKey()
    expect(mockClearStoredKey).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 1.10:** Add A10 — `setLockDelay / getLockDelayMs` tests. These require localStorage, so mock it on globalThis:

```ts
describe('setLockDelay / getLockDelayMs', () => {
  const store = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage

  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true, configurable: true })
  })

  test('store and retrieve', () => {
    setLockDelay(60000)
    expect(getLockDelayMs()).toBe(60000)
  })

  test('clamps negative to 0', () => {
    setLockDelay(-1000)
    expect(getLockDelayMs()).toBe(0)
  })

  test('clamps above 600000', () => {
    setLockDelay(999999)
    expect(getLockDelayMs()).toBe(600000)
  })

  test('default when no stored value', () => {
    expect(getLockDelayMs()).toBe(30000)
  })
})
```

- [ ] **Step 1.11:** Add A11 — `getNsec()` tests:

```ts
describe('getNsec', () => {
  test('returns null while locked', () => {
    expect(getNsec()).toBeNull()
  })

  test('returns bech32 nsec1... string while unlocked', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    const nsec = getNsec()
    expect(nsec).not.toBeNull()
    expect(nsec!.startsWith('nsec1')).toBe(true)
  })
})
```

- [ ] **Step 1.12:** Add A12 — `KeyLockedError` tests:

```ts
describe('KeyLockedError', () => {
  test('is instanceof Error', () => {
    expect(new KeyLockedError()).toBeInstanceOf(Error)
  })

  test('name property', () => {
    expect(new KeyLockedError().name).toBe('KeyLockedError')
  })

  test('message mentions locked or PIN', () => {
    const msg = new KeyLockedError().message.toLowerCase()
    expect(msg.includes('locked') || msg.includes('pin')).toBe(true)
  })
})
```

- [ ] **Step 1.13:** Run `bun test src/client/lib/key-manager.test.ts` and fix any issues. Verify all tests pass. If `mock.module` path resolution differs from relative imports, adjust the mock path (e.g., try full path `@/lib/key-store` or the resolved absolute path).

**Note on auto-lock timer tests (A9):** Bun's `mock.timers` support is limited. If `mock.timers.enable(['setTimeout', 'clearTimeout'])` and `mock.timers.tick()` work reliably, add these tests:

```ts
describe('auto-lock idle timer', () => {
  // Only include if mock.timers works in bun:test
  // Timer set on unlock → fires after 5 min → locks
  // Timer reset on getSecretKey
  // disableAutoLock prevents timer
  // disableAutoLock cancels active timer
})
```

If `mock.timers` is unstable or unsupported, skip timer tests and note them as deferred to E2E. The core state-transition tests (A2-A8) are the high-value tests here.

---

## Task 2: Create `backup.test.ts` (~28 tests)

**File to create:** `src/client/lib/backup.test.ts`

PBKDF2 at 600k iterations is slow (~300-600ms per derivation). Create ONE backup in `beforeAll` and share across all roundtrip tests. Mark the suite with a 15s timeout.

- [ ] **Step 2.1:** Create the test file with shared fixtures:

```ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { nip19 } from 'nostr-tools'
import {
  type BackupFile,
  createBackup,
  generateRecoveryKey,
  readBackupFile,
  restoreFromBackupWithPin,
  restoreFromBackupWithRecoveryKey,
} from './backup'

// --- Shared fixture: create once, reuse across tests ---
const testSecretKey = secp256k1.utils.randomPrivateKey()
const testNsec = nip19.nsecEncode(testSecretKey)
const testPubkey = bytesToHex(secp256k1.getPublicKey(testSecretKey, true).slice(1, 33))
const testPin = '123456'
let testRecoveryKey: string
let sharedBackup: BackupFile

beforeAll(async () => {
  testRecoveryKey = generateRecoveryKey()
  sharedBackup = await createBackup(testNsec, testPin, testPubkey, testRecoveryKey)
}, 15_000)
```

- [ ] **Step 2.2:** Add B1 — `generateRecoveryKey()` tests:

```ts
describe('generateRecoveryKey', () => {
  test('format matches XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', () => {
    const key = generateRecoveryKey()
    expect(key).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/)
  })

  test('string length is 39 chars (8 groups of 4 + 7 dashes)', () => {
    const key = generateRecoveryKey()
    expect(key.length).toBe(39)
  })

  test('two calls return different strings', () => {
    const k1 = generateRecoveryKey()
    const k2 = generateRecoveryKey()
    expect(k1).not.toBe(k2)
  })

  test('only valid Base32 characters', () => {
    const key = generateRecoveryKey()
    const chars = key.replace(/-/g, '')
    expect(chars).toMatch(/^[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]+$/)
  })
})
```

- [ ] **Step 2.3:** Add B2 — `createBackup()` structure tests (uses `sharedBackup`):

```ts
describe('createBackup — structure', () => {
  test('version field is 1', () => {
    expect(sharedBackup.v).toBe(1)
  })

  test('has both PIN and recovery blocks', () => {
    expect(sharedBackup.d).toBeDefined()
    expect(sharedBackup.r).toBeDefined()
  })

  test('PIN block has required hex fields', () => {
    expect(sharedBackup.d.s).toMatch(/^[0-9a-f]+$/)
    expect(sharedBackup.d.n).toMatch(/^[0-9a-f]+$/)
    expect(sharedBackup.d.c).toMatch(/^[0-9a-f]+$/)
  })

  test('recovery block has required hex fields', () => {
    expect(sharedBackup.r!.s).toMatch(/^[0-9a-f]+$/)
    expect(sharedBackup.r!.n).toMatch(/^[0-9a-f]+$/)
    expect(sharedBackup.r!.c).toMatch(/^[0-9a-f]+$/)
  })

  test('PIN iterations is 600000', () => {
    expect(sharedBackup.d.i).toBe(600_000)
  })

  test('recovery iterations is 100000', () => {
    expect(sharedBackup.r!.i).toBe(100_000)
  })

  test('id is 6 hex chars', () => {
    expect(sharedBackup.id).toMatch(/^[0-9a-f]{6}$/)
  })

  test('timestamp is rounded to hour', () => {
    expect(sharedBackup.t % 3600).toBe(0)
  })

  test('two backups produce different salts', async () => {
    const backup2 = await createBackup(testNsec, testPin, testPubkey, testRecoveryKey)
    expect(backup2.d.s).not.toBe(sharedBackup.d.s)
  }, 15_000)
})
```

- [ ] **Step 2.4:** Add B3 — PIN restore roundtrip tests:

```ts
describe('restoreFromBackupWithPin — roundtrip', () => {
  test('correct PIN returns original nsec', async () => {
    const result = await restoreFromBackupWithPin(sharedBackup, testPin)
    expect(result).toBe(testNsec)
  }, 10_000)

  test('wrong PIN returns null', async () => {
    const result = await restoreFromBackupWithPin(sharedBackup, '999999')
    expect(result).toBeNull()
  }, 10_000)

  test('corrupted ciphertext returns null', async () => {
    const corrupted = structuredClone(sharedBackup)
    // Flip last hex char
    const c = corrupted.d.c
    const lastChar = c[c.length - 1]
    corrupted.d.c = c.slice(0, -1) + (lastChar === 'f' ? '0' : 'f')
    const result = await restoreFromBackupWithPin(corrupted, testPin)
    expect(result).toBeNull()
  }, 10_000)
})
```

- [ ] **Step 2.5:** Add B4 — recovery key restore roundtrip tests:

```ts
describe('restoreFromBackupWithRecoveryKey — roundtrip', () => {
  test('correct recovery key returns original nsec', async () => {
    const result = await restoreFromBackupWithRecoveryKey(sharedBackup, testRecoveryKey)
    expect(result).toBe(testNsec)
  }, 10_000)

  test('wrong recovery key returns null', async () => {
    const wrongKey = generateRecoveryKey()
    const result = await restoreFromBackupWithRecoveryKey(sharedBackup, wrongKey)
    expect(result).toBeNull()
  }, 10_000)

  test('missing r block returns null immediately', async () => {
    const noRecovery = { ...sharedBackup, r: undefined }
    const result = await restoreFromBackupWithRecoveryKey(noRecovery, testRecoveryKey)
    expect(result).toBeNull()
  })

  test('dashes are stripped — key with and without dashes both work', async () => {
    const noDashes = testRecoveryKey.replace(/-/g, '')
    const result = await restoreFromBackupWithRecoveryKey(sharedBackup, noDashes)
    expect(result).toBe(testNsec)
  }, 10_000)

  test('case insensitive — lowercase key decrypts', async () => {
    const lower = testRecoveryKey.toLowerCase()
    const result = await restoreFromBackupWithRecoveryKey(sharedBackup, lower)
    expect(result).toBe(testNsec)
  }, 10_000)
})
```

- [ ] **Step 2.6:** Add B6 — `readBackupFile()` parsing tests. Bun supports `File` constructor natively:

```ts
describe('readBackupFile — parsing', () => {
  test('valid backup JSON returns BackupFile', async () => {
    const content = JSON.stringify(sharedBackup)
    const file = new File([content], 'backup.json', { type: 'application/json' })
    const result = await readBackupFile(file)
    expect(result).not.toBeNull()
    expect(result!.v).toBe(1)
  })

  test('missing v field returns null', async () => {
    const data = { ...sharedBackup } as Record<string, unknown>
    delete data.v
    const file = new File([JSON.stringify(data)], 'backup.json')
    expect(await readBackupFile(file)).toBeNull()
  })

  test('missing d field returns null', async () => {
    const data = { ...sharedBackup } as Record<string, unknown>
    delete data.d
    const file = new File([JSON.stringify(data)], 'backup.json')
    expect(await readBackupFile(file)).toBeNull()
  })

  test('d.s is not a string returns null', async () => {
    const data = structuredClone(sharedBackup) as Record<string, unknown>
    ;(data.d as Record<string, unknown>).s = 12345
    const file = new File([JSON.stringify(data)], 'backup.json')
    expect(await readBackupFile(file)).toBeNull()
  })

  test('malformed JSON returns null', async () => {
    const file = new File(['not json {{{'], 'backup.json')
    expect(await readBackupFile(file)).toBeNull()
  })

  test('unknown format returns null', async () => {
    const file = new File([JSON.stringify({ v: 99, something: 'else' })], 'backup.json')
    expect(await readBackupFile(file)).toBeNull()
  })
})
```

- [ ] **Step 2.7:** Run `bun test src/client/lib/backup.test.ts` and fix any issues. Total wall time should stay under 15s.

---

## Task 3: Create `provisioning.test.ts` (~25 tests)

**File to create:** `src/client/lib/provisioning.test.ts`

Focus on pure crypto functions. No mocking needed for ECDH, SAS, encrypt/decrypt, QR, and short code tests — they use real `@noble/curves` keypairs. Skip `createProvisioningRoom`, `pollProvisioningRoom`, `getProvisioningRoom`, `sendProvisionedKey` as they are thin fetch wrappers (spec non-goals).

- [ ] **Step 3.1:** Create the test file:

```ts
import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { nip19 } from 'nostr-tools'
import {
  computeProvisioningSAS,
  computeSASForNewDevice,
  computeSASForPrimaryDevice,
  decodeProvisioningQR,
  decryptProvisionedNsec,
  encodeProvisioningQR,
  encryptNsecForDevice,
  getShortCode,
} from './provisioning'
```

- [ ] **Step 3.2:** Add C1 — `computeProvisioningSAS()` tests:

```ts
describe('computeProvisioningSAS', () => {
  test('deterministic — same input produces same SAS', () => {
    const sharedX = new Uint8Array(32)
    sharedX[0] = 0x42
    expect(computeProvisioningSAS(sharedX)).toBe(computeProvisioningSAS(sharedX))
  })

  test('format matches XXX XXX', () => {
    const sharedX = new Uint8Array(32)
    crypto.getRandomValues(sharedX)
    expect(computeProvisioningSAS(sharedX)).toMatch(/^\d{3} \d{3}$/)
  })

  test('one-bit flip in input changes SAS', () => {
    const a = new Uint8Array(32)
    a[0] = 0x42
    const b = new Uint8Array(a)
    b[0] = 0x43 // flip one bit
    expect(computeProvisioningSAS(a)).not.toBe(computeProvisioningSAS(b))
  })

  test('numeric value in [0, 999999]', () => {
    const sharedX = new Uint8Array(32)
    crypto.getRandomValues(sharedX)
    const sas = computeProvisioningSAS(sharedX)
    const num = Number.parseInt(sas.replace(' ', ''), 10)
    expect(num).toBeGreaterThanOrEqual(0)
    expect(num).toBeLessThanOrEqual(999999)
  })

  test('zero-padded short codes', () => {
    // Just verify format is always 7 chars (3 digits + space + 3 digits)
    for (let i = 0; i < 10; i++) {
      const sharedX = new Uint8Array(32)
      crypto.getRandomValues(sharedX)
      const sas = computeProvisioningSAS(sharedX)
      expect(sas.length).toBe(7)
    }
  })
})
```

- [ ] **Step 3.3:** Add C2 — ECDH SAS symmetry tests (critical MITM prevention):

```ts
describe('computeSASForNewDevice / computeSASForPrimaryDevice — ECDH symmetry', () => {
  test('both sides produce identical SAS', () => {
    const ephemeralSK = secp256k1.utils.randomPrivateKey()
    const ephemeralPub = bytesToHex(secp256k1.getPublicKey(ephemeralSK, true))
    const primarySK = secp256k1.utils.randomPrivateKey()
    const primaryPub = bytesToHex(secp256k1.getPublicKey(primarySK, true))

    const sasNew = computeSASForNewDevice(ephemeralSK, primaryPub)
    const sasPrimary = computeSASForPrimaryDevice(primarySK, ephemeralPub)
    expect(sasNew).toBe(sasPrimary)
  })

  test('x-only pubkey (64 hex chars) produces same SAS as compressed (66 hex chars)', () => {
    const ephemeralSK = secp256k1.utils.randomPrivateKey()
    const primarySK = secp256k1.utils.randomPrivateKey()
    const primaryPubCompressed = bytesToHex(secp256k1.getPublicKey(primarySK, true)) // 66 chars
    const primaryPubXOnly = primaryPubCompressed.slice(2) // 64 chars (strip 02 prefix)

    const sasCompressed = computeSASForNewDevice(ephemeralSK, primaryPubCompressed)
    const sasXOnly = computeSASForNewDevice(ephemeralSK, primaryPubXOnly)
    expect(sasCompressed).toBe(sasXOnly)
  })

  test('different keypairs produce different SAS (no false positives)', () => {
    const sk1 = secp256k1.utils.randomPrivateKey()
    const pub1 = bytesToHex(secp256k1.getPublicKey(sk1, true))
    const sk2 = secp256k1.utils.randomPrivateKey()
    const pub2 = bytesToHex(secp256k1.getPublicKey(sk2, true))
    const sk3 = secp256k1.utils.randomPrivateKey()
    const pub3 = bytesToHex(secp256k1.getPublicKey(sk3, true))

    const sas1 = computeSASForNewDevice(sk1, pub2)
    const sas2 = computeSASForNewDevice(sk1, pub3)
    // Extremely unlikely to collide with random keys
    expect(sas1).not.toBe(sas2)
  })
})
```

- [ ] **Step 3.4:** Add C3 — encrypt/decrypt nsec roundtrip tests:

```ts
describe('encryptNsecForDevice / decryptProvisionedNsec — roundtrip', () => {
  test('roundtrip: encrypt with primary SK → decrypt with ephemeral SK = original nsec', () => {
    const primarySK = secp256k1.utils.randomPrivateKey()
    const primaryPubCompressed = bytesToHex(secp256k1.getPublicKey(primarySK, true))
    const primaryPubXOnly = primaryPubCompressed.slice(2) // x-only for decryptProvisionedNsec

    const ephemeralSK = secp256k1.utils.randomPrivateKey()
    const ephemeralPub = bytesToHex(secp256k1.getPublicKey(ephemeralSK, true))

    const testSK = secp256k1.utils.randomPrivateKey()
    const nsec = nip19.nsecEncode(testSK)

    const encrypted = encryptNsecForDevice(nsec, ephemeralPub, primarySK)
    const decrypted = decryptProvisionedNsec(encrypted, primaryPubXOnly, ephemeralSK)
    expect(decrypted).toBe(nsec)
  })

  test('wrong secret key throws or returns garbage', () => {
    const primarySK = secp256k1.utils.randomPrivateKey()
    const ephemeralSK = secp256k1.utils.randomPrivateKey()
    const ephemeralPub = bytesToHex(secp256k1.getPublicKey(ephemeralSK, true))
    const wrongSK = secp256k1.utils.randomPrivateKey()
    const primaryPubXOnly = bytesToHex(secp256k1.getPublicKey(primarySK, true)).slice(2)

    const testSK = secp256k1.utils.randomPrivateKey()
    const nsec = nip19.nsecEncode(testSK)

    const encrypted = encryptNsecForDevice(nsec, ephemeralPub, primarySK)
    expect(() => decryptProvisionedNsec(encrypted, primaryPubXOnly, wrongSK)).toThrow()
  })

  test('encrypted hex is at least 48 chars (24 bytes nonce + ciphertext)', () => {
    const primarySK = secp256k1.utils.randomPrivateKey()
    const ephemeralSK = secp256k1.utils.randomPrivateKey()
    const ephemeralPub = bytesToHex(secp256k1.getPublicKey(ephemeralSK, true))

    const testSK = secp256k1.utils.randomPrivateKey()
    const nsec = nip19.nsecEncode(testSK)

    const encrypted = encryptNsecForDevice(nsec, ephemeralPub, primarySK)
    expect(encrypted.length).toBeGreaterThanOrEqual(48)
  })

  test('two encryptions produce different hex (random nonce)', () => {
    const primarySK = secp256k1.utils.randomPrivateKey()
    const ephemeralSK = secp256k1.utils.randomPrivateKey()
    const ephemeralPub = bytesToHex(secp256k1.getPublicKey(ephemeralSK, true))

    const testSK = secp256k1.utils.randomPrivateKey()
    const nsec = nip19.nsecEncode(testSK)

    const e1 = encryptNsecForDevice(nsec, ephemeralPub, primarySK)
    const e2 = encryptNsecForDevice(nsec, ephemeralPub, primarySK)
    expect(e1).not.toBe(e2)
  })
})
```

- [ ] **Step 3.5:** Add C4 — QR encode/decode tests:

```ts
describe('encodeProvisioningQR / decodeProvisioningQR', () => {
  test('roundtrip', () => {
    const encoded = encodeProvisioningQR('room-123', 'token-abc')
    const decoded = decodeProvisioningQR(encoded)
    expect(decoded).toEqual({ r: 'room-123', t: 'token-abc' })
  })

  test('invalid JSON returns null', () => {
    expect(decodeProvisioningQR('not json')).toBeNull()
  })

  test('missing r field returns null', () => {
    expect(decodeProvisioningQR('{"t":"abc"}')).toBeNull()
  })

  test('missing t field returns null', () => {
    expect(decodeProvisioningQR('{"r":"abc"}')).toBeNull()
  })

  test('extra fields do not cause null return', () => {
    const result = decodeProvisioningQR('{"r":"abc","t":"def","extra":"val"}')
    expect(result).not.toBeNull()
    expect(result!.r).toBe('abc')
    expect(result!.t).toBe('def')
  })
})
```

- [ ] **Step 3.6:** Add C5 — `getShortCode()` tests:

```ts
describe('getShortCode', () => {
  test('takes first 8 chars', () => {
    expect(getShortCode('abcd1234xyz')).toBe('ABCD1234')
  })

  test('output is uppercase', () => {
    const code = getShortCode('abcdefgh')
    expect(code).toBe(code.toUpperCase())
  })

  test('short roomId does not crash', () => {
    expect(getShortCode('abc')).toBe('ABC')
  })
})
```

- [ ] **Step 3.7:** Run `bun test src/client/lib/provisioning.test.ts` and fix any issues.

---

## Task 4: Create `panic-wipe.test.ts` (~22 tests)

**File to create:** `src/client/lib/panic-wipe.test.ts`

**DOM constraint:** No happy-dom or jsdom is installed in this project. `panic-wipe.ts` requires `document.addEventListener`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator.serviceWorker`, and `window.location`. All must be manually mocked on `globalThis` before importing the module.

**Singleton state:** `panic-wipe.ts` has module-level `escapeTimes` and `panicWipeCallback`. Call `initPanicWipe()` at the start of each test to reset state, and call the returned cleanup in `afterEach`.

**Mock strategy for key-manager:** Use `mock.module('./key-manager', ...)` to replace `wipeKey` with a spy.

- [ ] **Step 4.1:** Create the test file with DOM mocks and key-manager mock:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// --- Mock key-manager before importing panic-wipe ---
const mockWipeKey = mock(() => {})
mock.module('./key-manager', () => ({
  wipeKey: mockWipeKey,
  lock: mock(() => {}),
  isUnlocked: mock(() => false),
  getSecretKey: mock(() => { throw new Error('locked') }),
  getPublicKeyHex: mock(() => null),
  unlock: mock(() => Promise.resolve(null)),
  importKey: mock(() => Promise.resolve('')),
  createAuthToken: mock(() => ''),
  onLock: mock(() => () => {}),
  onUnlock: mock(() => () => {}),
  disableAutoLock: mock(() => {}),
  getNsec: mock(() => null),
  isValidPin: mock(() => true),
  hasStoredKey: mock(() => false),
  setLockDelay: mock(() => {}),
  getLockDelayMs: mock(() => 30000),
  KeyLockedError: class extends Error { constructor() { super('locked'); this.name = 'KeyLockedError' } },
}))

// --- DOM mocks ---
const localStorageMock = { clear: mock(() => {}) }
const sessionStorageMock = { clear: mock(() => {}) }
const mockDeleteDatabase = mock(() => ({ result: undefined }))
const mockDatabases = mock(() => Promise.resolve([{ name: 'llamenos-db' }]))
const mockUnregister = mock(() => Promise.resolve(true))
const mockGetRegistrations = mock(() => Promise.resolve([{ unregister: mockUnregister }]))

let locationHref = '/'
const keydownListeners: ((e: KeyboardEvent) => void)[] = []

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true, configurable: true })
Object.defineProperty(globalThis, 'indexedDB', {
  value: { databases: mockDatabases, deleteDatabase: mockDeleteDatabase },
  writable: true, configurable: true,
})
Object.defineProperty(globalThis, 'navigator', {
  value: { serviceWorker: { getRegistrations: mockGetRegistrations } },
  writable: true, configurable: true,
})

// Mock document for addEventListener/removeEventListener
const docListeners = new Map<string, Set<EventListener>>()
Object.defineProperty(globalThis, 'document', {
  value: {
    addEventListener: (type: string, handler: EventListener) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set())
      docListeners.get(type)!.add(handler)
    },
    removeEventListener: (type: string, handler: EventListener) => {
      docListeners.get(type)?.delete(handler)
    },
  },
  writable: true, configurable: true,
})

// Mock window.location
Object.defineProperty(globalThis, 'window', {
  value: {
    location: {
      get href() { return locationHref },
      set href(v: string) { locationHref = v },
    },
  },
  writable: true, configurable: true,
})

// Import AFTER all mocks are set up
import { initPanicWipe, performPanicWipe } from './panic-wipe'

function dispatchEscape() {
  const event = new KeyboardEvent('keydown', { key: 'Escape' })
  const handlers = docListeners.get('keydown')
  if (handlers) {
    for (const handler of handlers) handler(event)
  }
}

function dispatchKey(key: string) {
  const event = new KeyboardEvent('keydown', { key })
  const handlers = docListeners.get('keydown')
  if (handlers) {
    for (const handler of handlers) handler(event)
  }
}

let cleanup: (() => void) | null = null

beforeEach(() => {
  mockWipeKey.mockReset()
  localStorageMock.clear.mockReset()
  sessionStorageMock.clear.mockReset()
  mockDeleteDatabase.mockReset()
  mockDatabases.mockReset()
  mockDatabases.mockImplementation(() => Promise.resolve([{ name: 'llamenos-db' }]))
  mockGetRegistrations.mockReset()
  mockGetRegistrations.mockImplementation(() => Promise.resolve([{ unregister: mockUnregister }]))
  mockUnregister.mockReset()
  locationHref = '/'
})

afterEach(() => {
  cleanup?.()
  cleanup = null
})
```

- [ ] **Step 4.2:** Add D1 — `performPanicWipe()` tests:

```ts
describe('performPanicWipe', () => {
  test('calls wipeKey', () => {
    performPanicWipe()
    expect(mockWipeKey).toHaveBeenCalledTimes(1)
  })

  test('fires onWipe callback', () => {
    const cb = mock(() => {})
    cleanup = initPanicWipe(cb)
    performPanicWipe()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('clears localStorage after setTimeout fires', async () => {
    performPanicWipe()
    // setTimeout with 200ms — wait for it
    await new Promise((r) => setTimeout(r, 300))
    expect(localStorageMock.clear).toHaveBeenCalled()
  })

  test('clears sessionStorage after setTimeout fires', async () => {
    performPanicWipe()
    await new Promise((r) => setTimeout(r, 300))
    expect(sessionStorageMock.clear).toHaveBeenCalled()
  })

  test('redirects to /login after timer', async () => {
    performPanicWipe()
    await new Promise((r) => setTimeout(r, 300))
    expect(locationHref).toBe('/login')
  })

  test('storage not cleared before 200ms', async () => {
    performPanicWipe()
    // Check immediately — should not have fired yet
    expect(localStorageMock.clear).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 300))
    expect(localStorageMock.clear).toHaveBeenCalled()
  })

  test('wipeKey throwing does not prevent wipe', () => {
    mockWipeKey.mockImplementation(() => { throw new Error('already wiped') })
    expect(() => performPanicWipe()).not.toThrow()
  })

  test('localStorage.clear throwing does not prevent sessionStorage clear', async () => {
    localStorageMock.clear.mockImplementation(() => { throw new Error('access denied') })
    performPanicWipe()
    await new Promise((r) => setTimeout(r, 300))
    expect(sessionStorageMock.clear).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4.3:** Add D2 — `initPanicWipe()` tests:

```ts
describe('initPanicWipe', () => {
  test('returns cleanup function', () => {
    cleanup = initPanicWipe()
    expect(typeof cleanup).toBe('function')
  })

  test('cleanup removes keydown listener', () => {
    cleanup = initPanicWipe()
    cleanup()
    // After cleanup, triple-Escape should not trigger wipe
    dispatchEscape()
    dispatchEscape()
    dispatchEscape()
    expect(mockWipeKey).not.toHaveBeenCalled()
    cleanup = null
  })

  test('no callback variant does not crash on wipe', () => {
    cleanup = initPanicWipe()
    expect(() => performPanicWipe()).not.toThrow()
  })
})
```

- [ ] **Step 4.4:** Add D3 — triple-Escape detection tests:

```ts
describe('triple-Escape detection', () => {
  test('3 Escapes within 1s triggers wipe', () => {
    cleanup = initPanicWipe()
    dispatchEscape()
    dispatchEscape()
    dispatchEscape()
    expect(mockWipeKey).toHaveBeenCalledTimes(1)
  })

  test('2 Escapes does not trigger', () => {
    cleanup = initPanicWipe()
    dispatchEscape()
    dispatchEscape()
    expect(mockWipeKey).not.toHaveBeenCalled()
  })

  test('non-Escape key resets counter', () => {
    cleanup = initPanicWipe()
    dispatchEscape()
    dispatchEscape()
    dispatchKey('a')
    dispatchEscape()
    // Only 1 Escape in the current sequence
    expect(mockWipeKey).not.toHaveBeenCalled()
  })

  test('counter resets after trigger — can fire again', () => {
    cleanup = initPanicWipe()
    dispatchEscape()
    dispatchEscape()
    dispatchEscape()
    expect(mockWipeKey).toHaveBeenCalledTimes(1)
    mockWipeKey.mockClear()
    dispatchEscape()
    dispatchEscape()
    dispatchEscape()
    expect(mockWipeKey).toHaveBeenCalledTimes(1)
  })
})
```

**Note on timing-boundary tests (D3 "3 Escapes spread > 1s"):** Testing the exact 1000ms window boundary requires either fake timers or real `Date.now()` manipulation. Since `panic-wipe.ts` uses `Date.now()` directly, and these tests already exercise the core detection logic, the timing-boundary tests are deferred unless `mock.module` can intercept `Date.now` or `mock.timers` with Date support works reliably. The functional correctness (3 presses triggers, 2 doesn't, non-Escape resets) is proven by the tests above.

- [ ] **Step 4.5:** Add D4 — callback lifecycle tests:

```ts
describe('callback lifecycle', () => {
  test('callback called before storage clear (synchronous)', () => {
    const callOrder: string[] = []
    localStorageMock.clear.mockImplementation(() => { callOrder.push('storage') })
    const onWipe = mock(() => { callOrder.push('callback') })
    cleanup = initPanicWipe(onWipe)
    performPanicWipe()
    // callback should be first (synchronous), storage is deferred
    expect(callOrder[0]).toBe('callback')
  })

  test('callback replaced on re-init', () => {
    const cb1 = mock(() => {})
    const cb2 = mock(() => {})
    const cleanup1 = initPanicWipe(cb1)
    cleanup = initPanicWipe(cb2)
    performPanicWipe()
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
    cleanup1() // clean up first listener
  })
})
```

- [ ] **Step 4.6:** Run `bun test src/client/lib/panic-wipe.test.ts` and fix any issues. The main risk is DOM mock completeness — if `KeyboardEvent` constructor is not available in Bun, use a plain object with `{ key: 'Escape' }` instead.

---

## Task 5: Full Suite Verification

- [ ] **Step 5.1:** Run all four new test files together:

```bash
bun test src/client/lib/key-manager.test.ts src/client/lib/backup.test.ts src/client/lib/provisioning.test.ts src/client/lib/panic-wipe.test.ts
```

Fix any cross-file issues (mock leakage, module state pollution).

- [ ] **Step 5.2:** Run the full unit test suite to ensure no regressions:

```bash
bun run test:unit
```

- [ ] **Step 5.3:** Run typecheck and build:

```bash
bun run typecheck && bun run build
```

- [ ] **Step 5.4:** Verify test count. Expected: ~120 new tests across 4 files, bringing the total unit test count to approximately 310-320.

- [ ] **Step 5.5:** Commit all new test files.

---

## Summary

| Task | File | Tests | Key Challenges |
|------|------|-------|----------------|
| 1 | `key-manager.test.ts` | ~38 | Singleton state reset, mock.module for key-store, localStorage mock for setLockDelay |
| 2 | `backup.test.ts` | ~22 | PBKDF2 speed (shared fixture in beforeAll), File constructor for readBackupFile |
| 3 | `provisioning.test.ts` | ~20 | Real secp256k1 keypairs, ECDH symmetry proof, x-only vs compressed pubkey |
| 4 | `panic-wipe.test.ts` | ~20 | Full DOM mock on globalThis, mock.module for key-manager, synthetic KeyboardEvent dispatch |
| 5 | (verification) | — | Cross-file mock isolation, full suite regression check |
| **Total** | 4 new files | **~100** | |

**Deferred items:**
- Auto-lock timer tests (A9): Deferred unless `mock.timers.enable(['setTimeout'])` + `mock.timers.tick()` is verified working in Bun
- Timing-boundary tests for triple-Escape (exact 1000ms edge): Requires `Date.now` mocking
- `downloadBackupFile`: Requires Blob/anchor DOM — belongs in E2E
- Fetch-dependent provisioning functions: Covered by API integration tests
