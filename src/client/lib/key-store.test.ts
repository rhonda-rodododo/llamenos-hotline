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
import type { EncryptedKeyData } from './key-store'

// Mock localStorage for Bun (no browser)
const store = new Map<string, string>()
globalThis.localStorage = {
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

beforeEach(() => store.clear())

// ---------------------------------------------------------------------------
// isValidPin
// ---------------------------------------------------------------------------

describe('isValidPin', () => {
  test('accepts 6 digits', () => {
    expect(isValidPin('123456')).toBe(true)
  })

  test('accepts 7 digits', () => {
    expect(isValidPin('1234567')).toBe(true)
  })

  test('accepts 8 digits', () => {
    expect(isValidPin('12345678')).toBe(true)
  })

  test('rejects 5 digits', () => {
    expect(isValidPin('12345')).toBe(false)
  })

  test('rejects 9 digits', () => {
    expect(isValidPin('123456789')).toBe(false)
  })

  test('rejects letters', () => {
    expect(isValidPin('abcdef')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidPin('')).toBe(false)
  })

  test('rejects mixed alphanumeric', () => {
    expect(isValidPin('123abc')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// storeEncryptedKey / decryptStoredKey
// ---------------------------------------------------------------------------

describe('storeEncryptedKey / decryptStoredKey', () => {
  test('correct PIN roundtrip: store nsec with PIN, decrypt with same PIN returns original nsec', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, '654321', kp.publicKey)
    const decrypted = await decryptStoredKey('654321')

    expect(decrypted).toBe(kp.nsec)
  }, 30_000)

  test('wrong PIN returns null', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, '111111', kp.publicKey)
    const decrypted = await decryptStoredKey('999999')

    expect(decrypted).toBeNull()
  }, 30_000)

  test('stored format: salt is 32 hex chars (16 bytes), nonce is 48 hex chars (24 bytes), ciphertext is hex, iterations=600000, pubkey is 16 hex chars', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, '123456', kp.publicKey)

    const raw = store.get('llamenos-encrypted-key')
    expect(raw).toBeDefined()

    const data: EncryptedKeyData = JSON.parse(raw as string)

    // salt: 16 bytes → 32 hex chars
    expect(data.salt).toMatch(/^[0-9a-f]{32}$/)

    // nonce: 24 bytes → 48 hex chars
    expect(data.nonce).toMatch(/^[0-9a-f]{48}$/)

    // ciphertext: non-empty hex string
    expect(data.ciphertext).toMatch(/^[0-9a-f]+$/)

    // iterations: exactly 600000
    expect(data.iterations).toBe(600_000)

    // pubkey: truncated SHA-256 hash — 16 hex chars
    expect(data.pubkey).toMatch(/^[0-9a-f]{16}$/)
  }, 30_000)

  test('decryptStoredKey returns null when no key stored', async () => {
    const result = await decryptStoredKey('123456')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// reEncryptKey
// ---------------------------------------------------------------------------

describe('reEncryptKey', () => {
  test('PIN change: decrypt with old PIN fails, decrypt with new PIN succeeds', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    await storeEncryptedKey(kp.nsec, 'pinAAAA', kp.publicKey)

    // Re-encrypt with new PIN
    await reEncryptKey(kp.nsec, 'pinBBBB', kp.publicKey)

    const withOldPin = await decryptStoredKey('pinAAAA')
    expect(withOldPin).toBeNull()

    const withNewPin = await decryptStoredKey('pinBBBB')
    expect(withNewPin).toBe(kp.nsec)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// hasStoredKey / getStoredKeyId / clearStoredKey
// ---------------------------------------------------------------------------

describe('hasStoredKey / getStoredKeyId / clearStoredKey', () => {
  test('full lifecycle: not stored → store → has=true → getId returns 16 hex → clear → has=false → getId=null', async () => {
    const { generateKeyPair } = await import('./crypto')
    const kp = generateKeyPair()

    // Initially no key stored
    expect(hasStoredKey()).toBe(false)
    expect(getStoredKeyId()).toBeNull()

    // Store key
    await storeEncryptedKey(kp.nsec, '777777', kp.publicKey)

    // Key exists
    expect(hasStoredKey()).toBe(true)

    // ID is a 16-hex-char truncated pubkey hash
    const id = getStoredKeyId()
    expect(id).toMatch(/^[0-9a-f]{16}$/)

    // Clear
    clearStoredKey()

    expect(hasStoredKey()).toBe(false)
    expect(getStoredKeyId()).toBeNull()
  }, 30_000)
})
