import { describe, expect, test } from 'bun:test'
import type { AuthPayload } from '../types'
import { parseAuthHeader, parseSessionHeader, validateToken, verifyAuthToken } from './auth'

// ---------------------------------------------------------------------------
// parseAuthHeader
// ---------------------------------------------------------------------------

describe('parseAuthHeader', () => {
  test('parses valid Bearer {json} into AuthPayload', () => {
    const payload: AuthPayload = {
      pubkey: 'abcd1234',
      timestamp: Date.now(),
      token: 'deadbeef',
    }
    const header = `Bearer ${JSON.stringify(payload)}`
    const result = parseAuthHeader(header)
    expect(result).toEqual(payload)
  })

  test('returns null for missing header (null input)', () => {
    expect(parseAuthHeader(null)).toBeNull()
  })

  test('returns null for non-Bearer prefix', () => {
    const payload = JSON.stringify({ pubkey: 'abc', timestamp: 1, token: 'tok' })
    expect(parseAuthHeader(`Token ${payload}`)).toBeNull()
    expect(parseAuthHeader(`Basic ${payload}`)).toBeNull()
    expect(parseAuthHeader(payload)).toBeNull()
  })

  test('returns null for malformed JSON', () => {
    expect(parseAuthHeader('Bearer not-json')).toBeNull()
    expect(parseAuthHeader('Bearer {broken')).toBeNull()
    expect(parseAuthHeader('Bearer ')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseSessionHeader
// ---------------------------------------------------------------------------

describe('parseSessionHeader', () => {
  test('extracts token from Session header', () => {
    expect(parseSessionHeader('Session abc123token')).toBe('abc123token')
  })

  test('trims whitespace from extracted token', () => {
    expect(parseSessionHeader('Session   abc123token  ')).toBe('abc123token')
  })

  test('returns null for missing header', () => {
    expect(parseSessionHeader(null)).toBeNull()
  })

  test('returns null for non-Session prefix', () => {
    expect(parseSessionHeader('Bearer abc123token')).toBeNull()
    expect(parseSessionHeader('Token abc123token')).toBeNull()
    expect(parseSessionHeader('abc123token')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateToken
// ---------------------------------------------------------------------------

describe('validateToken', () => {
  const now = Date.now()

  test('accepts token with current timestamp', () => {
    const auth: AuthPayload = { pubkey: 'abc', timestamp: now, token: 'tok' }
    expect(validateToken(auth)).toBe(true)
  })

  test('accepts 4-minute-old token (within 5-min window)', () => {
    const fourMinutesAgo = now - 4 * 60 * 1000
    const auth: AuthPayload = { pubkey: 'abc', timestamp: fourMinutesAgo, token: 'tok' }
    expect(validateToken(auth)).toBe(true)
  })

  test('rejects 6-minute-old token (expired)', () => {
    const sixMinutesAgo = now - 6 * 60 * 1000
    const auth: AuthPayload = { pubkey: 'abc', timestamp: sixMinutesAgo, token: 'tok' }
    expect(validateToken(auth)).toBe(false)
  })

  test('rejects 6-minute-future token', () => {
    const sixMinutesFromNow = now + 6 * 60 * 1000
    const auth: AuthPayload = { pubkey: 'abc', timestamp: sixMinutesFromNow, token: 'tok' }
    expect(validateToken(auth)).toBe(false)
  })

  test('rejects when pubkey is empty string', () => {
    const auth: AuthPayload = { pubkey: '', timestamp: now, token: 'tok' }
    expect(validateToken(auth)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// verifyAuthToken — client↔server cross-validation
// ---------------------------------------------------------------------------

describe('verifyAuthToken — client↔server cross-validation', () => {
  test('valid roundtrip: client createAuthToken verified by server verifyAuthToken', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const method = 'POST'
    const path = '/api/notes'

    const jsonToken = createAuthToken(kp.secretKey, timestamp, method, path)
    const auth: AuthPayload = JSON.parse(jsonToken)

    expect(await verifyAuthToken(auth, method, path)).toBe(true)
  })

  test('wrong pubkey → false', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const wrongKp = generateKeyPair()
    const timestamp = Date.now()
    const method = 'GET'
    const path = '/api/calls'

    const jsonToken = createAuthToken(kp.secretKey, timestamp, method, path)
    const auth: AuthPayload = JSON.parse(jsonToken)
    // Replace pubkey with a different key pair's pubkey
    const tampered: AuthPayload = { ...auth, pubkey: wrongKp.publicKey }

    expect(await verifyAuthToken(tampered, method, path)).toBe(false)
  })

  test('tampered signature (flip last byte) → false', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const method = 'PUT'
    const path = '/api/settings'

    const jsonToken = createAuthToken(kp.secretKey, timestamp, method, path)
    const auth: AuthPayload = JSON.parse(jsonToken)

    // Flip the last byte of the hex token
    const tokenBytes = Buffer.from(auth.token, 'hex')
    tokenBytes[tokenBytes.length - 1] ^= 0xff
    const tampered: AuthPayload = { ...auth, token: tokenBytes.toString('hex') }

    expect(await verifyAuthToken(tampered, method, path)).toBe(false)
  })

  test('wrong method (created for GET, verified for POST) → false', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const path = '/api/volunteers'

    const jsonToken = createAuthToken(kp.secretKey, timestamp, 'GET', path)
    const auth: AuthPayload = JSON.parse(jsonToken)

    expect(await verifyAuthToken(auth, 'POST', path)).toBe(false)
  })

  test('wrong path → false', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()
    const method = 'DELETE'

    const jsonToken = createAuthToken(kp.secretKey, timestamp, method, '/api/bans/123')
    const auth: AuthPayload = JSON.parse(jsonToken)

    expect(await verifyAuthToken(auth, method, '/api/bans/456')).toBe(false)
  })

  test('missing method → false', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()

    const jsonToken = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/notes')
    const auth: AuthPayload = JSON.parse(jsonToken)

    expect(await verifyAuthToken(auth, undefined, '/api/notes')).toBe(false)
  })

  test('missing path → false', async () => {
    const { createAuthToken, generateKeyPair } = await import('../../client/lib/crypto')
    const kp = generateKeyPair()
    const timestamp = Date.now()

    const jsonToken = createAuthToken(kp.secretKey, timestamp, 'GET', '/api/notes')
    const auth: AuthPayload = JSON.parse(jsonToken)

    expect(await verifyAuthToken(auth, 'GET', undefined)).toBe(false)
  })
})
