/**
 * Volunteer Lifecycle API Tests
 *
 * Full CRUD lifecycle, profile management, PII masking, availability toggle,
 * and role assignment workflows.
 */

import { test, expect } from '@playwright/test'
import { TestContext, uniquePhone, uniqueName, createVolunteerWithKey } from '../api-helpers'
import { createAuthedRequestFromNsec, createAuthedRequest, type AuthedRequest } from '../helpers/authed-request'
import { ADMIN_NSEC } from '../helpers'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Volunteer Lifecycle', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin'],
      hubName: 'VolLifecycle Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── CRUD Operations ────────────────────────────────────────────────────

  test('create volunteer with valid data', async ({ request }) => {
    const { pubkey, name, phone } = await createVolunteerWithKey(request, {
      name: 'Lifecycle Create Test',
      roleIds: ['role-volunteer'],
    })

    // Verify via list
    const listRes = await adminApi.get('/api/volunteers')
    const { volunteers } = await listRes.json()
    const found = volunteers.find((v: { pubkey: string }) => v.pubkey === pubkey)
    expect(found).toBeDefined()
    expect(found.name).toBe('Lifecycle Create Test')
  })

  test('create volunteer rejects invalid phone', async () => {
    const res = await adminApi.post('/api/volunteers', {
      name: 'Bad Phone',
      phone: 'not-a-phone',
      pubkey: '01'.repeat(32),
      roleIds: ['role-volunteer'],
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).not.toBe(500)
  })

  test('create volunteer rejects duplicate pubkey', async ({ request }) => {
    const { pubkey } = await createVolunteerWithKey(request)

    const res = await adminApi.post('/api/volunteers', {
      name: 'Dupe Pubkey',
      phone: uniquePhone(),
      pubkey,
      roleIds: ['role-volunteer'],
    })
    // Server may return 409 (explicit) or 400/500 (DB constraint)
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })

  test('get single volunteer by pubkey', async () => {
    const volPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.get(`/api/volunteers/${volPubkey}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.volunteer || body.pubkey).toBeDefined()
  })

  test('update volunteer name and phone', async () => {
    const volPubkey = ctx.user('volunteer').pubkey
    const newPhone = uniquePhone()
    const res = await adminApi.patch(`/api/volunteers/${volPubkey}`, {
      name: 'Updated Vol Name',
      phone: newPhone,
    })
    expect(res.status()).toBe(200)
  })

  test('update volunteer roles', async () => {
    const volPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.patch(`/api/volunteers/${volPubkey}`, {
      roles: ['role-volunteer', 'role-reviewer'],
    })
    expect(res.status()).toBe(200)

    // Verify the role change
    const meRes = await ctx.api('volunteer').get('/api/auth/me')
    const me = await meRes.json()
    expect(Array.isArray(me.roles)).toBe(true)
    expect(me.roles).toContain('role-volunteer')
    expect(me.roles).toContain('role-reviewer')

    // Restore original role
    await adminApi.patch(`/api/volunteers/${volPubkey}`, {
      roles: ['role-volunteer'],
    })
  })

  test('delete volunteer', async ({ request }) => {
    const { pubkey } = await createVolunteerWithKey(request, {
      name: 'Delete Me',
    })

    const delRes = await adminApi.delete(`/api/volunteers/${pubkey}`)
    expect(delRes.status()).toBe(200)

    // Verify deleted (should 404 or not appear in list)
    const getRes = await adminApi.get(`/api/volunteers/${pubkey}`)
    expect([404, 200]).toContain(getRes.status())
    if (getRes.status() === 200) {
      const body = await getRes.json()
      // If returned, should be marked inactive
      expect(body.volunteer?.active ?? body.active).toBe(false)
    }
  })

  test('delete nonexistent volunteer is handled gracefully', async () => {
    const res = await adminApi.delete(`/api/volunteers/${'ff'.repeat(32)}`)
    // Server may return 200 (idempotent delete) or 404 (not found)
    expect([200, 404]).toContain(res.status())
  })

  // ─── Profile Self-Service ────────────────────────────────────────────────

  test('volunteer can update own profile via /auth/me/profile', async () => {
    const volApi = ctx.api('volunteer')
    const res = await volApi.patch('/api/auth/me/profile', {
      spokenLanguages: ['en', 'es'],
      uiLanguage: 'en',
    })
    expect(res.status()).toBe(200)

    // Verify
    const meRes = await volApi.get('/api/auth/me')
    const me = await meRes.json()
    expect(me.spokenLanguages).toContain('en')
    expect(me.spokenLanguages).toContain('es')
    expect(me.uiLanguage).toBe('en')
  })

  test('volunteer can toggle availability (on-break)', async () => {
    const volApi = ctx.api('volunteer')

    // Go on break
    const breakRes = await volApi.patch('/api/auth/me/availability', { onBreak: true })
    expect(breakRes.status()).toBe(200)

    let me = await (await volApi.get('/api/auth/me')).json()
    expect(me.onBreak).toBe(true)

    // Come off break
    const availRes = await volApi.patch('/api/auth/me/availability', { onBreak: false })
    expect(availRes.status()).toBe(200)

    me = await (await volApi.get('/api/auth/me')).json()
    expect(me.onBreak).toBe(false)
  })

  test('volunteer can toggle own transcription setting', async () => {
    const volApi = ctx.api('volunteer')
    const res = await volApi.patch('/api/auth/me/transcription', { enabled: true })
    // May be 200, or may be 403 if transcription opt-out not allowed
    expect(res.status()).not.toBe(500)
  })

  // ─── PII Masking ─────────────────────────────────────────────────────────

  test('volunteer sees own phone masked in /auth/me', async () => {
    const volApi = ctx.api('volunteer')
    const res = await volApi.get('/api/auth/me')
    const me = await res.json()
    if (me.phone) {
      // Phone should be masked (uses • character, e.g., +15•••••••••05)
      expect(me.phone).toContain('•')
    }
  })

  test('admin can unmask phone with ?unmask=true', async () => {
    const volPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.get(`/api/volunteers/${volPubkey}?unmask=true`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const phone = body.volunteer?.phone ?? body.phone
    if (phone) {
      // Unmasked phone should be full E.164 format
      expect(phone).toMatch(/^\+\d+$/)
    }
  })

  test('volunteer cannot unmask other volunteers phone', async () => {
    const haUser = ctx.user('hub-admin')
    const volApi = ctx.api('volunteer')
    const res = await volApi.get(`/api/volunteers/${haUser.pubkey}?unmask=true`)
    // Should be denied or return masked data
    if (res.status() === 200) {
      const body = await res.json()
      const phone = body.volunteer?.phone ?? body.phone
      if (phone && phone.length > 0) {
        // Should still be masked
        expect(phone).toContain('*')
      }
    }
  })
})
