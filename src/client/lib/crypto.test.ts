import { describe, expect, test } from 'bun:test'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  HKDF_CONTEXT_EXPORT,
  HKDF_CONTEXT_NOTES,
  HKDF_SALT,
  LABEL_CALL_META,
  LABEL_MESSAGE,
  LABEL_NOTE_KEY,
  LABEL_TRANSCRIPTION,
} from '@shared/crypto-labels'
import type { NotePayload } from '@shared/types'
import {
  createAuthToken,
  decryptCallRecord,
  decryptDraft,
  decryptMessage,
  decryptNote,
  decryptNoteV2,
  decryptTranscription,
  eciesUnwrapKey,
  eciesWrapKey,
  encryptDraft,
  encryptExport,
  encryptMessage,
  encryptNoteV2,
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

// ── A1: encryptNoteV2 / decryptNoteV2 ──

describe('encryptNoteV2 / decryptNoteV2', () => {
  const samplePayload: NotePayload = {
    text: 'Caller reported unsafe conditions at home.',
    fields: { urgency: 'high', followUp: true },
  }

  test('author roundtrip: encrypt → decrypt via authorEnvelope recovers original payload', () => {
    const author = generateKeyPair()
    const admin = generateKeyPair()

    const encrypted = encryptNoteV2(samplePayload, author.publicKey, [admin.publicKey])
    const decrypted = decryptNoteV2(
      encrypted.encryptedContent,
      encrypted.authorEnvelope,
      author.secretKey
    )

    expect(decrypted).toEqual(samplePayload)
  })

  test('admin roundtrip: encrypt with 2 admins → each decrypts via their envelope', () => {
    const author = generateKeyPair()
    const admin1 = generateKeyPair()
    const admin2 = generateKeyPair()

    const encrypted = encryptNoteV2(samplePayload, author.publicKey, [
      admin1.publicKey,
      admin2.publicKey,
    ])

    expect(encrypted.adminEnvelopes).toHaveLength(2)

    const env1 = encrypted.adminEnvelopes.find((e) => e.pubkey === admin1.publicKey)!
    const env2 = encrypted.adminEnvelopes.find((e) => e.pubkey === admin2.publicKey)!

    const dec1 = decryptNoteV2(encrypted.encryptedContent, env1, admin1.secretKey)
    const dec2 = decryptNoteV2(encrypted.encryptedContent, env2, admin2.secretKey)

    expect(dec1).toEqual(samplePayload)
    expect(dec2).toEqual(samplePayload)
  })

  test('wrong key: unrelated secretKey returns null', () => {
    const author = generateKeyPair()
    const attacker = generateKeyPair()

    const encrypted = encryptNoteV2(samplePayload, author.publicKey, [])
    const result = decryptNoteV2(
      encrypted.encryptedContent,
      encrypted.authorEnvelope,
      attacker.secretKey
    )

    expect(result).toBeNull()
  })

  test('forward secrecy: two encryptions produce different encryptedContent', () => {
    const author = generateKeyPair()

    const enc1 = encryptNoteV2(samplePayload, author.publicKey, [])
    const enc2 = encryptNoteV2(samplePayload, author.publicKey, [])

    expect(enc1.encryptedContent).not.toBe(enc2.encryptedContent)
  })

  test('cross-label: unwrap authorEnvelope with LABEL_MESSAGE instead of LABEL_NOTE_KEY throws', () => {
    const author = generateKeyPair()

    const encrypted = encryptNoteV2(samplePayload, author.publicKey, [])

    expect(() =>
      eciesUnwrapKey(encrypted.authorEnvelope, author.secretKey, LABEL_MESSAGE)
    ).toThrow()
  })
})

// ── A2: encryptMessage / decryptMessage ──

describe('encryptMessage / decryptMessage', () => {
  const plaintext = 'Hola, necesito ayuda urgente.'

  test('single-reader roundtrip', () => {
    const reader = generateKeyPair()

    const encrypted = encryptMessage(plaintext, [reader.publicKey])
    const decrypted = decryptMessage(
      encrypted.encryptedContent,
      encrypted.readerEnvelopes,
      reader.secretKey,
      reader.publicKey
    )

    expect(decrypted).toBe(plaintext)
  })

  test('multi-reader: 3 readers each decrypt', () => {
    const r1 = generateKeyPair()
    const r2 = generateKeyPair()
    const r3 = generateKeyPair()

    const encrypted = encryptMessage(plaintext, [r1.publicKey, r2.publicKey, r3.publicKey])

    for (const r of [r1, r2, r3]) {
      const dec = decryptMessage(
        encrypted.encryptedContent,
        encrypted.readerEnvelopes,
        r.secretKey,
        r.publicKey
      )
      expect(dec).toBe(plaintext)
    }
  })

  test('wrong pubkey lookup: non-matching pubkey returns null', () => {
    const reader = generateKeyPair()
    const other = generateKeyPair()

    const encrypted = encryptMessage(plaintext, [reader.publicKey])
    const result = decryptMessage(
      encrypted.encryptedContent,
      encrypted.readerEnvelopes,
      other.secretKey,
      other.publicKey
    )

    expect(result).toBeNull()
  })

  test('wrong secretKey: correct pubkey, wrong key returns null', () => {
    const reader = generateKeyPair()
    const attacker = generateKeyPair()

    const encrypted = encryptMessage(plaintext, [reader.publicKey])
    const result = decryptMessage(
      encrypted.encryptedContent,
      encrypted.readerEnvelopes,
      attacker.secretKey,
      reader.publicKey
    )

    expect(result).toBeNull()
  })

  test('nonce uniqueness: two encryptions of same plaintext differ', () => {
    const reader = generateKeyPair()

    const enc1 = encryptMessage(plaintext, [reader.publicKey])
    const enc2 = encryptMessage(plaintext, [reader.publicKey])

    expect(enc1.encryptedContent).not.toBe(enc2.encryptedContent)
  })
})

// ── A3: decryptCallRecord — cross-boundary interop ──

describe('decryptCallRecord — cross-boundary interop', () => {
  const callMeta = { answeredBy: 'vol_abc123', callerNumber: '+15551234567' }

  // Use CryptoService.envelopeEncrypt (replaced deleted encryptCallRecordForStorage)
  function encryptCallRecord(metadata: Record<string, unknown>, adminPubkeys: string[]) {
    const { CryptoService } = require('../../server/lib/crypto-service')
    const svc = new CryptoService('a'.repeat(64), 'b'.repeat(64))
    const { encrypted, envelopes } = svc.envelopeEncrypt(
      JSON.stringify(metadata),
      adminPubkeys,
      LABEL_CALL_META
    )
    return { encryptedContent: encrypted, adminEnvelopes: envelopes }
  }

  test('roundtrip: server envelopeEncrypt → client decryptCallRecord', () => {
    const admin = generateKeyPair()

    const encrypted = encryptCallRecord(callMeta, [admin.publicKey])
    const decrypted = decryptCallRecord(
      encrypted.encryptedContent,
      encrypted.adminEnvelopes,
      admin.secretKey,
      admin.publicKey
    )

    expect(decrypted).toEqual(callMeta)
  })

  test('multi-admin: 2 admins each decrypt', () => {
    const admin1 = generateKeyPair()
    const admin2 = generateKeyPair()

    const encrypted = encryptCallRecord(callMeta, [admin1.publicKey, admin2.publicKey])

    const dec1 = decryptCallRecord(
      encrypted.encryptedContent,
      encrypted.adminEnvelopes,
      admin1.secretKey,
      admin1.publicKey
    )
    const dec2 = decryptCallRecord(
      encrypted.encryptedContent,
      encrypted.adminEnvelopes,
      admin2.secretKey,
      admin2.publicKey
    )

    expect(dec1).toEqual(callMeta)
    expect(dec2).toEqual(callMeta)
  })

  test('non-admin pubkey returns null', () => {
    const admin = generateKeyPair()
    const nonAdmin = generateKeyPair()

    const encrypted = encryptCallRecord(callMeta, [admin.publicKey])
    const result = decryptCallRecord(
      encrypted.encryptedContent,
      encrypted.adminEnvelopes,
      nonAdmin.secretKey,
      nonAdmin.publicKey
    )

    expect(result).toBeNull()
  })
})

// ── A4: decryptTranscription ──

describe('decryptTranscription', () => {
  const transcriptionText = 'This is a test transcription of the call.'

  function encryptTranscriptionManually(plaintext: string, recipientPubkey: string) {
    const ephemeral = generateKeyPair()
    const recipientCompressed = hexToBytes(`02${recipientPubkey}`)
    const shared = secp256k1.getSharedSecret(ephemeral.secretKey, recipientCompressed)
    const sharedX = shared.slice(1, 33)

    const labelBytes = utf8ToBytes(LABEL_TRANSCRIPTION)
    const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
    keyInput.set(labelBytes)
    keyInput.set(sharedX, labelBytes.length)
    const symmetricKey = sha256(keyInput)

    const nonce = new Uint8Array(24)
    crypto.getRandomValues(nonce)
    const ciphertext = xchacha20poly1305(symmetricKey, nonce).encrypt(utf8ToBytes(plaintext))

    const packed = new Uint8Array(nonce.length + ciphertext.length)
    packed.set(nonce)
    packed.set(ciphertext, nonce.length)

    const packedHex = bytesToHex(packed)
    const ephemeralPubkeyHex = bytesToHex(secp256k1.getPublicKey(ephemeral.secretKey, true))

    return { packedHex, ephemeralPubkeyHex }
  }

  test('roundtrip: manually ECDH-encrypt → decryptTranscription recovers plaintext', () => {
    const recipient = generateKeyPair()

    const { packedHex, ephemeralPubkeyHex } = encryptTranscriptionManually(
      transcriptionText,
      recipient.publicKey
    )

    const result = decryptTranscription(packedHex, ephemeralPubkeyHex, recipient.secretKey)
    expect(result).toBe(transcriptionText)
  })

  test('wrong key returns null', () => {
    const recipient = generateKeyPair()
    const wrongKey = generateKeyPair()

    const { packedHex, ephemeralPubkeyHex } = encryptTranscriptionManually(
      transcriptionText,
      recipient.publicKey
    )

    const result = decryptTranscription(packedHex, ephemeralPubkeyHex, wrongKey.secretKey)
    expect(result).toBeNull()
  })
})

// ── A5: encryptDraft / decryptDraft ──

describe('encryptDraft / decryptDraft', () => {
  const draftText = 'Draft note in progress — caller is describing situation...'

  test('roundtrip: encrypt → decrypt recovers original text', () => {
    const kp = generateKeyPair()

    const encrypted = encryptDraft(draftText, kp.secretKey)
    const decrypted = decryptDraft(encrypted, kp.secretKey)

    expect(decrypted).toBe(draftText)
  })

  test('wrong key returns null', () => {
    const kp = generateKeyPair()
    const wrongKey = generateKeyPair()

    const encrypted = encryptDraft(draftText, kp.secretKey)
    const result = decryptDraft(encrypted, wrongKey.secretKey)

    expect(result).toBeNull()
  })

  test('nonce uniqueness: two encryptions of same text differ', () => {
    const kp = generateKeyPair()

    const enc1 = encryptDraft(draftText, kp.secretKey)
    const enc2 = encryptDraft(draftText, kp.secretKey)

    expect(enc1).not.toBe(enc2)
  })
})

// ── A6: encryptExport ──

describe('encryptExport', () => {
  const exportJson = JSON.stringify({ notes: [{ text: 'Note 1' }], exportedAt: '2026-03-26' })

  test('returns Uint8Array', () => {
    const kp = generateKeyPair()
    const result = encryptExport(exportJson, kp.secretKey)

    expect(result).toBeInstanceOf(Uint8Array)
    // nonce(24) + ciphertext(json.length + 16 poly1305 tag)
    expect(result.length).toBeGreaterThan(24)
  })

  test('manual decrypt roundtrip: derive key with HKDF then XChaCha20 decrypt', () => {
    const kp = generateKeyPair()
    const packed = encryptExport(exportJson, kp.secretKey)

    // Derive the same key the function uses
    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, kp.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)

    const nonce = packed.slice(0, 24)
    const ciphertext = packed.slice(24)
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = new TextDecoder().decode(cipher.decrypt(ciphertext))

    expect(plaintext).toBe(exportJson)
  })

  test('wrong key fails to decrypt', () => {
    const kp = generateKeyPair()
    const wrongKey = generateKeyPair()
    const packed = encryptExport(exportJson, kp.secretKey)

    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, wrongKey.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)

    const nonce = packed.slice(0, 24)
    const ciphertext = packed.slice(24)
    const cipher = xchacha20poly1305(key, nonce)

    expect(() => cipher.decrypt(ciphertext)).toThrow()
  })
})

