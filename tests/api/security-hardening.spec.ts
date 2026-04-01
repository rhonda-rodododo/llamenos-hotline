/**
 * Security Hardening v2 Audit Backport — API Tests
 *
 * Covers:
 *   HIGH-W1: serverEventKeyHex not returned to all authenticated users
 *   HIGH-W3: Phone hash in audit log (not plaintext)
 *   HIGH-W5: Twilio account SID format validation
 *   MED-W1:  Non-super-admin blocked from global resource routes
 *   MED-W2:  User cannot ban by phone directly (no bans:create)
 */

import { expect, test } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ADMIN_NSEC, uniquePhone } from '../helpers'
import {
  type AuthedRequest,
  createAuthedRequest,
  createAuthedRequestFromNsec,
} from '../helpers/authed-request'

test.describe('Security hardening', () => {
  test.describe.configure({ mode: 'serial' })

  let adminApi: AuthedRequest

  test.beforeEach(async ({ request }) => {
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  // ─── HIGH-W1: Global server event key not in /auth/me ─────────────────────

  test('HIGH-W1: /auth/me does not return serverEventKeyHex', async () => {
    const res = await adminApi.get('/api/auth/me')
    const me = await res.json()
    // The response must not include the global server event key
    expect(me).not.toHaveProperty('serverEventKeyHex')
  })

  // ─── HIGH-W3: Phone hash in audit log ─────────────────────────────────────

  test('HIGH-W3: Banning a number writes a hash to the audit log, not plaintext', async () => {
    // Create a hub and use its ban endpoint
    const hubRes = await adminApi.post('/api/hubs', { name: 'Audit Hash Test Hub' })
    const hubResult = await hubRes.json()
    const hubId = (hubResult as { hub: { id: string } }).hub.id

    const testPhone = '+15559876543'

    // Create a ban (uses hub-scoped route — admin always passes MED-W1)
    await adminApi.post(`/api/hubs/${hubId}/bans`, { phone: testPhone, reason: 'security test' })

    // Fetch audit log for the hub
    const auditRes = await adminApi.get(`/api/hubs/${hubId}/audit`)
    const auditResult = await auditRes.json()

    const banEntry = (
      auditResult.entries as Array<{ event: string; details?: Record<string, unknown> }>
    ).find((e) => e.event === 'numberBanned')

    expect(banEntry).toBeDefined()
    // Audit entry must NOT contain plaintext phone
    expect(JSON.stringify(banEntry)).not.toContain(testPhone)
    // Audit entry MUST contain a phoneHash field (hex HMAC)
    expect(banEntry?.details).toHaveProperty('phoneHash')
    expect(typeof banEntry?.details?.phoneHash).toBe('string')
    expect((banEntry?.details?.phoneHash as string).length).toBe(64) // SHA-256 hex
  })

  // ─── HIGH-W5: Twilio account SID format validation ────────────────────────

  test('HIGH-W5: Invalid Twilio account SID is rejected before URL construction', async () => {
    const invalidSids = [
      '../other-account', // path traversal attempt
      'not-a-sid', // wrong format
      `ac${'0'.repeat(32)}`, // lowercase ac (must be AC)
      'ACgggggggggggggggggggggggggggggggg', // non-hex chars
      '', // empty
    ]

    for (const sid of invalidSids) {
      const res = await adminApi.post('/api/settings/telephony-provider/test', {
        type: 'twilio',
        accountSid: sid,
        authToken: 'test',
      })
      const body = await res.json()

      expect(res.status()).toBe(400)
      expect(body.ok).toBe(false)
    }
  })

  test('HIGH-W5: Valid Twilio account SID passes format check (may fail on auth)', async () => {
    // A properly formatted SID should pass validation and attempt the real API call
    // (which will fail since credentials are fake, but not with a 400 format error)
    const validSid = `AC${'a'.repeat(32)}`
    const res = await adminApi.post('/api/settings/telephony-provider/test', {
      type: 'twilio',
      accountSid: validSid,
      authToken: 'fake-token',
    })
    const body = await res.json()

    // Should NOT be a 400 format error — may be 400 from Twilio rejecting fake creds
    // or 400 from provider check, but not our SID format validation
    if (res.status() === 400) {
      expect(body.error).not.toContain('SID format')
    }
  })

  // ─── MED-W1: Non-super-admin blocked from global resource routes ───────────

  test('MED-W1: Non-admin user cannot access global resource routes', async ({ request }) => {
    // Create a user via the admin-authenticated API
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)

    await adminApi.post('/api/users', {
      name: 'SecTest User',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
      pubkey,
    })

    // Create an authed request as the user
    const userApi = createAuthedRequest(request, sk)

    // Global bans endpoint should return 400 (no hub context for non-super-admin)
    const bansRes = await userApi.get('/api/bans')
    expect(bansRes.status()).toBe(400)

    // Global calls endpoint should return 400
    const callsRes = await userApi.get('/api/calls/active')
    expect(callsRes.status()).toBe(400)

    // Global notes endpoint should return 400
    const notesRes = await userApi.get('/api/notes')
    expect(notesRes.status()).toBe(400)
  })

  // ─── MED-W2: User cannot create bans directly ────────────────────────

  test('MED-W2: User gets 403 when attempting to ban via hub-scoped endpoint', async ({
    request,
  }) => {
    // Create a hub and a user via admin API
    const hubRes = await adminApi.post('/api/hubs', { name: 'Ban Permission Test Hub' })
    const { hub } = await hubRes.json()

    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)

    await adminApi.post('/api/users', {
      name: 'NoBan User',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
      pubkey,
    })
    await adminApi.post(`/api/hubs/${hub.id}/members`, {
      pubkey,
      roleIds: ['role-volunteer'],
    })

    // Create an authed request as the user
    const userApi = createAuthedRequest(request, sk)

    // User trying to create a ban via hub-scoped route should get 403 (no bans:create)
    const banRes = await userApi.post(`/api/hubs/${hub.id}/bans`, {
      phone: '+15551234567',
      reason: 'test',
    })
    expect(banRes.status()).toBe(403)
  })

  // ─── Super-admin can still use global resource routes ─────────────────────

  test('MED-W1: Super-admin can access global resource routes without hub context', async () => {
    // Admin is already set up in beforeEach
    const res = await adminApi.get('/api/calls/active')
    // Admin (super-admin) should NOT get 400 on global routes
    expect(res.status()).not.toBe(400)
    // 200 or 503 (telephony not configured) — not 400
    expect([200, 503]).toContain(res.status())
  })
})
