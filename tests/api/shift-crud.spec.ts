/**
 * Shift CRUD and Scheduling API Tests
 *
 * Full lifecycle: create, list, update, delete shifts within a hub.
 * Fallback group management and my-status endpoint.
 */

import { expect, test } from '@playwright/test'
import { TestContext, uniqueName } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Shift CRUD and Scheduling', () => {
  test.describe.configure({ mode: 'serial' })

  let shiftId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin'],
      hubName: 'Shift CRUD Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Create ──────────────────────────────────────────────────────────────

  test('create shift via hub-scoped route', async () => {
    const res = await adminApi.post(ctx.hubPath('/shifts'), {
      encryptedName: 'encrypted-morning-shift',
      startTime: '08:00',
      endTime: '14:00',
      days: [1, 2, 3, 4, 5],
      userPubkeys: [ctx.user('volunteer').pubkey],
    })
    expect([200, 201]).toContain(res.status())
    const body = await res.json()
    expect(body.shift).toBeDefined()
    expect(body.shift.encryptedName).toBeTruthy()
    expect(body.shift.id).toBeTruthy()
    shiftId = body.shift.id
  })

  test('create shift rejects missing required fields', async () => {
    const res = await adminApi.post(ctx.hubPath('/shifts'), {
      // Missing name, startTime, endTime
      days: [1],
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).not.toBe(500)
  })

  // ─── Read ────────────────────────────────────────────────────────────────

  test('list shifts within hub', async () => {
    const res = await adminApi.get(ctx.hubPath('/shifts'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.shifts).toBeDefined()
    expect(Array.isArray(body.shifts)).toBe(true)
    expect(body.shifts.some((s: { id: string }) => s.id === shiftId)).toBe(true)
  })

  test('hub-admin can list shifts', async () => {
    const res = await ctx.api('hub-admin').get(ctx.hubPath('/shifts'))
    expect(res.status()).toBe(200)
  })

  // ─── Update ──────────────────────────────────────────────────────────────

  test('update shift name and schedule', async () => {
    expect(shiftId).toBeDefined()
    const res = await adminApi.patch(ctx.hubPath(`/shifts/${shiftId}`), {
      encryptedName: 'encrypted-updated-morning-shift',
      endTime: '15:00',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.shift.encryptedName).toBe('encrypted-updated-morning-shift')
  })

  test('update shift users', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/shifts/${shiftId}`), {
      userPubkeys: [ctx.user('volunteer').pubkey, ctx.user('hub-admin').pubkey],
    })
    expect(res.status()).toBe(200)
  })

  test('update nonexistent shift returns 404', async () => {
    const res = await adminApi.patch(ctx.hubPath('/shifts/nonexistent-id'), {
      encryptedName: 'encrypted-ghost-shift',
    })
    expect(res.status()).toBe(404)
  })

  // ─── Fallback Group ──────────────────────────────────────────────────────

  test('set fallback group', async () => {
    const res = await adminApi.put(ctx.hubPath('/shifts/fallback'), {
      volunteers: [ctx.user('volunteer').pubkey],
    })
    expect(res.status()).toBe(200)
  })

  test('get fallback group', async () => {
    const res = await adminApi.get(ctx.hubPath('/shifts/fallback'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.users).toBeDefined()
    expect(Array.isArray(body.users)).toBe(true)
  })

  // ─── My Status ───────────────────────────────────────────────────────────

  test('user can check own shift status', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/shifts/my-status'))
    expect(res.status()).toBe(200)
  })

  // ─── Delete ──────────────────────────────────────────────────────────────

  test('delete shift', async () => {
    expect(shiftId).toBeDefined()
    const res = await adminApi.delete(ctx.hubPath(`/shifts/${shiftId}`))
    expect(res.status()).toBe(200)

    // Verify deleted
    const listRes = await adminApi.get(ctx.hubPath('/shifts'))
    const body = await listRes.json()
    expect(body.shifts.some((s: { id: string }) => s.id === shiftId)).toBe(false)
  })

  test('delete nonexistent shift is handled gracefully', async () => {
    const res = await adminApi.delete(ctx.hubPath('/shifts/nonexistent-id'))
    // Server may return 200 (idempotent) or 404 (not found)
    expect([200, 404]).toContain(res.status())
  })

  // ─── Permission Enforcement ──────────────────────────────────────────────

  test('user cannot create shifts', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/shifts'), {
      encryptedName: 'encrypted-unauthorized-shift',
      startTime: '09:00',
      endTime: '17:00',
      days: [1],
      userPubkeys: [],
    })
    expect(res.status()).toBe(403)
  })

  test('user cannot delete shifts', async () => {
    // Create a shift first
    const createRes = await adminApi.post(ctx.hubPath('/shifts'), {
      encryptedName: 'encrypted-temp-shift',
      startTime: '09:00',
      endTime: '17:00',
      days: [1],
      userPubkeys: [],
    })
    const { shift } = await createRes.json()

    const res = await ctx.api('volunteer').delete(ctx.hubPath(`/shifts/${shift.id}`))
    expect(res.status()).toBe(403)

    // Cleanup
    await adminApi.delete(ctx.hubPath(`/shifts/${shift.id}`))
  })
})
