import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_FILE_KEY } from '@shared/crypto-labels'
import { eciesWrapKey, generateKeyPair } from './crypto'
import {
  decryptFile,
  decryptFileMetadata,
  encryptFile,
  rewrapFileKey,
  unwrapFileKey,
} from './file-crypto'

// --- C3: unwrapFileKey ---

describe('unwrapFileKey', () => {
  test('recovers key wrapped with eciesWrapKey + LABEL_FILE_KEY', () => {
    const { secretKey, publicKey } = generateKeyPair()
    const originalKey = new Uint8Array(32)
    crypto.getRandomValues(originalKey)

    const envelope = eciesWrapKey(originalKey, publicKey, LABEL_FILE_KEY)
    const recovered = unwrapFileKey(envelope.wrappedKey, envelope.ephemeralPubkey, secretKey)

    expect(recovered).toEqual(originalKey)
  })

  test('throws with wrong secret key', () => {
    const { publicKey } = generateKeyPair()
    const { secretKey: wrongSecretKey } = generateKeyPair()
    const originalKey = new Uint8Array(32)
    crypto.getRandomValues(originalKey)

    const envelope = eciesWrapKey(originalKey, publicKey, LABEL_FILE_KEY)

    expect(() =>
      unwrapFileKey(envelope.wrappedKey, envelope.ephemeralPubkey, wrongSecretKey)
    ).toThrow()
  })
})

// --- C1: encryptFile / decryptFile ---

describe('encryptFile / decryptFile', () => {
  test('roundtrip: bytes match original', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const originalBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const file = new File([originalBytes], 'test.txt', { type: 'text/plain' })

    const encrypted = await encryptFile(file, [publicKey])
    const envelope = encrypted.recipientEnvelopes[0]

    const result = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      envelope,
      secretKey
    )

    const decryptedBytes = new Uint8Array(await result.blob.arrayBuffer())
    expect(decryptedBytes).toEqual(originalBytes)
  })

  test('checksum matches SHA-256 of original plaintext', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const originalBytes = new Uint8Array([10, 20, 30, 40, 50])
    const file = new File([originalBytes], 'data.bin', { type: 'application/octet-stream' })

    const encrypted = await encryptFile(file, [publicKey])
    const envelope = encrypted.recipientEnvelopes[0]

    const result = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      envelope,
      secretKey
    )

    const expectedChecksum = bytesToHex(sha256(originalBytes))
    expect(result.checksum).toBe(expectedChecksum)
  })

  test('multi-recipient: each recipient can decrypt the same content', async () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    const originalBytes = new Uint8Array([99, 88, 77, 66, 55])
    const file = new File([originalBytes], 'shared.txt', { type: 'text/plain' })

    const encrypted = await encryptFile(file, [kp1.publicKey, kp2.publicKey])

    const envelope1 = encrypted.recipientEnvelopes.find((e) => e.pubkey === kp1.publicKey)
    const envelope2 = encrypted.recipientEnvelopes.find((e) => e.pubkey === kp2.publicKey)
    expect(envelope1).toBeDefined()
    expect(envelope2).toBeDefined()

    const result1 = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      envelope1!,
      kp1.secretKey
    )
    const result2 = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      envelope2!,
      kp2.secretKey
    )

    const bytes1 = new Uint8Array(await result1.blob.arrayBuffer())
    const bytes2 = new Uint8Array(await result2.blob.arrayBuffer())
    expect(bytes1).toEqual(originalBytes)
    expect(bytes2).toEqual(originalBytes)
    expect(result1.checksum).toBe(result2.checksum)
  })

  test('wrong key throws during decryptFile', async () => {
    const { publicKey } = generateKeyPair()
    const { secretKey: wrongSecretKey } = generateKeyPair()
    const file = new File([new Uint8Array([1, 2, 3])], 'secret.txt', { type: 'text/plain' })

    const encrypted = await encryptFile(file, [publicKey])
    const envelope = encrypted.recipientEnvelopes[0]

    await expect(
      decryptFile(encrypted.encryptedContent.buffer as ArrayBuffer, envelope, wrongSecretKey)
    ).rejects.toThrow()
  })
})

// --- C2: decryptFileMetadata (via encryptFile) ---

describe('decryptFileMetadata', () => {
  test('recovers original metadata after encryptFile', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const originalBytes = new Uint8Array([1, 2, 3])
    const file = new File([originalBytes], 'photo.png', { type: 'image/png' })

    const encrypted = await encryptFile(file, [publicKey])
    const metaItem = encrypted.encryptedMetadata[0]

    const metadata = decryptFileMetadata(
      metaItem.encryptedContent,
      metaItem.ephemeralPubkey,
      secretKey
    )

    expect(metadata).not.toBeNull()
    expect(metadata?.originalName).toBe('photo.png')
    expect(metadata?.mimeType).toBe('image/png')
    expect(metadata?.size).toBe(originalBytes.length)
    expect(typeof metadata?.checksum).toBe('string')
    expect(metadata?.checksum).toHaveLength(64) // SHA-256 hex
  })

  test('returns null with wrong key', async () => {
    const { publicKey } = generateKeyPair()
    const { secretKey: wrongSecretKey } = generateKeyPair()
    const file = new File([new Uint8Array([5, 6, 7])], 'test.txt', { type: 'text/plain' })

    const encrypted = await encryptFile(file, [publicKey])
    const metaItem = encrypted.encryptedMetadata[0]

    const result = decryptFileMetadata(
      metaItem.encryptedContent,
      metaItem.ephemeralPubkey,
      wrongSecretKey
    )
    expect(result).toBeNull()
  })
})

// --- C4: rewrapFileKey ---

describe('rewrapFileKey', () => {
  test('admin rewraps file key for volunteer who can then decrypt content', async () => {
    const admin = generateKeyPair()
    const volunteer = generateKeyPair()
    const originalBytes = new Uint8Array([11, 22, 33, 44, 55])
    const file = new File([originalBytes], 'report.txt', { type: 'text/plain' })

    // Admin encrypts the file
    const encrypted = await encryptFile(file, [admin.publicKey])
    const adminEnvelope = encrypted.recipientEnvelopes[0]

    // Admin rewraps the key for the volunteer
    const volunteerEnvelope = rewrapFileKey(
      adminEnvelope.encryptedFileKey,
      adminEnvelope.ephemeralPubkey,
      admin.secretKey,
      volunteer.publicKey
    )

    // Volunteer uses the rewrapped envelope to decrypt
    const result = await decryptFile(
      encrypted.encryptedContent.buffer as ArrayBuffer,
      volunteerEnvelope,
      volunteer.secretKey
    )

    const decryptedBytes = new Uint8Array(await result.blob.arrayBuffer())
    expect(decryptedBytes).toEqual(originalBytes)
  })
})
