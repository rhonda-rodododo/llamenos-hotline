import { describe, expect, test } from 'bun:test'
import { decryptHubField } from './hub-field-crypto'
import { clearHubKeyCache } from './hub-key-cache'

// Ensure the module-level hub key cache is empty so getHubKeyForId returns null.
// Every test runs with no hub key loaded, exercising the fallback path
// that distinguishes ciphertext from plaintext via looksLikeCiphertext.
clearHubKeyCache()

const HUB_ID = 'test-hub'

describe('decryptHubField ciphertext detection (no hub key)', () => {
  test('valid-shape hex ciphertext → returns placeholder', () => {
    clearHubKeyCache()
    // 48+ chars, even length, all hex → treated as ciphertext
    const hex = 'a'.repeat(80)
    const result = decryptHubField(hex, HUB_ID, 'PLACEHOLDER')
    expect(result).toBe('PLACEHOLDER')
  })

  test('longer valid-shape hex ciphertext → returns placeholder (not leaked)', () => {
    clearHubKeyCache()
    const hex = '0123456789abcdef'.repeat(8) // 128 chars, even, all hex
    const result = decryptHubField(hex, HUB_ID, 'PLACEHOLDER')
    expect(result).toBe('PLACEHOLDER')
  })

  test('plaintext "Hub Admin" → returns input (not hex)', () => {
    clearHubKeyCache()
    const result = decryptHubField('Hub Admin', HUB_ID, 'PLACEHOLDER')
    expect(result).toBe('Hub Admin')
  })

  test('odd-length hex → treated as plaintext, returned as-is', () => {
    clearHubKeyCache()
    const oddHex = 'a'.repeat(81) // odd length, fails even-length check
    const result = decryptHubField(oddHex, HUB_ID, 'PLACEHOLDER')
    expect(result).toBe(oddHex)
  })

  test('short hex (< 48 chars) → treated as plaintext, returned as-is', () => {
    clearHubKeyCache()
    const shortHex = 'deadbeef' // 8 chars, below 48 threshold
    const result = decryptHubField(shortHex, HUB_ID, 'PLACEHOLDER')
    expect(result).toBe(shortHex)
  })

  test('short hex 46 chars (just below 48) → treated as plaintext', () => {
    clearHubKeyCache()
    const justUnder = 'a'.repeat(46)
    const result = decryptHubField(justUnder, HUB_ID, 'PLACEHOLDER')
    expect(result).toBe(justUnder)
  })

  test('hex with non-hex chars → treated as plaintext', () => {
    clearHubKeyCache()
    // Long enough & even length but contains 'z' — not valid hex
    const bogus = `${'a'.repeat(47)}z`
    const result = decryptHubField(bogus, HUB_ID, 'PLACEHOLDER')
    expect(result).toBe(bogus)
  })

  test('null → returns placeholder', () => {
    clearHubKeyCache()
    expect(decryptHubField(null, HUB_ID, 'PLACEHOLDER')).toBe('PLACEHOLDER')
  })

  test('undefined → returns placeholder', () => {
    clearHubKeyCache()
    expect(decryptHubField(undefined, HUB_ID, 'PLACEHOLDER')).toBe('PLACEHOLDER')
  })

  test('empty string → returns placeholder', () => {
    clearHubKeyCache()
    expect(decryptHubField('', HUB_ID, 'PLACEHOLDER')).toBe('PLACEHOLDER')
  })
})
