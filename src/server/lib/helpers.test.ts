import { describe, expect, test } from 'bun:test'
import {
  error,
  extractPathParam,
  isValidE164,
  json,
  telephonyResponse,
  uint8ArrayToBase64URL,
} from './helpers'

describe('isValidE164', () => {
  test('accepts valid E.164 numbers', () => {
    expect(isValidE164('+1234567890')).toBe(true)
    expect(isValidE164('+442071234567')).toBe(true)
    expect(isValidE164('+1234567')).toBe(true) // minimum 7 digits
    expect(isValidE164('+123456789012345')).toBe(true) // maximum 15 digits
  })

  test('rejects numbers without +', () => {
    expect(isValidE164('1234567890')).toBe(false)
  })

  test('rejects numbers that are too short', () => {
    expect(isValidE164('+123456')).toBe(false) // 6 digits
  })

  test('rejects numbers that are too long', () => {
    expect(isValidE164('+1234567890123456')).toBe(false) // 16 digits
  })

  test('rejects numbers with non-digit characters', () => {
    expect(isValidE164('+1234-567-890')).toBe(false)
    expect(isValidE164('+123 456 7890')).toBe(false)
    expect(isValidE164('+123abc7890')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidE164('')).toBe(false)
  })
})

describe('extractPathParam', () => {
  test('extracts param after prefix', () => {
    expect(extractPathParam('/api/users/abc123', '/api/users/')).toBe('abc123')
  })

  test('returns null when no match', () => {
    expect(extractPathParam('/api/other', '/api/users/')).toBeNull()
  })

  test('rejects path traversal (nested slashes)', () => {
    expect(extractPathParam('/api/users/abc/def', '/api/users/')).toBeNull()
  })

  test('returns null for empty param', () => {
    expect(extractPathParam('/api/users/', '/api/users/')).toBeNull()
  })
})

describe('json', () => {
  test('returns JSON response with default 200 status', async () => {
    const res = json({ foo: 'bar' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ foo: 'bar' })
  })

  test('returns JSON response with custom status', async () => {
    const res = json({ created: true }, 201)
    expect(res.status).toBe(201)
  })
})

describe('error', () => {
  test('returns error JSON with default 400 status', async () => {
    const res = error('Bad input')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ error: 'Bad input' })
  })

  test('returns error JSON with custom status', async () => {
    const res = error('Not found', 404)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Not found' })
  })
})

describe('uint8ArrayToBase64URL', () => {
  test('encodes empty array', () => {
    expect(uint8ArrayToBase64URL(new Uint8Array([]))).toBe('')
  })

  test('encodes known bytes to base64url', () => {
    // "Hello" in bytes
    const bytes = new Uint8Array([72, 101, 108, 108, 111])
    const result = uint8ArrayToBase64URL(bytes)
    // Standard base64 of "Hello" is "SGVsbG8=" -> base64url removes padding
    expect(result).toBe('SGVsbG8')
  })

  test('replaces + with - and / with _', () => {
    // Bytes that produce + and / in standard base64
    const bytes = new Uint8Array([251, 239, 190]) // base64: "u--+" -> "u--+"
    const result = uint8ArrayToBase64URL(bytes)
    expect(result).not.toContain('+')
    expect(result).not.toContain('/')
    expect(result).not.toContain('=')
  })
})

describe('telephonyResponse', () => {
  test('creates response with correct content type and body', async () => {
    const res = telephonyResponse({
      contentType: 'application/xml',
      body: '<Response><Say>Hello</Say></Response>',
    })
    expect(res.headers.get('Content-Type')).toBe('application/xml')
    const text = await res.text()
    expect(text).toBe('<Response><Say>Hello</Say></Response>')
  })
})
