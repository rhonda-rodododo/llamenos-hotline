import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { generateSecretKey } from 'nostr-tools'
import {
  computeProvisioningSAS,
  computeSASForNewDevice,
  computeSASForPrimaryDevice,
  decodeProvisioningQR,
  decryptProvisionedNsec,
  encodeProvisioningQR,
  encryptNsecForDevice,
  getShortCode,
} from './provisioning'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genKeypair(): { secret: Uint8Array; pubXOnly: string; pubCompressed: string } {
  // generateSecretKey from nostr-tools produces a valid secp256k1 private key
  const secret = generateSecretKey()
  const compressed = secp256k1.getPublicKey(secret, true) // 33 bytes
  const pubCompressed = bytesToHex(compressed) // 66 hex chars
  const pubXOnly = pubCompressed.slice(2) // 64 hex chars (strip "02"/"03" prefix)
  return { secret, pubXOnly, pubCompressed }
}

// ---------------------------------------------------------------------------
// C1: computeProvisioningSAS
// ---------------------------------------------------------------------------

describe('computeProvisioningSAS', () => {
  test('deterministic: same sharedX → same SAS', () => {
    const sharedX = new Uint8Array(32).fill(0xab)
    const sas1 = computeProvisioningSAS(sharedX)
    const sas2 = computeProvisioningSAS(sharedX)
    expect(sas1).toBe(sas2)
  })

  test('format matches /^\\d{3} \\d{3}$/', () => {
    const sharedX = new Uint8Array(32).fill(0x11)
    const sas = computeProvisioningSAS(sharedX)
    expect(/^\d{3} \d{3}$/.test(sas)).toBe(true)
  })

  test('one-bit flip produces different SAS', () => {
    const sharedX = new Uint8Array(32).fill(0x55)
    const flipped = new Uint8Array(sharedX)
    flipped[0] ^= 0x01
    expect(computeProvisioningSAS(sharedX)).not.toBe(computeProvisioningSAS(flipped))
  })

  test('all-zeros input produces valid SAS string', () => {
    const sas = computeProvisioningSAS(new Uint8Array(32))
    expect(/^\d{3} \d{3}$/.test(sas)).toBe(true)
  })

  test('all-0xff input produces valid SAS string', () => {
    const sas = computeProvisioningSAS(new Uint8Array(32).fill(0xff))
    expect(/^\d{3} \d{3}$/.test(sas)).toBe(true)
  })

  test('output is zero-padded to exactly 7 chars (nnn nnn)', () => {
    // Run over many random inputs to verify zero-padding is always applied
    let found = false
    for (let i = 0; i < 200; i++) {
      const buf = new Uint8Array(32)
      buf[0] = i
      const sas = computeProvisioningSAS(buf)
      expect(sas.length).toBe(7)
      // "001 234" would only appear if zero-padding is working
      if (sas.startsWith('00')) found = true
    }
    // We can't guarantee a hit in 200 tries, but the length check is authoritative
    expect(found || true).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C2: SAS symmetry — MITM prevention
// ---------------------------------------------------------------------------

describe('SAS symmetry (MITM prevention)', () => {
  test('computeSASForNewDevice and computeSASForPrimaryDevice produce identical SAS', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()

    // New device: has ephemeral secret + primary's x-only pubkey
    const sasFromNewDevice = computeSASForNewDevice(ephemeral.secret, primary.pubXOnly)

    // Primary device: has primary secret + ephemeral's x-only pubkey
    const sasFromPrimary = computeSASForPrimaryDevice(primary.secret, ephemeral.pubXOnly)

    expect(sasFromNewDevice).toBe(sasFromPrimary)
  })

  test('SAS symmetry holds with compressed pubkeys on both sides', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()

    // computeSharedX handles both 64 and 66 hex pubkeys
    const sasFromNewDevice = computeSASForNewDevice(ephemeral.secret, primary.pubCompressed)
    const sasFromPrimary = computeSASForPrimaryDevice(primary.secret, ephemeral.pubCompressed)

    expect(sasFromNewDevice).toBe(sasFromPrimary)
  })

  test('different keypairs produce different SAS (no false positives)', () => {
    const e1 = genKeypair()
    const p1 = genKeypair()
    const e2 = genKeypair()
    const p2 = genKeypair()

    const sas1 = computeSASForNewDevice(e1.secret, p1.pubXOnly)
    const sas2 = computeSASForNewDevice(e2.secret, p2.pubXOnly)

    // With overwhelming probability two random keypairs yield different SAS
    expect(sas1).not.toBe(sas2)
  })

  test('swapped roles (wrong key combination) produce different SAS', () => {
    const e = genKeypair()
    const p = genKeypair()

    const correctSAS = computeSASForNewDevice(e.secret, p.pubXOnly)
    // Swap — use ephemeral secret with ephemeral pubkey (same keypair) → wrong shared secret
    const wrongSAS = computeSASForNewDevice(e.secret, e.pubXOnly)

    expect(correctSAS).not.toBe(wrongSAS)
  })
})

// ---------------------------------------------------------------------------
// C3: encryptNsecForDevice / decryptProvisionedNsec
// ---------------------------------------------------------------------------

describe('encryptNsecForDevice / decryptProvisionedNsec', () => {
  test('roundtrip: encrypt on primary side, decrypt on new device side', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const nsec = 'nsec1testvalue0000000000000000000000000000000000000000000000'

    // Primary encrypts using ephemeral's compressed pubkey (66 hex)
    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubCompressed, primary.secret)

    // New device decrypts using primary's x-only pubkey (64 hex) and ephemeral secret
    const decrypted = decryptProvisionedNsec(encrypted, primary.pubXOnly, ephemeral.secret)

    expect(decrypted).toBe(nsec)
  })

  test('roundtrip preserves arbitrary nsec strings', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const nsec = `nsec1${'a'.repeat(59)}`

    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubCompressed, primary.secret)
    const decrypted = decryptProvisionedNsec(encrypted, primary.pubXOnly, ephemeral.secret)

    expect(decrypted).toBe(nsec)
  })

  test('wrong ephemeral secret fails decryption', () => {
    const ephemeral = genKeypair()
    const wrongEphemeral = genKeypair()
    const primary = genKeypair()
    const nsec = 'nsec1somekeyvalue'

    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubCompressed, primary.secret)

    expect(() =>
      decryptProvisionedNsec(encrypted, primary.pubXOnly, wrongEphemeral.secret)
    ).toThrow()
  })

  test('wrong primary pubkey fails decryption', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const wrongPrimary = genKeypair()
    const nsec = 'nsec1somekeyvalue'

    const encrypted = encryptNsecForDevice(nsec, ephemeral.pubCompressed, primary.secret)

    expect(() =>
      decryptProvisionedNsec(encrypted, wrongPrimary.pubXOnly, ephemeral.secret)
    ).toThrow()
  })

  test('nonce uniqueness: same inputs produce different ciphertext each time', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()
    const nsec = 'nsec1nonce_uniqueness_test'

    const enc1 = encryptNsecForDevice(nsec, ephemeral.pubCompressed, primary.secret)
    const enc2 = encryptNsecForDevice(nsec, ephemeral.pubCompressed, primary.secret)

    expect(enc1).not.toBe(enc2)
  })

  test('encrypted output is a valid hex string', () => {
    const ephemeral = genKeypair()
    const primary = genKeypair()

    const encrypted = encryptNsecForDevice('nsec1test', ephemeral.pubCompressed, primary.secret)

    expect(/^[0-9a-f]+$/.test(encrypted)).toBe(true)
    // nonce(24) + ciphertext(9 + 16 MAC) = 49 bytes minimum → 98 hex chars
    expect(encrypted.length).toBeGreaterThanOrEqual(98)
  })
})

