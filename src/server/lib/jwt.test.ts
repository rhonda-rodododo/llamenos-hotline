import { describe, expect, test } from 'bun:test'
import { signAccessToken, verifyAccessToken } from './jwt'

describe('JWT utilities', () => {
  const secret = '0'.repeat(64)
  const pubkey = 'a'.repeat(64)

  test('signAccessToken returns a JWT string', async () => {
    const token = await signAccessToken({ pubkey, permissions: ['calls:answer'] }, secret)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  test('verifyAccessToken decodes a valid token', async () => {
    const token = await signAccessToken({ pubkey, permissions: ['calls:answer'] }, secret)
    const payload = await verifyAccessToken(token, secret)
    expect(payload.sub).toBe(pubkey)
    expect(payload.permissions).toContain('calls:answer')
  })

  test('verifyAccessToken includes jti claim', async () => {
    const token = await signAccessToken({ pubkey, permissions: [] }, secret)
    const payload = await verifyAccessToken(token, secret)
    expect(payload.jti).toBeDefined()
    expect(typeof payload.jti).toBe('string')
  })

  test('verifyAccessToken rejects expired token', async () => {
    const token = await signAccessToken({ pubkey, permissions: [] }, secret, { expiresIn: '1s' })
    await new Promise((r) => setTimeout(r, 1500))
    await expect(verifyAccessToken(token, secret)).rejects.toThrow()
  })

  test('verifyAccessToken rejects tampered token', async () => {
    const token = await signAccessToken({ pubkey, permissions: [] }, secret)
    const tampered = `${token.slice(0, -5)}XXXXX`
    await expect(verifyAccessToken(tampered, secret)).rejects.toThrow()
  })

  test('verifyAccessToken rejects wrong secret', async () => {
    const token = await signAccessToken({ pubkey, permissions: [] }, secret)
    await expect(verifyAccessToken(token, '1'.repeat(64))).rejects.toThrow()
  })
})
