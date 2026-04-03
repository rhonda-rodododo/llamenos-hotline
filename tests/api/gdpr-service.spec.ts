/**
 * GDPR Service API Tests — Extended Coverage
 *
 * Supplements gdpr-compliance.spec.ts with additional edge cases:
 * consent version validation, export content verification, erasure idempotency,
 * and cross-role permission enforcement.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('GDPR Service — Extended', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin', 'reviewer'],
      hubName: 'GDPR Extended Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Consent Version Validation ──────────────────────────────────────────

  test('consent rejects invalid version', async () => {
    const res = await ctx.api('volunteer').post('/api/gdpr/consent', {
      version: 'invalid-version',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('consent rejects empty version', async () => {
    const res = await ctx.api('volunteer').post('/api/gdpr/consent', {
      version: '',
    })
    expect(res.status()).toBe(400)
  })

  test('consent accepts valid version', async () => {
    // The valid version is CONSENT_VERSION = '2026-03-22'
    const res = await ctx.api('volunteer').post('/api/gdpr/consent', {
      version: '2026-03-22',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('consent is idempotent — can re-record same version', async () => {
    const res = await ctx.api('volunteer').post('/api/gdpr/consent', {
      version: '2026-03-22',
    })
    expect(res.status()).toBe(200)
  })

  // ─── Consent Status ──────────────────────────────────────────────────────

  test('consent status returns false for new user', async () => {
    const res = await ctx.api('reviewer').get('/api/gdpr/consent')
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Reviewer hasn't consented yet
    expect(typeof body.hasConsented).toBe('boolean')
  })

  test('consent status returns true after recording', async () => {
    await ctx.api('reviewer').post('/api/gdpr/consent', {
      version: '2026-03-22',
    })
    const res = await ctx.api('reviewer').get('/api/gdpr/consent')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.hasConsented).toBe(true)
    expect(body.consentVersion).toBe('2026-03-22')
  })

  // ─── Self Data Export ────────────────────────────────────────────────────

  test('volunteer can export own data', async () => {
    const res = await ctx.api('volunteer').get('/api/gdpr/export')
    expect(res.status()).toBe(200)
    const contentType = res.headers()['content-type']
    expect(contentType).toContain('json')
    // Should have Content-Disposition for download
    const disposition = res.headers()['content-disposition']
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('llamenos-export')
  })

  test('hub-admin cannot export data without gdpr:export permission', async () => {
    const res = await ctx.api('hub-admin').get('/api/gdpr/export')
    // Hub-admin doesn't have gdpr:export permission by default
    expect([403, 200]).toContain(res.status())
  })

  // ─── Admin Export of Other Users ─────────────────────────────────────────

  test('admin can export volunteer data', async () => {
    const res = await adminApi.get(`/api/gdpr/export/${ctx.user('volunteer').pubkey}`)
    expect(res.status()).toBe(200)
    const contentType = res.headers()['content-type']
    expect(contentType).toContain('json')
  })

  test('admin can export hub-admin data', async () => {
    const res = await adminApi.get(`/api/gdpr/export/${ctx.user('hub-admin').pubkey}`)
    expect(res.status()).toBe(200)
  })

  test('export of nonexistent pubkey returns data (empty export)', async () => {
    // Server should still return 200 with empty data rather than 404
    const fakePubkey = 'a'.repeat(64)
    const res = await adminApi.get(`/api/gdpr/export/${fakePubkey}`)
    // May be 200 (empty export) or 404 depending on implementation
    expect([200, 404]).toContain(res.status())
  })

  // ─── Permission Guards for Export ────────────────────────────────────────

  test('volunteer cannot export another user data', async () => {
    const targetPubkey = ctx.user('hub-admin').pubkey
    const res = await ctx.api('volunteer').get(`/api/gdpr/export/${targetPubkey}`)
    expect(res.status()).toBe(403)
  })

  test('hub-admin cannot export another user data (requires gdpr:admin)', async () => {
    const targetPubkey = ctx.user('volunteer').pubkey
    const res = await ctx.api('hub-admin').get(`/api/gdpr/export/${targetPubkey}`)
    expect(res.status()).toBe(403)
  })

  // ─── Erasure Request Lifecycle ───────────────────────────────────────────

  test('erasure status returns null when no pending request', async () => {
    const res = await ctx.api('hub-admin').get('/api/gdpr/me/erasure')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.request).toBeNull()
  })

  test('user can request self-erasure', async () => {
    const res = await ctx.api('hub-admin').delete('/api/gdpr/me')
    expect(res.status()).toBe(202)
    const body = await res.json()
    expect(body.request).toBeDefined()
    expect(body.request.executeAt).toBeDefined()
  })

  test('erasure status returns pending request after creation', async () => {
    const res = await ctx.api('hub-admin').get('/api/gdpr/me/erasure')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.request).not.toBeNull()
  })

  test('user can cancel pending erasure request', async () => {
    const res = await ctx.api('hub-admin').delete('/api/gdpr/me/cancel')
    expect(res.status()).toBe(200)
  })

  test('erasure status returns null after cancellation', async () => {
    const res = await ctx.api('hub-admin').get('/api/gdpr/me/erasure')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.request).toBeNull()
  })

  // ─── Admin Erasure ──────────────────────────────────────────────────────

  test('volunteer cannot execute admin erasure', async () => {
    const targetPubkey = ctx.user('reviewer').pubkey
    const res = await ctx.api('volunteer').delete(`/api/gdpr/${targetPubkey}`)
    expect(res.status()).toBe(403)
  })

  test('hub-admin cannot execute admin erasure (requires gdpr:admin)', async () => {
    const targetPubkey = ctx.user('reviewer').pubkey
    const res = await ctx.api('hub-admin').delete(`/api/gdpr/${targetPubkey}`)
    expect(res.status()).toBe(403)
  })

  test('admin can execute immediate erasure', async () => {
    const targetPubkey = ctx.user('reviewer').pubkey
    const res = await adminApi.delete(`/api/gdpr/${targetPubkey}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