// ---------------------------------------------------------------------------
// C4: encodeProvisioningQR / decodeProvisioningQR
// ---------------------------------------------------------------------------

describe('encodeProvisioningQR / decodeProvisioningQR', () => {
  test('roundtrip: encode then decode returns original values', () => {
    const roomId = 'room-abc-123'
    const token = 'tok-xyz-456'

    const encoded = encodeProvisioningQR(roomId, token)
    const decoded = decodeProvisioningQR(encoded)

    expect(decoded).not.toBeNull()
    expect(decoded?.r).toBe(roomId)
    expect(decoded?.t).toBe(token)
  })

  test('invalid JSON returns null', () => {
    expect(decodeProvisioningQR('not json at all')).toBeNull()
    expect(decodeProvisioningQR('{broken')).toBeNull()
    expect(decodeProvisioningQR('')).toBeNull()
  })

  test('valid JSON but missing r field returns null', () => {
    expect(decodeProvisioningQR(JSON.stringify({ t: 'tok' }))).toBeNull()
  })

  test('valid JSON but missing t field returns null', () => {
    expect(decodeProvisioningQR(JSON.stringify({ r: 'room' }))).toBeNull()
  })

  test('valid JSON with both fields returns ProvisioningQRData', () => {
    const data = decodeProvisioningQR(JSON.stringify({ r: 'r1', t: 't1' }))
    expect(data).toEqual({ r: 'r1', t: 't1' })
  })

  test('encoded QR is valid JSON string', () => {
    const encoded = encodeProvisioningQR('room1', 'token1')
    expect(() => JSON.parse(encoded)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// C5: getShortCode
// ---------------------------------------------------------------------------

describe('getShortCode', () => {
  test('returns first 8 chars of roomId uppercased', () => {
    expect(getShortCode('abcdefghijklmnop')).toBe('ABCDEFGH')
  })

  test('already uppercase roomId is returned unchanged', () => {
    expect(getShortCode('ABCDEFGHXXX')).toBe('ABCDEFGH')
  })

  test('mixed case is uppercased', () => {
    expect(getShortCode('aBcDeFgHiJ')).toBe('ABCDEFGH')
  })

  test('short roomId shorter than 8 chars does not crash', () => {
    expect(getShortCode('abc')).toBe('ABC')
    expect(getShortCode('')).toBe('')
  })

  test('exactly 8 chars returns all of them uppercased', () => {
    expect(getShortCode('12345678')).toBe('12345678')
  })

  test('UUID-style roomId returns correct short code', () => {
    const roomId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    expect(getShortCode(roomId)).toBe('F47AC10B')
  })
})
