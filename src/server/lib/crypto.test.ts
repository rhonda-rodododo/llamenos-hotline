import { describe, expect, test } from 'bun:test'
import { LABEL_CALL_META, LABEL_MESSAGE, LABEL_VOICEMAIL_WRAP } from '@shared/crypto-labels'
import {
  decryptBinaryFromStorage,
  decryptFromHub,
  decryptProviderCredentials,
  eciesUnwrapKeyServer,
  encryptBinaryForStorage,
  encryptCallRecordForStorage,
  encryptForHub,
  encryptMessageForStorage,
  encryptProviderCredentials,
  hashAuditEntry,
  hashIP,
  hashPhone,
  unwrapHubKeyForServer,
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

describe('hashPhone', () => {
  const SECRET = 'a'.repeat(64)

  test('deterministic — same input produces same hash', () => {
    const h1 = hashPhone('+15551234567', SECRET)
    const h2 = hashPhone('+15551234567', SECRET)
    expect(h1).toBe(h2)
  })

  test('different phones produce different hashes', () => {
    const h1 = hashPhone('+15551234567', SECRET)
    const h2 = hashPhone('+15559876543', SECRET)
    expect(h1).not.toBe(h2)
  })

  test('different secrets produce different hashes', () => {
    const h1 = hashPhone('+15551234567', SECRET)
    const h2 = hashPhone('+15551234567', 'b'.repeat(64))
    expect(h1).not.toBe(h2)
  })

  test('output is valid hex, 64 chars', () => {
    const h = hashPhone('+15551234567', SECRET)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('hashIP', () => {
  const SECRET = 'a'.repeat(64)

  test('deterministic', () => {
    const h1 = hashIP('192.168.1.1', SECRET)
    const h2 = hashIP('192.168.1.1', SECRET)
    expect(h1).toBe(h2)
  })

  test('output is exactly 24 hex chars (96 bits)', () => {
    const h = hashIP('10.0.0.1', SECRET)
    expect(h).toMatch(/^[0-9a-f]{24}$/)
  })

  test('different IPs produce different hashes', () => {
    const h1 = hashIP('192.168.1.1', SECRET)
    const h2 = hashIP('10.0.0.1', SECRET)
    expect(h1).not.toBe(h2)
  })
})

describe('encryptMessageForStorage', () => {
  test('single-recipient roundtrip', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const { hexToBytes } = await import('@noble/hashes/utils.js')
    const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js')

    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const plaintext = 'Hello, this is a crisis message'
    const result = encryptMessageForStorage(plaintext, [pubkey])

    expect(result.readerEnvelopes).toHaveLength(1)
    expect(result.readerEnvelopes[0].pubkey).toBe(pubkey)

    // Unwrap the message key
    const messageKey = eciesUnwrapKeyServer(result.readerEnvelopes[0], privkey, LABEL_MESSAGE)
    expect(messageKey).toHaveLength(32)

    // Decrypt the content
    const packed = hexToBytes(result.encryptedContent)
    const nonce = packed.slice(0, 24)
    const ciphertext = packed.slice(24)
    const cipher = xchacha20poly1305(messageKey, nonce)
    const decrypted = new TextDecoder().decode(cipher.decrypt(ciphertext))
    expect(decrypted).toBe(plaintext)
  })

  test('multi-recipient — each reader unwraps same message key', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')

    const privkey1 = schnorr.utils.randomSecretKey()
    const pubkey1 = Buffer.from(schnorr.getPublicKey(privkey1)).toString('hex')
    const privkey2 = schnorr.utils.randomSecretKey()
    const pubkey2 = Buffer.from(schnorr.getPublicKey(privkey2)).toString('hex')

    const result = encryptMessageForStorage('shared secret message', [pubkey1, pubkey2])
    expect(result.readerEnvelopes).toHaveLength(2)

    const key1 = eciesUnwrapKeyServer(result.readerEnvelopes[0], privkey1, LABEL_MESSAGE)
    const key2 = eciesUnwrapKeyServer(result.readerEnvelopes[1], privkey2, LABEL_MESSAGE)

    // Both readers recover the same message key
    expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'))
  })

  test('nonce uniqueness — same plaintext produces different ciphertext', () => {
    const { schnorr } = require('@noble/curves/secp256k1.js')
    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const a = encryptMessageForStorage('same text', [pubkey])
    const b = encryptMessageForStorage('same text', [pubkey])
    expect(a.encryptedContent).not.toBe(b.encryptedContent)
  })
})

describe('encryptCallRecordForStorage', () => {
  test('roundtrip with admin pubkeys', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const { hexToBytes } = await import('@noble/hashes/utils.js')
    const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js')

    const adminPrivkey = schnorr.utils.randomSecretKey()
    const adminPubkey = Buffer.from(schnorr.getPublicKey(adminPrivkey)).toString('hex')

    const metadata = { answeredBy: 'volunteer-abc', callerNumber: '+15551234567', duration: 120 }
    const result = encryptCallRecordForStorage(metadata, [adminPubkey])

    expect(result.adminEnvelopes).toHaveLength(1)
    expect(result.adminEnvelopes[0].pubkey).toBe(adminPubkey)

    // Unwrap with LABEL_CALL_META
    const recordKey = eciesUnwrapKeyServer(result.adminEnvelopes[0], adminPrivkey, LABEL_CALL_META)

    // Decrypt the content
    const packed = hexToBytes(result.encryptedContent)
    const nonce = packed.slice(0, 24)
    const ciphertext = packed.slice(24)
    const cipher = xchacha20poly1305(recordKey, nonce)
    const decrypted = JSON.parse(new TextDecoder().decode(cipher.decrypt(ciphertext)))
    expect(decrypted).toEqual(metadata)
  })

  test('cross-label unwrap fails — LABEL_MESSAGE cannot unwrap LABEL_CALL_META', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')

    const adminPrivkey = schnorr.utils.randomSecretKey()
    const adminPubkey = Buffer.from(schnorr.getPublicKey(adminPrivkey)).toString('hex')

    const result = encryptCallRecordForStorage({ foo: 'bar' }, [adminPubkey])

    // Unwrapping with wrong label should throw (domain separation)
    expect(() =>
      eciesUnwrapKeyServer(result.adminEnvelopes[0], adminPrivkey, LABEL_MESSAGE)
    ).toThrow()
  })
})

describe('encryptForHub / decryptFromHub', () => {
  test('roundtrip with known hub key', () => {
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)

    const plaintext = 'hub-encrypted event payload'
    const encrypted = encryptForHub(plaintext, hubKey)
    const decrypted = decryptFromHub(encrypted, hubKey)
    expect(decrypted).toBe(plaintext)
  })

  test('wrong key returns null', () => {
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)
    const wrongKey = new Uint8Array(32)
    crypto.getRandomValues(wrongKey)

    const encrypted = encryptForHub('secret', hubKey)
    const result = decryptFromHub(encrypted, wrongKey)
    expect(result).toBeNull()
  })

  test('nonce uniqueness — same plaintext produces different ciphertext', () => {
    const hubKey = new Uint8Array(32)
    crypto.getRandomValues(hubKey)

    const a = encryptForHub('same payload', hubKey)
    const b = encryptForHub('same payload', hubKey)
    expect(a).not.toBe(b)
  })
})