// ── A7: decryptNote legacy V1 ──

describe('decryptNote (legacy V1)', () => {
  const legacyText = 'Legacy V1 note content'

  function encryptLegacyV1(text: string, secretKey: Uint8Array): string {
    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, secretKey, salt, utf8ToBytes(HKDF_CONTEXT_NOTES), 32)
    const nonce = new Uint8Array(24)
    crypto.getRandomValues(nonce)
    const cipher = xchacha20poly1305(key, nonce)
    const payload: NotePayload = { text }
    const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(payload)))

    const packed = new Uint8Array(nonce.length + ciphertext.length)
    packed.set(nonce)
    packed.set(ciphertext, nonce.length)
    return bytesToHex(packed)
  }

  test('roundtrip: manually encrypt with HKDF-derived key → decryptNote recovers payload', () => {
    const kp = generateKeyPair()

    const encrypted = encryptLegacyV1(legacyText, kp.secretKey)
    const decrypted = decryptNote(encrypted, kp.secretKey)

    expect(decrypted).toEqual({ text: legacyText })
  })

  test('wrong key returns null', () => {
    const kp = generateKeyPair()
    const wrongKey = generateKeyPair()

    const encrypted = encryptLegacyV1(legacyText, kp.secretKey)
    const result = decryptNote(encrypted, wrongKey.secretKey)

    expect(result).toBeNull()
  })
})
