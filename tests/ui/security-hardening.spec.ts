/**
 * Security Hardening v2 Audit Backport — E2E Tests
 *
 * Covers:
 *   HIGH-W1: serverEventKeyHex not returned to all authenticated users
 *   HIGH-W3: Phone hash in audit log (not plaintext)
 *   HIGH-W5: Twilio account SID format validation
 *   MED-W1:  Non-super-admin blocked from global resource routes
 *   MED-W2:  Volunteer cannot ban by phone directly (no bans:create)
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsVolunteer, resetTestState, uniquePhone } from '../helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

/** Inject the authed fetch helper that signs requests with the current keyManager. */
async function injectAuthedFetch(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.__authedFetch = async (url: string, options: RequestInit = {}) => {
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      }
      if (km?.isUnlocked()) {
        const reqMethod = (options.method || 'GET').toUpperCase()
        const reqPath = new URL(url, location.origin).pathname
        const token = km.createAuthToken(Date.now(), reqMethod, reqPath)
        headers['Authorization'] = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    }
  })
}

test.describe('Security hardening', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
  })

  // ─── HIGH-W1: Global server event key not in /auth/me ─────────────────────

  test('HIGH-W1: /auth/me does not return serverEventKeyHex', async ({ page }) => {
    const me = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/auth/me')
      return res.json()
    })
    // The response must not include the global server event key
    expect(me).not.toHaveProperty('serverEventKeyHex')
  })

  // ─── HIGH-W3: Phone hash in audit log ─────────────────────────────────────

  test('HIGH-W3: Banning a number writes a hash to the audit log, not plaintext', async ({
    page,
  }) => {
    // Create a hub and use its ban endpoint
    const hubResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Audit Hash Test Hub' }),
      })
      return res.json()
    })
    const hubId = (hubResult as { hub: { id: string } }).hub.id

    const testPhone = '+15559876543'

    // Create a ban (uses hub-scoped route — admin always passes MED-W1)
    await page.evaluate(
      async ({ hId, phone }: { hId: string; phone: string }) => {
        await window.__authedFetch(`/api/hubs/${hId}/bans`, {
          method: 'POST',
          body: JSON.stringify({ phone, reason: 'security test' }),
        })
      },
      { hId: hubId, phone: testPhone }
    )

    // Fetch audit log for the hub
    const auditResult = await page.evaluate(async (hId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hId}/audit`)
      return res.json()
    }, hubId)

    const banEntry = (auditResult.entries as Array<{ event: string; details?: Record<string, unknown> }>)
      .find((e) => e.event === 'numberBanned')

    expect(banEntry).toBeDefined()
    // Audit entry must NOT contain plaintext phone
    expect(JSON.stringify(banEntry)).not.toContain(testPhone)
    // Audit entry MUST contain a phoneHash field (hex HMAC)
    expect(banEntry?.details).toHaveProperty('phoneHash')
    expect(typeof banEntry?.details?.phoneHash).toBe('string')
    expect((banEntry?.details?.phoneHash as string).length).toBe(64) // SHA-256 hex
  })

  // ─── HIGH-W5: Twilio account SID format validation ────────────────────────

  test('HIGH-W5: Invalid Twilio account SID is rejected before URL construction', async ({
    page,
  }) => {
    const invalidSids = [
      '../other-account',       // path traversal attempt
      'not-a-sid',              // wrong format
      'ac' + '0'.repeat(32),    // lowercase ac (must be AC)
      'ACgggggggggggggggggggggggggggggggg', // non-hex chars
      '',                        // empty
    ]

    for (const sid of invalidSids) {
      const result = await page.evaluate(async (accountSid: string) => {
        const res = await window.__authedFetch('/api/settings/telephony-provider/test', {
          method: 'POST',
          body: JSON.stringify({ type: 'twilio', accountSid, authToken: 'test' }),
        })
        return { status: res.status, body: await res.json() }
      }, sid)

      expect(result.status).toBe(400)
      expect(result.body.ok).toBe(false)
    }
  })

  test('HIGH-W5: Valid Twilio account SID passes format check (may fail on auth)', async ({
    page,
  }) => {
    // A properly formatted SID should pass validation and attempt the real API call
    // (which will fail since credentials are fake, but not with a 400 format error)
    const validSid = 'AC' + 'a'.repeat(32)
    const result = await page.evaluate(async (accountSid: string) => {
      const res = await window.__authedFetch('/api/settings/telephony-provider/test', {
        method: 'POST',
        body: JSON.stringify({ type: 'twilio', accountSid, authToken: 'fake-token' }),
      })
      return { status: res.status, body: await res.json() }
    }, validSid)

    // Should NOT be a 400 format error — may be 400 from Twilio rejecting fake creds
    // or 400 from provider check, but not our SID format validation
    if (result.status === 400) {
      expect(result.body.error).not.toContain('SID format')
    }
  })

  // ─── MED-W1: Non-super-admin blocked from global resource routes ───────────

  test('MED-W1: Non-admin volunteer cannot access global resource routes', async ({ page }) => {
    // Create a volunteer via the admin-authenticated API
    const { nsec } = await page.evaluate(async (phone: string) => {
      const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
      const { nip19 } = await import('nostr-tools')
      const sk = generateSecretKey()
      const pubkey = getPublicKey(sk)
      const nsec = nip19.nsecEncode(sk)
      await window.__authedFetch('/api/volunteers', {
        method: 'POST',
        body: JSON.stringify({ name: 'SecTest Volunteer', phone, roleIds: ['role-volunteer'], pubkey }),
      })
      return { pubkey, nsec }
    }, uniquePhone())

    // Login as the volunteer
    await loginAsVolunteer(page, nsec)
    await injectAuthedFetch(page)

    // Global bans endpoint should return 400 (no hub context for non-super-admin)
    const bansResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/bans')
      return { status: res.status }
    })
    expect(bansResult.status).toBe(400)

    // Global calls endpoint should return 400
    const callsResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/calls/active')
      return { status: res.status }
    })
    expect(callsResult.status).toBe(400)

    // Global notes endpoint should return 400
    const notesResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/notes')
      return { status: res.status }
    })
    expect(notesResult.status).toBe(400)
  })

  // ─── MED-W2: Volunteer cannot create bans directly ────────────────────────

  test('MED-W2: Volunteer gets 403 when attempting to ban via hub-scoped endpoint', async ({
    page,
  }) => {
    // Create a hub and a volunteer via admin fetch
    const { hubId, volNsec } = await page.evaluate(async (phone: string) => {
      const hubRes = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ban Permission Test Hub' }),
      })
      const { hub } = await hubRes.json()

      const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
      const { nip19 } = await import('nostr-tools')
      const sk = generateSecretKey()
      const pubkey = getPublicKey(sk)
      const nsec = nip19.nsecEncode(sk)

      await window.__authedFetch('/api/volunteers', {
        method: 'POST',
        body: JSON.stringify({ name: 'NoBan Volunteer', phone, roleIds: ['role-volunteer'], pubkey }),
      })
      await window.__authedFetch(`/api/hubs/${hub.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ pubkey, roleIds: ['role-volunteer'] }),
      })
      return { hubId: hub.id, volNsec: nsec }
    }, uniquePhone())

    // Login as the volunteer
    await loginAsVolunteer(page, volNsec)
    await injectAuthedFetch(page)

    // Volunteer trying to create a ban via hub-scoped route should get 403 (no bans:create)
    const banResult = await page.evaluate(
      async ({ hId }: { hId: string }) => {
        const res = await window.__authedFetch(`/api/hubs/${hId}/bans`, {
          method: 'POST',
          body: JSON.stringify({ phone: '+15551234567', reason: 'test' }),
        })
        return { status: res.status }
      },
      { hId: hubId }
    )
    expect(banResult.status).toBe(403)
  })

  // ─── Super-admin can still use global resource routes ─────────────────────

  test('MED-W1: Super-admin can access global resource routes without hub context', async ({
    page,
  }) => {
    // Admin is already logged in in beforeEach
    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/calls/active')
      return { status: res.status }
    })
    // Admin (super-admin) should NOT get 400 on global routes
    expect(result.status).not.toBe(400)
    // 200 or 503 (telephony not configured) — not 400
    expect([200, 503]).toContain(result.status)
  })
})
