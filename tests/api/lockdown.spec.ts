/**
 * Lockdown API Integration Tests
 *
 * Tests POST /sessions/lockdown endpoint through HTTP.
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

test.describe('Lockdown API', () => {
  test('missing confirmation returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {
      tier: 'A',
      confirmation: 'NOT-LOCKDOWN',
      pinProof: 'x',
    })
    expect(res.status()).toBe(400)
  })

  test('invalid tier returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {
      tier: 'Z',
      confirmation: 'LOCKDOWN',
      pinProof: 'x',
    })
    expect(res.status()).toBe(400)
  })

  test('tier A runs lockdown and returns revokedSessions count', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {
      tier: 'A',
      confirmation: 'LOCKDOWN',
      pinProof: 'any-proof',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.tier).toBe('A')
    expect(body.accountDeactivated).toBe(false)
    expect(typeof body.revokedSessions).toBe('number')
    expect(typeof body.deletedPasskeys).toBe('number')
  })

  test('missing body returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {})
    expect(res.status()).toBe(400)
  })

  test('requires authentication', async ({ request }) => {
    const res = await request.post('/api/auth/sessions/lockdown', {
      headers: { 'content-type': 'application/json' },
      data: { tier: 'A', confirmation: 'LOCKDOWN', pinProof: 'x' },
    })
    expect(res.status()).toBe(401)
  })
})
