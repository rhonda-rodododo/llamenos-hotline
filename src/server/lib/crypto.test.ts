import { describe, expect, test } from 'bun:test'
import { LABEL_VOICEMAIL_WRAP } from '@shared/crypto-labels'
import {
  decryptBinaryFromStorage,
  decryptProviderCredentials,
  decryptStorageCredential,
  encryptBinaryForStorage,
  encryptProviderCredentials,
  encryptStorageCredential,
} from './crypto'

describe('provider credential encryption', () => {
  const TEST_SECRET = 'a'.repeat(64)

  test('encrypt then decrypt roundtrip', () => {
    const plaintext = JSON.stringify({ accountSid: 'AC123', authToken: 'secret-token-here' })
    const encrypted = encryptProviderCredentials(plaintext, TEST_SECRET)
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toMatch(/^[0-9a-f]+$/)
    const decrypted = decryptProviderCredentials(encrypted, TEST_SECRET)
    expect(decrypted).toBe(plaintext)
  })

  test('decrypt with wrong key throws', () => {
    const encrypted = encryptProviderCredentials('secret data', TEST_SECRET)
    const wrongKey = 'b'.repeat(64)
    expect(() => decryptProviderCredentials(encrypted, wrongKey)).toThrow()
  })

  test('each encryption produces different ciphertext (random nonce)', () => {
    const plaintext = 'same input'
    const a = encryptProviderCredentials(plaintext, TEST_SECRET)
    const b = encryptProviderCredentials(plaintext, TEST_SECRET)
    expect(a).not.toBe(b)
  })

  test('encrypted output is nonce (48 hex = 24 bytes) + ciphertext', () => {
    const encrypted = encryptProviderCredentials('test', TEST_SECRET)
    expect(encrypted.length).toBeGreaterThan(48 + 32)
  })
})

describe('storage credential encryption', () => {
  const TEST_SECRET = 'c'.repeat(64)

  test('encrypt then decrypt roundtrip', () => {
    const secretKey = 'my-super-secret-iam-key-12345'
    const encrypted = encryptStorageCredential(secretKey, TEST_SECRET)
    expect(encrypted).not.toBe(secretKey)
    expect(encrypted).toMatch(/^[0-9a-f]+$/)
    const decrypted = decryptStorageCredential(encrypted, TEST_SECRET)
    expect(decrypted).toBe(secretKey)
  })

  test('decrypt with wrong server secret throws', () => {
    const encrypted = encryptStorageCredential('secret-key', TEST_SECRET)
    const wrongSecret = 'd'.repeat(64)
    expect(() => decryptStorageCredential(encrypted, wrongSecret)).toThrow()
  })

  test('each encryption produces different ciphertext (random nonce)', () => {
    const secretKey = 'same-key-input'
    const a = encryptStorageCredential(secretKey, TEST_SECRET)
    const b = encryptStorageCredential(secretKey, TEST_SECRET)
    expect(a).not.toBe(b)
  })

  test('encrypted output is nonce (48 hex = 24 bytes) + ciphertext', () => {
    const encrypted = encryptStorageCredential('test-key', TEST_SECRET)
    // 24 bytes nonce = 48 hex chars, plus ciphertext + poly1305 tag
    expect(encrypted.length).toBeGreaterThan(48 + 16)
  })
})

describe('encryptBinaryForStorage', () => {
  test('encrypts and decrypts binary data for a recipient', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const result = encryptBinaryForStorage(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)

    expect(result.encryptedContent).toBeDefined()
    expect(result.readerEnvelopes).toHaveLength(1)
    expect(result.readerEnvelopes[0].pubkey).toBe(pubkey)

    const decrypted = decryptBinaryFromStorage(
      result.encryptedContent,
      result.readerEnvelopes[0],
      privkey,
      LABEL_VOICEMAIL_WRAP
    )
    expect(decrypted).toEqual(plaintext)
  })

  test('encrypts for multiple recipients', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey1 = schnorr.utils.randomSecretKey()
    const pubkey1 = Buffer.from(schnorr.getPublicKey(privkey1)).toString('hex')
    const privkey2 = schnorr.utils.randomSecretKey()
    const pubkey2 = Buffer.from(schnorr.getPublicKey(privkey2)).toString('hex')

    const plaintext = new Uint8Array(1024) // 1KB of data
    crypto.getRandomValues(plaintext)

    const result = encryptBinaryForStorage(plaintext, [pubkey1, pubkey2], LABEL_VOICEMAIL_WRAP)
    expect(result.readerEnvelopes).toHaveLength(2)

    // Both recipients can decrypt
    const dec1 = decryptBinaryFromStorage(
      result.encryptedContent,
      result.readerEnvelopes[0],
      privkey1,
      LABEL_VOICEMAIL_WRAP
    )
    const dec2 = decryptBinaryFromStorage(
      result.encryptedContent,
      result.readerEnvelopes[1],
      privkey2,
      LABEL_VOICEMAIL_WRAP
    )
    expect(dec1).toEqual(plaintext)
    expect(dec2).toEqual(plaintext)
  })

  test('wrong private key cannot decrypt', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')
    const wrongPrivkey = schnorr.utils.randomSecretKey()

    const plaintext = new Uint8Array([42, 43, 44])
    const result = encryptBinaryForStorage(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)

    expect(() =>
      decryptBinaryFromStorage(
        result.encryptedContent,
        result.readerEnvelopes[0],
        wrongPrivkey,
        LABEL_VOICEMAIL_WRAP
      )
    ).toThrow()
  })

  test('each encryption produces different ciphertext', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const plaintext = new Uint8Array([1, 2, 3])
    const a = encryptBinaryForStorage(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)
    const b = encryptBinaryForStorage(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)
    expect(a.encryptedContent).not.toBe(b.encryptedContent)
  })
})
