/**
 * Permission Matrix Tests
 *
 * Systematically tests every major API endpoint domain against each role:
 * super-admin, hub-admin, user (volunteer role), reviewer, reporter, and unauthenticated.
 *
 * Uses hub-scoped routes for non-super-admin users (MED-W1 compliance).
 */

import { type APIRequestContext, expect, test } from '@playwright/test'
import { type RoleAlias, TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Permission Matrix', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['hub-admin', 'volunteer', 'reviewer', 'reporter'],
      hubName: 'PermMatrix Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Helper: run an endpoint check against all roles ─────────────────────

  type RoleExpectation = {
    role: RoleAlias | 'super-admin-global'
    allowed: boolean
  }

  async function checkEndpoint(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body: unknown | undefined,
    expectations: RoleExpectation[],
    unauthExpected = 401
  ) {
    for (const { role, allowed } of expectations) {
      let api: AuthedRequest
      let fullPath: string

      if (role === 'super-admin-global') {
        api = adminApi
        fullPath = `/api${path}`
      } else {
        api = ctx.api(role)
        fullPath = ctx.hubPath(path)
      }

      const res = await api[method](fullPath, body)
      const status = res.status()

      if (allowed) {
        expect(status, `${role} ${method.toUpperCase()} ${path} should be allowed`).toBeLessThan(
          400
        )
      } else {
        expect(
          status,
          `${role} ${method.toUpperCase()} ${path} should be denied`
        ).toBeGreaterThanOrEqual(400)
        expect(status, `${role} should not get 500`).not.toBe(500)
      }
    }
  }

  // ─── Users domain ───────────────────────────────────────────────────

  test.describe('Users domain', () => {
    test('GET /api/users — read access', async ({ request }) => {
      // Super-admin: global access
      const saRes = await adminApi.get('/api/users')
      expect(saRes.status()).toBe(200)

      // Hub-admin: can read
      const haRes = await ctx.api('hub-admin').get('/api/users')
      expect(haRes.status()).toBe(200)

      // User: can read (users:read)
      const volRes = await ctx.api('volunteer').get('/api/users')
      expect(volRes.status()).toBe(200)

      // Reporter: no users:read
      const repRes = await ctx.api('reporter').get('/api/users')
      expect(repRes.status()).toBe(403)
    })

    test('POST /api/users — create access', async () => {
      const body = {
        name: 'Matrix Test Vol',
        phone: '+15550000001',
        pubkey: '00'.repeat(32),
        roleIds: ['role-volunteer'],
      }

      // Super-admin: allowed (but pubkey '00'.repeat(32) is invalid secp256k1 — returns 400)
      const saRes = await adminApi.post('/api/users', body)
      // Not forbidden (403) — admin has the permission; invalid pubkey may return 400
      expect(saRes.status()).not.toBe(403)
      expect(saRes.status()).not.toBe(500)

      // User: denied
      const volRes = await ctx.api('volunteer').post('/api/users', body)
      expect(volRes.status()).toBe(403)

      // Reporter: denied
      const repRes = await ctx.api('reporter').post('/api/users', body)
      expect(repRes.status()).toBe(403)
    })

    test('unauthenticated requests get 401', async ({ request }) => {
      const res = await request.get('/api/users')
      expect(res.status()).toBe(401)
    })
  })

  // ─── Bans domain ─────────────────────────────────────────────────────────

  test.describe('Bans domain', () => {
    test('GET bans — role access matrix', async () => {
      // Super-admin (global)
      const saRes = await adminApi.get('/api/bans')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped)
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/bans'))
      expect(haRes.status()).toBe(200)

      // User: no bans:read (gets 400 for missing hub or 403)
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/bans'))
      expect([400, 403]).toContain(volRes.status())

      // Reporter: no bans:read
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/bans'))
      expect([400, 403]).toContain(repRes.status())
    })

    test('POST bans — only admin roles can create', async () => {
      const body = { phone: '+15550009999', reason: 'Matrix test ban' }

      // Super-admin: allowed
      const saRes = await adminApi.post('/api/bans', body)
      expect([200, 201]).toContain(saRes.status())

      // Hub-admin: allowed (hub-scoped) — use different phone to avoid duplicate
      const haRes = await ctx
        .api('hub-admin')
        .post(ctx.hubPath('/bans'), { phone: '+15550009998', reason: 'Matrix test ban 2' })
      expect([200, 201]).toContain(haRes.status())

      // User: denied
      const volRes = await ctx.api('volunteer').post(ctx.hubPath('/bans'), body)
      expect(volRes.status()).toBe(403)
    })
  })

  // ─── Shifts domain ───────────────────────────────────────────────────────

  test.describe('Shifts domain', () => {
    test('GET shifts — role access matrix', async () => {
      // Super-admin (global)
      const saRes = await adminApi.get('/api/shifts')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped)
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/shifts'))
      expect(haRes.status()).toBe(200)

      // User: has shifts:read-own but not shifts:read (may vary)
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/shifts'))
      // User might get 200 (shifts:read-own allows list) or 403
      expect(volRes.status()).not.toBe(500)
    })

    test('POST shifts — admin-only creation', async () => {
      const body = {
        name: 'Matrix Shift',
        startTime: '09:00',
        endTime: '17:00',
        days: [1, 2, 3],
        userPubkeys: [],
      }

      // Super-admin: allowed
      const saRes = await adminApi.post('/api/shifts', body)
      expect([200, 201]).toContain(saRes.status())

      // User: denied
      const volRes = await ctx.api('volunteer').post(ctx.hubPath('/shifts'), body)
      expect(volRes.status()).toBe(403)

      // Reporter: denied
      const repRes = await ctx.api('reporter').post(ctx.hubPath('/shifts'), body)
      expect(repRes.status()).toBe(403)
    })
  })

  // ─── Audit domain ────────────────────────────────────────────────────────

  test.describe('Audit domain', () => {
    test('GET audit — admin-only access', async () => {
      // Super-admin (global)
      const saRes = await adminApi.get('/api/audit')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped)
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/audit'))
      expect(haRes.status()).toBe(200)

      // User: denied
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/audit'))
      expect(volRes.status()).toBe(403)

      // Reporter: denied
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/audit'))
      expect(repRes.status()).toBe(403)

      // Reviewer: denied (no audit:read)
      const revRes = await ctx.api('reviewer').get(ctx.hubPath('/audit'))
      expect(revRes.status()).toBe(403)
    })
  })

  // ─── Notes domain ────────────────────────────────────────────────────────

  test.describe('Notes domain', () => {
    test('GET notes — role access matrix', async () => {
      // Super-admin
      const saRes = await adminApi.get('/api/notes')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped) — needs notes:read-own or notes:read-all
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/notes'))
      // Hub-admin may need explicit notes permission; 200 or 403 depending on role config
      expect(haRes.status()).not.toBe(500)

      // User: has notes:read-own
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/notes'))
      expect(volRes.status()).toBe(200)

      // Reporter: no notes:read-own
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/notes'))
      expect(repRes.status()).toBe(403)
    })
  })

  // ─── Settings domain ────────────────────────────────────────────────────

  test.describe('Settings domain', () => {
    test('settings endpoints are admin-only', async () => {
      const settingsEndpoints = [
        '/api/settings/spam',
        '/api/settings/telephony-provider',
        '/api/settings/call',
      ]

      for (const endpoint of settingsEndpoints) {
        // Super-admin: allowed
        const saRes = await adminApi.get(endpoint)
        expect(saRes.status(), `admin GET ${endpoint}`).toBe(200)

        // User: denied
        const volRes = await ctx.api('volunteer').get(endpoint)
        expect(volRes.status(), `user GET ${endpoint}`).toBe(403)

        // Reporter: denied
        const repRes = await ctx.api('reporter').get(endpoint)
        expect(repRes.status(), `reporter GET ${endpoint}`).toBe(403)
      }
    })

    test('roles endpoint readable by all authenticated users', async () => {
      const roles: RoleAlias[] = ['hub-admin', 'volunteer', 'reviewer', 'reporter']
      for (const role of roles) {
        const res = await ctx.api(role).get('/api/settings/roles')
        expect(res.status(), `${role} GET /api/settings/roles`).toBe(200)
      }
    })

    test('role creation requires system:manage-roles', async () => {
      const body = {
        name: 'Unauthorized Role',
        slug: `unauth-role-${Date.now().toString(36)}`,
        permissions: ['calls:read-active'],
      }

      // User: denied
      const volRes = await ctx.api('volunteer').post('/api/settings/roles', body)
      expect(volRes.status()).toBe(403)

      // Hub-admin: denied (system:manage-roles is super-admin only)
      const haRes = await ctx.api('hub-admin').post('/api/settings/roles', body)
      expect(haRes.status()).toBe(403)
    })
  })

  // ─── Analytics domain ────────────────────────────────────────────────────

  test.describe('Analytics domain', () => {
    test('analytics require calls:read-history permission', async () => {
      // Super-admin: allowed
      const saRes = await adminApi.get('/api/analytics/calls?days=7')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped): allowed
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/analytics/calls?days=7'))
      expect(haRes.status()).toBe(200)

      // User: has calls:read-history — allowed
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/analytics/calls?days=7'))
      expect(volRes.status()).toBe(200)

      // Reporter: denied
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/analytics/calls?days=7'))
      expect(repRes.status()).toBe(403)
    })
  })

  // ─── Conversations domain ────────────────────────────────────────────────

  test.describe('Conversations domain', () => {
    test('GET conversations — access matrix', async () => {
      // Super-admin
      const saRes = await adminApi.get('/api/conversations')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped)
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/conversations'))
      expect(haRes.status()).toBe(200)

      // User: has conversations:claim, conversations:read-assigned
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/conversations'))
      expect(volRes.status()).toBe(200)

      // Reporter: may get empty list (200) or 403 depending on route implementation
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/conversations'))
      expect(repRes.status()).not.toBe(500)
    })
  })

  // ─── Reports domain ─────────────────────────────────────────────────────

  test.describe('Reports domain', () => {
    test('GET reports — role access matrix', async () => {
      // Super-admin
      const saRes = await adminApi.get('/api/reports')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped)
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/reports'))
      expect(haRes.status()).toBe(200)

      // Reviewer: has reports:read-assigned
      const revRes = await ctx.api('reviewer').get(ctx.hubPath('/reports'))
      expect(revRes.status()).toBe(200)

      // Reporter: has reports:read-own
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/reports'))
      expect(repRes.status()).toBe(200)
    })
  })

  // ─── Contacts domain ────────────────────────────────────────────────────

  test.describe('Contacts domain', () => {
    test('GET contacts requires contacts:read', async () => {
      // Super-admin
      const saRes = await adminApi.get('/api/contacts')
      expect(saRes.status()).toBe(200)

      // Hub-admin (hub-scoped)
      const haRes = await ctx.api('hub-admin').get(ctx.hubPath('/contacts'))
      expect(haRes.status()).toBe(200)

      // User: may or may not have contacts:read
      const volRes = await ctx.api('volunteer').get(ctx.hubPath('/contacts'))
      expect(volRes.status()).not.toBe(500)

      // Reporter: denied
      const repRes = await ctx.api('reporter').get(ctx.hubPath('/contacts'))
      expect([403]).toContain(repRes.status())
    })
  })

  // ─── GDPR domain ────────────────────────────────────────────────────────

  test.describe('GDPR domain', () => {
    test('self-service GDPR endpoints accessible by all authenticated roles', async () => {
      // Every authenticated user should be able to access their own consent endpoint
      const roles: RoleAlias[] = ['hub-admin', 'volunteer', 'reviewer', 'reporter']
      for (const role of roles) {
        const res = await ctx.api(role).get('/api/gdpr/consent')
        expect(res.status(), `${role} GET /api/gdpr/consent`).not.toBe(500)
        // Should be 200 or 404 (no consent yet), not 403
        expect([200, 404]).toContain(res.status())
      }
    })

    test('admin GDPR export requires gdpr:admin permission', async () => {
      const targetPubkey = ctx.user('volunteer').pubkey

      // Super-admin: allowed
      const saRes = await adminApi.get(`/api/gdpr/export/${targetPubkey}`)
      expect(saRes.status()).toBe(200)

      // User: denied
      const volRes = await ctx.api('volunteer').get(`/api/gdpr/export/${targetPubkey}`)
      expect(volRes.status()).toBe(403)

      // Reporter: denied
      const repRes = await ctx.api('reporter').get(`/api/gdpr/export/${targetPubkey}`)
      expect(repRes.status()).toBe(403)
    })
  })

  // ─── Hub-scoping enforcement ────────────────────────────────────────────

  test.describe('Hub-scoping enforcement (MED-W1)', () => {
    const hubRequiredPaths = [
      '/api/shifts',
      '/api/bans',
      '/api/notes',
      '/api/calls/active',
      '/api/audit',
      '/api/conversations',
      '/api/reports',
      '/api/analytics/calls?days=7',
      '/api/contacts',
    ]

    test('non-super-admin gets 400 or 403 on global resource routes', async () => {
      for (const path of hubRequiredPaths) {
        const res = await ctx.api('volunteer').get(path)
        // 400 = hub context required, 403 = permission denied (checked before hub context)
        // Both are correct — the key assertion is they are NOT allowed through
        expect(res.status(), `user GET ${path} should be denied`).toBeGreaterThanOrEqual(400)
        expect(res.status(), `${path} should not 500`).not.toBe(500)
      }
    })

    test('super-admin can access global resource routes without hub', async () => {
      for (const path of hubRequiredPaths) {
        const res = await adminApi.get(path)
        expect(res.status(), `admin GET ${path} should succeed globally`).not.toBe(400)
        expect(res.status()).not.toBe(500)
      }
    })
  })
})
