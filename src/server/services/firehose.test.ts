import { describe, expect, it } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { FirehoseService } from './firehose'

import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'

// Minimal mocks — these methods don't touch db or crypto service
const mockDb = {} as Database
const mockCrypto = {} as CryptoService

describe('FirehoseService', () => {
  it('should be constructable', () => {
    // Just verify the class can be constructed — real DB tests are in API E2E
    expect(FirehoseService).toBeDefined()
    expect(typeof FirehoseService).toBe('function')
  })
})

describe('generateAgentKeypair / unsealAgentNsec', () => {
  it('should generate keypair and round-trip seal/unseal', () => {
    const service = new FirehoseService(mockDb as never, mockCrypto as never)
    const sealKey = 'a'.repeat(64) // 32 bytes hex
    const connectionId = 'test-connection-123'

    const { pubkey, encryptedNsec } = service.generateAgentKeypair(connectionId, sealKey)

    expect(pubkey).toHaveLength(64) // 32 bytes x-only pubkey hex
    expect(encryptedNsec.length).toBeGreaterThan(0)

    const nsecHex = service.unsealAgentNsec(connectionId, encryptedNsec, sealKey)
    expect(nsecHex).toHaveLength(64) // 32 bytes nsec hex

    // Verify the unsealed nsec derives back to the same pubkey
    const derivedPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(nsecHex)))
    expect(derivedPubkey).toBe(pubkey)
  })

  it('should produce different encryptedNsec for different connectionIds', () => {
    const service = new FirehoseService(mockDb as never, mockCrypto as never)
    const sealKey = 'b'.repeat(64)

    const result1 = service.generateAgentKeypair('conn-1', sealKey)
    const result2 = service.generateAgentKeypair('conn-2', sealKey)

    // Different connections → different keypairs and different sealed blobs
    expect(result1.pubkey).not.toBe(result2.pubkey)
    expect(result1.encryptedNsec).not.toBe(result2.encryptedNsec)
  })

  it('should fail to unseal with wrong connectionId', () => {
    const service = new FirehoseService(mockDb as never, mockCrypto as never)
    const sealKey = 'c'.repeat(64)
    const connectionId = 'correct-connection'

    const { encryptedNsec } = service.generateAgentKeypair(connectionId, sealKey)

    // Wrong connectionId → different derived key → AEAD auth tag fails
    expect(() => service.unsealAgentNsec('wrong-connection', encryptedNsec, sealKey)).toThrow()
  })

  it('should fail to unseal with wrong sealKey', () => {
    const service = new FirehoseService(mockDb as never, mockCrypto as never)
    const sealKey = 'd'.repeat(64)
    const wrongKey = 'e'.repeat(64)
    const connectionId = 'some-connection'

    const { encryptedNsec } = service.generateAgentKeypair(connectionId, sealKey)

    // Wrong sealKey → different derived key → AEAD auth tag fails
    expect(() => service.unsealAgentNsec(connectionId, encryptedNsec, wrongKey)).toThrow()
  })
})
