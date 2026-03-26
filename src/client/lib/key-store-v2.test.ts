import { describe, expect, test } from 'bun:test'
import { decryptNsec, deriveKEK, encryptNsec, isValidPin } from './key-store-v2'

describe('key-store-v2', () => {
  const pin = '123456'
  const idpValue = new Uint8Array(32).fill(0xaa)
  const prfOutput = new Uint8Array(32).fill(0xbb)
  const salt = new Uint8Array(32).fill(0xcc)

  // ── deriveKEK ─────────────────────────────────────────────────────────────

  test('deriveKEK with 3 factors produces 32-byte key', () => {
    const kek = deriveKEK({ pin, idpValue, prfOutput, salt })
    expect(kek).toBeInstanceOf(Uint8Array)
    expect(kek.length).toBe(32)
  })

  test('deriveKEK with 2 factors produces 32-byte key', () => {
    const kek = deriveKEK({ pin, idpValue, salt })
    expect(kek).toBeInstanceOf(Uint8Array)
    expect(kek.length).toBe(32)
  })

  test('deriveKEK with 3 factors produces different key than 2 factors', () => {
    const kek3 = deriveKEK({ pin, idpValue, prfOutput, salt })
    const kek2 = deriveKEK({ pin, idpValue, salt })
    expect(Buffer.from(kek3).equals(Buffer.from(kek2))).toBe(false)
  })

  test('deriveKEK is deterministic (3-factor)', () => {
    const a = deriveKEK({ pin, idpValue, prfOutput, salt })
    const b = deriveKEK({ pin, idpValue, prfOutput, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test('deriveKEK is deterministic (2-factor)', () => {
    const a = deriveKEK({ pin, idpValue, salt })
    const b = deriveKEK({ pin, idpValue, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test('wrong PIN produces different KEK', () => {
    const a = deriveKEK({ pin: '123456', idpValue, salt })
    const b = deriveKEK({ pin: '654321', idpValue, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  test('different idpValue produces different KEK', () => {
    const idpA = new Uint8Array(32).fill(0xaa)
    const idpB = new Uint8Array(32).fill(0xdd)
    const a = deriveKEK({ pin, idpValue: idpA, salt })
    const b = deriveKEK({ pin, idpValue: idpB, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  test('different salt produces different KEK', () => {
    const saltA = new Uint8Array(32).fill(0xcc)
    const saltB = new Uint8Array(32).fill(0xee)
    const a = deriveKEK({ pin, idpValue, salt: saltA })
    const b = deriveKEK({ pin, idpValue, salt: saltB })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  test('different prfOutput produces different KEK (3-factor)', () => {
    const prfA = new Uint8Array(32).fill(0xbb)
    const prfB = new Uint8Array(32).fill(0x11)
    const a = deriveKEK({ pin, idpValue, prfOutput: prfA, salt })
    const b = deriveKEK({ pin, idpValue, prfOutput: prfB, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  // ── encryptNsec / decryptNsec (round-trip) ─────────────────────────────────

  test('encryptNsec produces a valid v2 blob', () => {
    const kek = deriveKEK({ pin, idpValue, salt })
    const blob = encryptNsec(
      'nsec1testvalue',
      kek,
      'deadbeef'.repeat(8),
      false,
      'https://idp.example.com',
      salt
    )
    expect(blob.version).toBe(2)
    expect(blob.kdf).toBe('pbkdf2-sha256')
    expect(blob.cipher).toBe('xchacha20-poly1305')
    expect(typeof blob.salt).toBe('string')
    expect(typeof blob.nonce).toBe('string')
    expect(typeof blob.ciphertext).toBe('string')
    expect(typeof blob.pubkeyHash).toBe('string')
    expect(blob.pubkeyHash.length).toBe(16) // truncated SHA-256
    expect(blob.prfUsed).toBe(false)
    expect(blob.idpIssuer).toBe('https://idp.example.com')
  })

  test('encryptNsec round-trips correctly (2-factor)', () => {
    const nsecHex = 'aabbccdd'.repeat(8)
    const kek = deriveKEK({ pin, idpValue, salt })
    const blob = encryptNsec(nsecHex, kek, 'pubkey123', false, 'https://idp.example.com', salt)
    const decrypted = decryptNsec(blob, kek)
    expect(decrypted).toBe(nsecHex)
  })

  test('encryptNsec round-trips correctly (3-factor)', () => {
    const nsecHex = '11223344'.repeat(8)
    const kek = deriveKEK({ pin, idpValue, prfOutput, salt })
    const blob = encryptNsec(nsecHex, kek, 'pubkey456', true, 'https://idp.example.com', salt)
    const decrypted = decryptNsec(blob, kek)
    expect(decrypted).toBe(nsecHex)
  })

  test('decryptNsec returns null for wrong KEK', () => {
    const nsecHex = 'aabbccdd'.repeat(8)
    const kekGood = deriveKEK({ pin, idpValue, salt })
    const kekBad = deriveKEK({ pin: '999999', idpValue, salt })
    const blob = encryptNsec(nsecHex, kekGood, 'pubkey789', false, 'https://idp.example.com', salt)
    const result = decryptNsec(blob, kekBad)
    expect(result).toBeNull()
  })

  test('two encryptNsec calls produce different nonces (non-deterministic)', () => {
    const kek = deriveKEK({ pin, idpValue, salt })
    const blobA = encryptNsec('nsec1test', kek, 'pk1', false, 'https://idp.example.com', salt)
    const blobB = encryptNsec('nsec1test', kek, 'pk1', false, 'https://idp.example.com', salt)
    expect(blobA.nonce).not.toBe(blobB.nonce)
  })

  // ── isValidPin ────────────────────────────────────────────────────────────

  test('isValidPin accepts 6-digit PIN', () => {
    expect(isValidPin('123456')).toBe(true)
  })

  test('isValidPin accepts 7-digit PIN', () => {
    expect(isValidPin('1234567')).toBe(true)
  })

  test('isValidPin accepts 8-digit PIN', () => {
    expect(isValidPin('12345678')).toBe(true)
  })

  test('isValidPin rejects 5-digit PIN', () => {
    expect(isValidPin('12345')).toBe(false)
  })

  test('isValidPin rejects 9-digit PIN', () => {
    expect(isValidPin('123456789')).toBe(false)
  })

  test('isValidPin rejects empty string', () => {
    expect(isValidPin('')).toBe(false)
  })

  test('isValidPin rejects PIN with letters', () => {
    expect(isValidPin('12345a')).toBe(false)
  })

  test('isValidPin rejects PIN with spaces', () => {
    expect(isValidPin('12 456')).toBe(false)
  })

  test('isValidPin rejects PIN with symbols', () => {
    expect(isValidPin('1234!6')).toBe(false)
  })
})
