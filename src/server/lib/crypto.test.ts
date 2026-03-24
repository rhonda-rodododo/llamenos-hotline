import { describe, expect, test } from 'bun:test'
import { encryptProviderCredentials, decryptProviderCredentials } from './crypto'

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
