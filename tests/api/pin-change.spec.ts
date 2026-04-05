/**
 * PIN change API Integration Tests
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.beforeAll(async ({ request }) => {
  try {
    const res = await request.get('/api/health/live', { timeout: 5000 })
    if (!res.ok()) test.skip(true, 'Server not reachable')
  } catch {
    test.skip(true, 'Server not reachable')
  }
})

test.describe('PIN change API', () => {
  test('invalid body returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/pin/change', {})
    expect(res.status()).toBe(400)
  })

  test('valid body returns 200', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/pin/change', {
      currentPinProof: 'a'.repeat(64),
      newEncryptedSecretKey: 'ciphertext-stub',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('requires authentication', async ({ request }) => {
    const res = await request.post('/api/auth/pin/change', {
      headers: { 'content-type': 'application/json' },
      data: { currentPinProof: 'x', newEncryptedSecretKey: 'y' },
    })
    expect(res.status()).toBe(401)
  })
})
