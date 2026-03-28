import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import { eciesUnwrapKey } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import { CryptoService } from '../../server/lib/crypto-service'
import { generateKeyPair } from './crypto'
import {
  decryptFromHub,
  encryptForHub,
  generateHubKey,
  rotateHubKey,
  unwrapHubKey,
  wrapHubKeyForMember,
  wrapHubKeyForMembers,
} from './hub-key-manager'

const serverCrypto = new CryptoService('a'.repeat(64), 'b'.repeat(64))

// ── B1: generateHubKey ────────────────────────────────────────────────────────

describe('generateHubKey', () => {
  test('returns a 32-byte Uint8Array', () => {
    const key = generateHubKey()
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
  })

  test('two calls produce different keys', () => {
    const key1 = generateHubKey()
    const key2 = generateHubKey()
    expect(bytesToHex(key1)).not.toBe(bytesToHex(key2))
  })
})

// ── B2: wrapHubKeyForMember / unwrapHubKey ────────────────────────────────────

describe('wrapHubKeyForMember / unwrapHubKey', () => {
  test('roundtrip: generate → wrap → unwrap = original', () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey = generateHubKey()

    const envelope = wrapHubKeyForMember(hubKey, publicKey)
    const recovered = unwrapHubKey(envelope, secretKey)

    expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
  })

  test('wrong secretKey throws', () => {
    const { publicKey } = generateKeyPair()
    const { secretKey: wrongSecretKey } = generateKeyPair()
    const hubKey = generateHubKey()

    const envelope = wrapHubKeyForMember(hubKey, publicKey)

    expect(() => unwrapHubKey(envelope, wrongSecretKey)).toThrow()
  })

  test('envelope has pubkey, wrappedKey, ephemeralPubkey fields', () => {
    const { publicKey } = generateKeyPair()
    const hubKey = generateHubKey()

    const envelope = wrapHubKeyForMember(hubKey, publicKey)

    expect(envelope).toHaveProperty('pubkey', publicKey)
    expect(envelope).toHaveProperty('wrappedKey')
    expect(envelope).toHaveProperty('ephemeralPubkey')
    expect(typeof envelope.wrappedKey).toBe('string')
    expect(typeof envelope.ephemeralPubkey).toBe('string')
  })
})

// ── B3: wrapHubKeyForMembers ──────────────────────────────────────────────────

describe('wrapHubKeyForMembers', () => {
  test('3 members, each unwraps → gets same hub key', () => {
    const members = [generateKeyPair(), generateKeyPair(), generateKeyPair()]
    const hubKey = generateHubKey()

    const envelopes = wrapHubKeyForMembers(
      hubKey,
      members.map((m) => m.publicKey)
    )

    for (let i = 0; i < members.length; i++) {
      const recovered = unwrapHubKey(envelopes[i], members[i].secretKey)
      expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
    }
  })

  test('returns array with correct length', () => {
    const pubkeys = [
      generateKeyPair().publicKey,
      generateKeyPair().publicKey,
      generateKeyPair().publicKey,
    ]
    const hubKey = generateHubKey()

    const envelopes = wrapHubKeyForMembers(hubKey, pubkeys)

    expect(envelopes).toHaveLength(3)
  })
})

// ── B4: encryptForHub / decryptFromHub ────────────────────────────────────────

describe('encryptForHub / decryptFromHub', () => {
  test('roundtrip', () => {
    const hubKey = generateHubKey()
    const plaintext = 'hello hub world'

    const encrypted = encryptForHub(plaintext, hubKey)
    const decrypted = decryptFromHub(encrypted, hubKey)

    expect(decrypted).toBe(plaintext)
  })

  test('wrong key → null', () => {
    const hubKey = generateHubKey()
    const wrongKey = generateHubKey()
    const plaintext = 'secret message'

    const encrypted = encryptForHub(plaintext, hubKey)
    const result = decryptFromHub(encrypted, wrongKey)

    expect(result).toBeNull()
  })

  test('nonce uniqueness: two encryptions of same plaintext produce different ciphertexts', () => {
    const hubKey = generateHubKey()
    const plaintext = 'same text'

    const enc1 = encryptForHub(plaintext, hubKey)
    const enc2 = encryptForHub(plaintext, hubKey)

    expect(enc1).not.toBe(enc2)
  })
})

// ── B5: rotateHubKey ──────────────────────────────────────────────────────────

describe('rotateHubKey', () => {
  test('new key differs from a previously generated hub key', () => {
    const oldKey = generateHubKey()
    const { hubKey: newKey } = rotateHubKey([generateKeyPair().publicKey])

    expect(bytesToHex(newKey)).not.toBe(bytesToHex(oldKey))
  })

  test('each member unwraps their envelope and gets the new key', () => {
    const members = [generateKeyPair(), generateKeyPair(), generateKeyPair()]
    const { hubKey, envelopes } = rotateHubKey(members.map((m) => m.publicKey))

    expect(envelopes).toHaveLength(3)
    for (let i = 0; i < members.length; i++) {
      const recovered = unwrapHubKey(envelopes[i], members[i].secretKey)
      expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
    }
  })

  test('data encrypted with old key cannot be decrypted with new key', () => {
    const member = generateKeyPair()
    const oldKey = generateHubKey()
    const { hubKey: newKey } = rotateHubKey([member.publicKey])

    const encrypted = encryptForHub('sensitive data', oldKey)
    const result = decryptFromHub(encrypted, newKey)

    expect(result).toBeNull()
  })
})

// ── B6: Client↔Server interop ─────────────────────────────────────────────────

describe('client↔server interop', () => {
  test('client wrap → server unwrap: recovers original hub key', () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey = generateHubKey()

    const envelope = wrapHubKeyForMember(hubKey, publicKey)
    const recovered = eciesUnwrapKey(
      { wrappedKey: envelope.wrappedKey, ephemeralPubkey: envelope.ephemeralPubkey },
      secretKey,
      LABEL_HUB_KEY_WRAP
    )

    expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
  })

  test('client encryptForHub → server hubDecrypt: recovers plaintext', () => {
    const hubKey = generateHubKey()
    const plaintext = 'client encrypted, server reads'

    const encrypted = encryptForHub(plaintext, hubKey)
    const decrypted = serverCrypto.hubDecrypt(encrypted as Ciphertext, hubKey)

    expect(decrypted).toBe(plaintext)
  })

  test('server hubEncrypt → client decryptFromHub: recovers plaintext', () => {
    const hubKey = generateHubKey()
    const plaintext = 'server encrypted, client reads'

    const encrypted = serverCrypto.hubEncrypt(plaintext, hubKey)
    const decrypted = decryptFromHub(encrypted, hubKey)

    expect(decrypted).toBe(plaintext)
  })
})
