/**
 * Signal contact API E2E tests.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Signal contact API', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('/api/health/live', { timeout: 5000 })
      if (!res.ok()) test.skip(true, 'Server not reachable')
    } catch {
      test.skip(true, 'Server not reachable')
    }
  })

  test('GET /signal-contact returns null initially', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/signal-contact')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.contact).toBeNull()
  })

  test('GET /signal-contact/register-token returns token', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/signal-contact/register-token')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    expect(body.notifierUrl).toBeTruthy()
    // Token format: pubkey:nonce:expiresAt:hmac
    expect(body.token.split(':').length).toBe(4)
  })

  test('GET /signal-contact/hmac-key returns per-user hex key', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/signal-contact/hmac-key')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.key).toMatch(/^[0-9a-f]{64}$/)
  })

  test('POST /signal-contact rejects invalid token', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.post('/api/auth/signal-contact', {
      identifierHash: 'a'.repeat(64),
      identifierCiphertext: 'deadbeef',
      identifierEnvelope: [],
      identifierType: 'phone',
      bridgeRegistrationToken: 'bogus:token:fields:here',
    })
    expect(res.status()).toBe(401)
  })

  test('POST /signal-contact rejects malformed token', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.post('/api/auth/signal-contact', {
      identifierHash: 'a'.repeat(64),
      identifierCiphertext: 'deadbeef',
      identifierEnvelope: [],
      identifierType: 'phone',
      bridgeRegistrationToken: 'not-enough-parts',
    })
    expect(res.status()).toBe(401)
  })
})
