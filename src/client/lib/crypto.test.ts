import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  createAuthToken,
  eciesUnwrapKey,
  eciesWrapKey,
  generateKeyPair,
  isValidNsec,
  keyPairFromNsec,
} from './crypto'

describe('generateKeyPair', () => {
  test('secretKey is 32 bytes (Uint8Array)', () => {
    const kp = generateKeyPair()
    expect(kp.secretKey).toBeInstanceOf(Uint8Array)
    expect(kp.secretKey.length).toBe(32)
  })

  test('publicKey is 64 hex chars (x-only)', () => {
    const kp = generateKeyPair()
    expect(typeof kp.publicKey).toBe('string')
    expect(kp.publicKey.length).toBe(64)
    expect(/^[0-9a-f]{64}$/.test(kp.publicKey)).toBe(true)
  })

  test('nsec starts with "nsec1", npub starts with "npub1"', () => {
    const kp = generateKeyPair()
    expect(kp.nsec.startsWith('nsec1')).toBe(true)
    expect(kp.npub.startsWith('npub1')).toBe(true)
  })

  test('each call produces different keys', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    expect(kp1.publicKey).not.toBe(kp2.publicKey)
    expect(bytesToHex(kp1.secretKey)).not.toBe(bytesToHex(kp2.secretKey))
    expect(kp1.nsec).not.toBe(kp2.nsec)
  })
})

describe('keyPairFromNsec / isValidNsec', () => {
  test('roundtrip: generateKeyPair → nsec → keyPairFromNsec recovers same pubkey and secretKey', () => {
    const original = generateKeyPair()
    const recovered = keyPairFromNsec(original.nsec)
    expect(recovered).not.toBeNull()
    expect(recovered!.publicKey).toBe(original.publicKey)
    expect(bytesToHex(recovered!.secretKey)).toBe(bytesToHex(original.secretKey))
    expect(recovered!.nsec).toBe(original.nsec)
  })

  test('invalid nsec returns null for garbage input', () => {
    expect(keyPairFromNsec('notvalid')).toBeNull()
  })

  test('invalid nsec returns null for empty string', () => {
    expect(keyPairFromNsec('')).toBeNull()
  })

  test('invalid nsec returns null for npub (wrong type)', () => {
    const kp = generateKeyPair()
    expect(keyPairFromNsec(kp.npub)).toBeNull()
  })

  test('isValidNsec: true for valid nsec', () => {
    const kp = generateKeyPair()
    expect(isValidNsec(kp.nsec)).toBe(true)
  })

  test('isValidNsec: false for garbage', () => {
    expect(isValidNsec('garbage')).toBe(false)
  })

  test('isValidNsec: false for empty string', () => {
    expect(isValidNsec('')).toBe(false)
  })

  test('isValidNsec: false for npub', () => {
    const kp = generateKeyPair()
    expect(isValidNsec(kp.npub)).toBe(false)
  })
})

describe('eciesWrapKey / eciesUnwrapKey', () => {
  const TEST_LABEL = 'test:ecies-wrap'
  const OTHER_LABEL = 'test:ecies-other'

  function randomKey(): Uint8Array {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    return key
  }

  test('roundtrip: wrap then unwrap with correct secretKey returns original key', () => {
    const kp = generateKeyPair()
    const symmetricKey = randomKey()

    const envelope = eciesWrapKey(symmetricKey, kp.publicKey, TEST_LABEL)
    const unwrapped = eciesUnwrapKey(envelope, kp.secretKey, TEST_LABEL)

    expect(bytesToHex(unwrapped)).toBe(bytesToHex(symmetricKey))
  })

  test('wrong private key throws on unwrap', () => {
    const recipient = generateKeyPair()
    const attacker = generateKeyPair()
    const symmetricKey = randomKey()

    const envelope = eciesWrapKey(symmetricKey, recipient.publicKey, TEST_LABEL)

    expect(() => eciesUnwrapKey(envelope, attacker.secretKey, TEST_LABEL)).toThrow()
  })

  test('nonce uniqueness: two wraps of same key produce different wrappedKey', () => {
    const kp = generateKeyPair()
    const symmetricKey = randomKey()

    const envelope1 = eciesWrapKey(symmetricKey, kp.publicKey, TEST_LABEL)
    const envelope2 = eciesWrapKey(symmetricKey, kp.publicKey, TEST_LABEL)

    expect(envelope1.wrappedKey).not.toBe(envelope2.wrappedKey)
    expect(envelope1.ephemeralPubkey).not.toBe(envelope2.ephemeralPubkey)
  })

  test('domain separation: wrap with label A, unwrap with label B throws', () => {
    const kp = generateKeyPair()
    const symmetricKey = randomKey()

    const envelope = eciesWrapKey(symmetricKey, kp.publicKey, TEST_LABEL)

    expect(() => eciesUnwrapKey(envelope, kp.secretKey, OTHER_LABEL)).toThrow()
  })

  test('ephemeral pubkey is 66 hex chars (33 bytes compressed)', () => {
    const kp = generateKeyPair()
    const symmetricKey = randomKey()

    const envelope = eciesWrapKey(symmetricKey, kp.publicKey, TEST_LABEL)

    expect(typeof envelope.ephemeralPubkey).toBe('string')
    expect(envelope.ephemeralPubkey.length).toBe(66)
    expect(/^[0-9a-f]{66}$/.test(envelope.ephemeralPubkey)).toBe(true)
  })
})

describe('createAuthToken', () => {
  test('returns valid JSON with pubkey, timestamp, token fields', () => {
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const tokenJson = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/test')

    const parsed = JSON.parse(tokenJson)
    expect(typeof parsed.pubkey).toBe('string')
    expect(typeof parsed.timestamp).toBe('number')
    expect(typeof parsed.token).toBe('string')
  })

  test('pubkey in output matches input key publicKey', () => {
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const tokenJson = createAuthToken(kp.secretKey, timestamp, 'POST', '/api/notes')

    const parsed = JSON.parse(tokenJson)
    expect(parsed.pubkey).toBe(kp.publicKey)
  })

  test('timestamp in output matches the provided timestamp', () => {
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const tokenJson = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/calls')

    const parsed = JSON.parse(tokenJson)
    expect(parsed.timestamp).toBe(timestamp)
  })

  test('cross-validate: server verifyAuthToken accepts the token', async () => {
    const { verifyAuthToken } = await import('../../server/lib/auth')

    const kp = generateKeyPair()
    const method = 'GET'
    const path = '/api/volunteers'
    const timestamp = Date.now()
    const tokenJson = createAuthToken(kp.secretKey, timestamp, method, path)

    const auth = JSON.parse(tokenJson)
    const isValid = await verifyAuthToken(auth, method, path)
    expect(isValid).toBe(true)
  })

  test('cross-validate: server rejects token with wrong method', async () => {
    const { verifyAuthToken } = await import('../../server/lib/auth')

    const kp = generateKeyPair()
    const timestamp = Date.now()
    const tokenJson = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/volunteers')

    const auth = JSON.parse(tokenJson)
    const isValid = await verifyAuthToken(auth, 'POST', '/api/volunteers')
    expect(isValid).toBe(false)
  })

  test('cross-validate: server rejects token with wrong path', async () => {
    const { verifyAuthToken } = await import('../../server/lib/auth')

    const kp = generateKeyPair()
    const timestamp = Date.now()
    const tokenJson = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/volunteers')

    const auth = JSON.parse(tokenJson)
    const isValid = await verifyAuthToken(auth, 'GET', '/api/notes')
    expect(isValid).toBe(false)
  })
})