describe('eciesUnwrapKeyServer', () => {
  test('domain separation — wrap with LABEL_MESSAGE, unwrap with LABEL_CALL_META throws', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')

    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const result = encryptMessageForStorage('test message', [pubkey], LABEL_MESSAGE)

    expect(() =>
      eciesUnwrapKeyServer(result.readerEnvelopes[0], privkey, LABEL_CALL_META)
    ).toThrow()
  })

  test('wrong private key throws', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1.js')

    const privkey = schnorr.utils.randomSecretKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')
    const wrongPrivkey = schnorr.utils.randomSecretKey()

    const result = encryptMessageForStorage('test message', [pubkey])

    expect(() =>
      eciesUnwrapKeyServer(result.readerEnvelopes[0], wrongPrivkey, LABEL_MESSAGE)
    ).toThrow()
  })
})

describe('unwrapHubKeyForServer', () => {
  test('full roundtrip — derive server pubkey, wrap hub key, unwrap recovers it', async () => {
    const { secp256k1 } = await import('@noble/curves/secp256k1.js')
    const { hkdf } = await import('@noble/hashes/hkdf.js')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, hexToBytes } = await import('@noble/hashes/utils.js')
    const { utf8ToBytes } = await import('@noble/ciphers/utils.js')
    const { eciesWrapKey } = await import('../../client/lib/crypto')
    const { LABEL_SERVER_NOSTR_KEY, LABEL_SERVER_NOSTR_KEY_INFO, LABEL_HUB_KEY_WRAP } =
      await import('@shared/crypto-labels')

    // Generate a random server secret (64 hex chars)
    const serverSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))

    // Derive the server pubkey the same way the source does
    const serverPrivateKey = hkdf(
      sha256,
      hexToBytes(serverSecret),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
      32
    )
    const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

    // Create a hub key
    const hubKey = crypto.getRandomValues(new Uint8Array(32))

    // Wrap the hub key for the server pubkey using client-side eciesWrapKey
    const wrapped = eciesWrapKey(hubKey, serverPubkey, LABEL_HUB_KEY_WRAP)

    const envelopes = [
      {
        pubkey: serverPubkey,
        wrappedKey: wrapped.wrappedKey,
        ephemeralPubkey: wrapped.ephemeralPubkey,
      },
    ]

    // unwrapHubKeyForServer should recover the hub key
    const recovered = unwrapHubKeyForServer(serverSecret, envelopes)
    expect(Buffer.from(recovered).toString('hex')).toBe(Buffer.from(hubKey).toString('hex'))
  })

  test('wrong server secret throws — no matching envelope', async () => {
    const { secp256k1 } = await import('@noble/curves/secp256k1.js')
    const { hkdf } = await import('@noble/hashes/hkdf.js')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, hexToBytes } = await import('@noble/hashes/utils.js')
    const { utf8ToBytes } = await import('@noble/ciphers/utils.js')
    const { eciesWrapKey } = await import('../../client/lib/crypto')
    const { LABEL_SERVER_NOSTR_KEY, LABEL_SERVER_NOSTR_KEY_INFO, LABEL_HUB_KEY_WRAP } =
      await import('@shared/crypto-labels')

    const serverSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
    const wrongSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))

    // Derive pubkey from the correct secret
    const serverPrivateKey = hkdf(
      sha256,
      hexToBytes(serverSecret),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
      32
    )
    const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

    const hubKey = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = eciesWrapKey(hubKey, serverPubkey, LABEL_HUB_KEY_WRAP)

    const envelopes = [
      {
        pubkey: serverPubkey,
        wrappedKey: wrapped.wrappedKey,
        ephemeralPubkey: wrapped.ephemeralPubkey,
      },
    ]

    // Wrong secret derives a different pubkey, so no envelope matches
    expect(() => unwrapHubKeyForServer(wrongSecret, envelopes)).toThrow(
      /No hub key envelope for server pubkey/
    )
  })
})

describe('hashAuditEntry', () => {
  const baseEntry = {
    id: 'entry-001',
    event: 'call.answered',
    actorPubkey: 'abc123',
    details: { callId: 'call-42' },
    createdAt: '2026-03-26T00:00:00Z',
  }

  test('deterministic', () => {
    const h1 = hashAuditEntry(baseEntry)
    const h2 = hashAuditEntry(baseEntry)
    expect(h1).toBe(h2)
  })

  test('output is 64 hex chars', () => {
    const h = hashAuditEntry(baseEntry)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  test('changing any field changes hash', () => {
    const original = hashAuditEntry(baseEntry)

    expect(hashAuditEntry({ ...baseEntry, id: 'entry-002' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, event: 'call.missed' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, actorPubkey: 'xyz789' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, details: { callId: 'call-99' } })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, createdAt: '2026-03-27T00:00:00Z' })).not.toBe(original)
  })

  test('chain linkage — with vs without previousEntryHash', () => {
    const withoutPrev = hashAuditEntry(baseEntry)
    const withPrev = hashAuditEntry({ ...baseEntry, previousEntryHash: 'deadbeef'.repeat(8) })
    expect(withoutPrev).not.toBe(withPrev)
  })
})
