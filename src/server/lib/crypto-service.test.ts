import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { HMAC_PHONE_PREFIX, LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { CryptoService } from './crypto-service'

const TEST_SERVER_SECRET = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000002'

describe('CryptoService', () => {
  const crypto = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)

  describe('serverEncrypt / serverDecrypt', () => {
    test('round-trip', () => {
      const ct = crypto.serverEncrypt('hello', LABEL_VOLUNTEER_PII)
      const pt = crypto.serverDecrypt(ct, LABEL_VOLUNTEER_PII)
      expect(pt).toBe('hello')
    })

    test('different nonce each time', () => {
      const a = crypto.serverEncrypt('same', LABEL_VOLUNTEER_PII)
      const b = crypto.serverEncrypt('same', LABEL_VOLUNTEER_PII)
      expect(a).not.toBe(b)
    })

    test('wrong label fails', () => {
      const ct = crypto.serverEncrypt('secret', LABEL_VOLUNTEER_PII)
      expect(() => crypto.serverDecrypt(ct, 'wrong:label')).toThrow()
    })
  })

  describe('hmac', () => {
    test('deterministic', () => {
      const a = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      const b = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      expect(a).toBe(b)
    })

    test('different label gives different hash', () => {
      const a = crypto.hmac('+15551234567', 'label:a')
      const b = crypto.hmac('+15551234567', 'label:b')
      expect(a).not.toBe(b)
    })
  })

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('round-trip with single recipient', () => {
      const recipientSecret = new Uint8Array(32)
      globalThis.crypto.getRandomValues(recipientSecret)
      const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'secret message',
        [recipientPubkey],
        LABEL_VOLUNTEER_PII
      )

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(recipientPubkey)

      const pt = crypto.envelopeDecrypt(
        encrypted,
        envelopes[0],
        recipientSecret,
        LABEL_VOLUNTEER_PII
      )
      expect(pt).toBe('secret message')
    })

    test('multiple recipients can each decrypt', () => {
      const secret1 = new Uint8Array(32)
      globalThis.crypto.getRandomValues(secret1)
      const pub1 = bytesToHex(secp256k1.getPublicKey(secret1, true).slice(1))

      const secret2 = new Uint8Array(32)
      globalThis.crypto.getRandomValues(secret2)
      const pub2 = bytesToHex(secp256k1.getPublicKey(secret2, true).slice(1))

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'shared secret',
        [pub1, pub2],
        LABEL_VOLUNTEER_PII
      )

      expect(envelopes).toHaveLength(2)

      const env1 = envelopes.find((e) => e.pubkey === pub1)!
      const env2 = envelopes.find((e) => e.pubkey === pub2)!

      expect(crypto.envelopeDecrypt(encrypted, env1, secret1, LABEL_VOLUNTEER_PII)).toBe(
        'shared secret'
      )
      expect(crypto.envelopeDecrypt(encrypted, env2, secret2, LABEL_VOLUNTEER_PII)).toBe(
        'shared secret'
      )
    })
  })

  describe('hubEncrypt / hubDecrypt', () => {
    test('round-trip', () => {
      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)

      const ct = crypto.hubEncrypt('hub data', hubKey)
      const pt = crypto.hubDecrypt(ct, hubKey)
      expect(pt).toBe('hub data')
    })

    test('wrong key returns null', () => {
      const key1 = new Uint8Array(32)
      globalThis.crypto.getRandomValues(key1)
      const key2 = new Uint8Array(32)
      globalThis.crypto.getRandomValues(key2)

      const ct = crypto.hubEncrypt('data', key1)
      expect(crypto.hubDecrypt(ct, key2)).toBeNull()
    })
  })
})
