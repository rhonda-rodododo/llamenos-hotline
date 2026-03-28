import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { CryptoService } from './crypto-service'

const TEST_SERVER_SECRET = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000002'

describe('E2EE verification', () => {
  const crypto = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)

  test('server cannot decrypt E2EE envelope-encrypted data', () => {
    // Volunteer encrypts their name for themselves + an admin
    const volunteerSecret = new Uint8Array(32)
    globalThis.crypto.getRandomValues(volunteerSecret)
    const volunteerPub = bytesToHex(secp256k1.getPublicKey(volunteerSecret, true).slice(1))

    const adminSecret = new Uint8Array(32)
    globalThis.crypto.getRandomValues(adminSecret)
    const adminPub = bytesToHex(secp256k1.getPublicKey(adminSecret, true).slice(1))

    // Encrypt name for volunteer + admin only
    const { encrypted, envelopes } = crypto.envelopeEncrypt(
      'Jane Smith',
      [volunteerPub, adminPub],
      LABEL_VOLUNTEER_PII
    )

    // Server CANNOT decrypt — it doesn't have volunteer or admin private keys
    // Attempting to decrypt with server-key should fail
    expect(() => {
      crypto.serverDecrypt(encrypted, LABEL_VOLUNTEER_PII)
    }).toThrow()

    // But the actual recipients CAN decrypt
    const decrypted = crypto.envelopeDecrypt(
      encrypted,
      envelopes.find((e) => e.pubkey === volunteerPub)!,
      volunteerSecret,
      LABEL_VOLUNTEER_PII
    )
    expect(decrypted).toBe('Jane Smith')
  })

  test('volunteer name with envelopes cannot be decrypted with server key', () => {
    const volunteerSecret = new Uint8Array(32)
    globalThis.crypto.getRandomValues(volunteerSecret)
    const volunteerPub = bytesToHex(secp256k1.getPublicKey(volunteerSecret, true).slice(1))

    const adminSecret = new Uint8Array(32)
    globalThis.crypto.getRandomValues(adminSecret)
    const adminPub = bytesToHex(secp256k1.getPublicKey(adminSecret, true).slice(1))

    // Envelope encrypt name for volunteer + admin
    const { encrypted, envelopes } = crypto.envelopeEncrypt(
      'Jane Smith',
      [volunteerPub, adminPub],
      LABEL_VOLUNTEER_PII
    )

    // Server key CANNOT decrypt envelope-encrypted data
    expect(() => {
      crypto.serverDecrypt(encrypted, LABEL_VOLUNTEER_PII)
    }).toThrow()

    // But authorized recipients CAN decrypt
    const volunteerDecrypted = crypto.envelopeDecrypt(
      encrypted,
      envelopes.find((e) => e.pubkey === volunteerPub)!,
      volunteerSecret,
      LABEL_VOLUNTEER_PII
    )
    expect(volunteerDecrypted).toBe('Jane Smith')

    const adminDecrypted = crypto.envelopeDecrypt(
      encrypted,
      envelopes.find((e) => e.pubkey === adminPub)!,
      adminSecret,
      LABEL_VOLUNTEER_PII
    )
    expect(adminDecrypted).toBe('Jane Smith')
  })

  test('server CAN decrypt server-key encrypted data', () => {
    const ct = crypto.serverEncrypt('+15551234567', LABEL_VOLUNTEER_PII)
    const pt = crypto.serverDecrypt(ct, LABEL_VOLUNTEER_PII)
    expect(pt).toBe('+15551234567')
  })
})
