import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { generateSecretKey, nip19, getPublicKey as nostrGetPublicKey } from 'nostr-tools'

// --- Mock key-store before importing key-manager ---
const mockDecryptStoredKey = mock(() => Promise.resolve(null as string | null))
const mockStoreEncryptedKey = mock((_nsec: string, _pin: string, _pk: string) => Promise.resolve())
const mockClearStoredKey = mock(() => {})
const mockHasStoredKey = mock(() => false)

const realKeyStore = await import('./key-store')
mock.module('./key-store', () => ({
  ...realKeyStore,
  decryptStoredKey: mockDecryptStoredKey,
  storeEncryptedKey: mockStoreEncryptedKey,
  clearStoredKey: mockClearStoredKey,
  hasStoredKey: mockHasStoredKey,
}))

// Import AFTER mocking
const {
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
} = await import('./key-manager')

// --- Test fixtures ---
const testSecretKey = generateSecretKey()
const testNsec = nip19.nsecEncode(testSecretKey)
const testPubkeyHex = nostrGetPublicKey(testSecretKey)

// --- localStorage mock for setLockDelay/getLockDelayMs ---
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  },
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
} as Storage

// Install localStorage mock globally
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
})

beforeEach(() => {
  lock()
  store.clear()
  mockDecryptStoredKey.mockReset()
  mockStoreEncryptedKey.mockReset()
  mockClearStoredKey.mockReset()
  mockHasStoredKey.mockReset()
  // Default: decryptStoredKey returns null (wrong PIN)
  mockDecryptStoredKey.mockImplementation(() => Promise.resolve(null))
})

// ─── isValidPin ──────────────────────────────────────────────────────────────

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

// ─── unlock ──────────────────────────────────────────────────────────────────

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
    // lock() is called in beforeEach which fires callbacks, but we registered
    // after that, so only direct lock() calls after this point would fire cb
    expect(cb).not.toHaveBeenCalled()
  })
})

// ─── lock — key zeroing ─────────────────────────────────────────────────────

describe('lock', () => {
  test('zeros key bytes in place', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    const keyRef = getSecretKey()
    // Verify key is non-zero before lock
    expect(keyRef.some((b) => b !== 0)).toBe(true)
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

// ─── importKey ───────────────────────────────────────────────────────────────

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

// ─── getSecretKey ────────────────────────────────────────────────────────────

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

// ─── createAuthToken ─────────────────────────────────────────────────────────

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

// ─── onLock / onUnlock callback management ───────────────────────────────────

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

// ─── wipeKey ─────────────────────────────────────────────────────────────────

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

// ─── setLockDelay / getLockDelayMs ───────────────────────────────────────────

describe('setLockDelay / getLockDelayMs', () => {
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

// ─── getNsec ─────────────────────────────────────────────────────────────────

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

// ─── KeyLockedError ──────────────────────────────────────────────────────────

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

// ─── disableAutoLock ─────────────────────────────────────────────────────────

describe('disableAutoLock', () => {
  test('does not throw when called while locked', () => {
    expect(() => disableAutoLock()).not.toThrow()
  })

  test('does not throw when called while unlocked', async () => {
    mockDecryptStoredKey.mockImplementation(() => Promise.resolve(testNsec))
    await unlock('123456')
    expect(() => disableAutoLock()).not.toThrow()
  })
})
