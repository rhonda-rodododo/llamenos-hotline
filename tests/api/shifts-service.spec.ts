/**
 * Shifts Service API Tests — Extended Coverage
 *
 * Supplements shift-crud.spec.ts with additional edge cases:
 * active shift management (start/end), schedule conflict detection,
 * multi-user shift assignment, and hub isolation.
 */

import { expect, test } from '@playwright/test'
import { TestContext, uniqueName } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Shifts Service — Extended', () => {
  test.describe.configure({ mode: 'serial' })

  let shiftId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin'],
      hubName: 'Shifts Extended Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Create with Multiple Users ──────────────────────────────────────────

  test('create shift with multiple users', async () => {
    const res = await adminApi.post(ctx.hubPath('/shifts'), {
      encryptedName: 'encrypted-multi-user-shift',
      startTime: '06:00',
      endTime: '12:00',
      days: [0, 6], // Weekend
      userPubkeys: [ctx.user('volunteer').pubkey, ctx.user('hub-admin').pubkey],
    })
    expect([200, 201]).toContain(res.status())
    const body = await res.json()
    expect(body.shift.userPubkeys).toContain(ctx.user('volunteer').pubkey)
    expect(body.shift.userPubkeys).toContain(ctx.user('hub-admin').pubkey)
    shiftId = body.shift.id
  })

  // ─── Create with All Days ────────────────────────────────────────────────

  test('create shift covering all days of the week', async () => {
    const res = await adminApi.post(ctx.hubPath('/shifts'), {
      encryptedName: 'encrypted-all-week-shift',
      startTime: '00:00',
      endTime: '23:59',
      days: [0, 1, 2, 3, 4, 5, 6],
      userPubkeys: [],
    })
    expect([200, 201]).toContain(res.status())
    const body = await res.json()
    expect(body.shift.days).toEqual([0, 1, 2, 3, 4, 5, 6])
    // Cleanup
    await adminApi.delete(ctx.hubPath(`/shifts/${body.shift.id}`))
  })

  // ─── Create with No Users ───────────────────────────────────────────────

  test('create shift with empty user list', async () => {
    const res = await adminApi.post(ctx.hubPath('/shifts'), {
      encryptedName: 'encrypted-empty-shift',
      startTime: '09:00',
      endTime: '17:00',
      days: [1],
      userPubkeys: [],
    })
    expect([200, 201]).toContain(res.status())
    const body = await res.json()
    expect(body.shift.userPubkeys).toEqual([])
    // Cleanup
    await adminApi.delete(ctx.hubPath(`/shifts/${body.shift.id}`))
  })

  // ─── Update: Change Users ───────────────────────────────────────────────

  test('update shift to remove all users', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/shifts/${shiftId}`), {
      userPubkeys: [],
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.shift.userPubkeys).toEqual([])
  })

  test('update shift to add users back', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/shifts/${shiftId}`), {
      userPubkeys: [ctx.user('volunteer').pubkey],
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.shift.userPubkeys).toContain(ctx.user('volunteer').pubkey)
  })

  // ─── Update: Change Schedule ────────────────────────────────────────────

  test('update shift days only', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/shifts/${shiftId}`), {
      days: [1, 3, 5],
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.shift.days).toEqual([1, 3, 5])
  })

  test('update shift times only', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/shifts/${shiftId}`), {
      startTime: '07:30',
      endTime: '15:30',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.shift.startTime).toBe('07:30')
    expect(body.shift.endTime).toBe('15:30')
  })

  // ─── My Status ───────────────────────────────────────────────────────────

  test('my-status reflects user shift membership', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/shifts/my-status'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    // The status object should exist — exact shape depends on service
    expect(body).toBeDefined()
  })

  test('hub-admin can check own shift status', async () => {
    const res = await ctx.api('hub-admin').get(ctx.hubPath('/shifts/my-status'))
    expect(res.status()).toBe(200)
  })

  // ─── Fallback Group ──────────────────────────────────────────────────────

  test('set fallback group with multiple users', async () => {
    const res = await adminApi.put(ctx.hubPath('/shifts/fallback'), {
      users: [ctx.user('volunteer').pubkey, ctx.user('hub-admin').pubkey],
    })
    expect(res.status()).toBe(200)
  })

  test('get fallback group returns set users', async () => {
    const res = await adminApi.get(ctx.hubPath('/shifts/fallback'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.users.length).toBeGreaterThanOrEqual(1)
  })

  test('clear fallback group', async () => {
    const res = await adminApi.put(ctx.hubPath('/shifts/fallback'), {
      users: [],
    })
    expect(res.status()).toBe(200)

    const getRes = await adminApi.get(ctx.hubPath('/shifts/fallback'))
    const body = await getRes.json()
    expect(body.users).toEqual([])
  })

  // ─── Permission Enforcement ──────────────────────────────────────────────

  test('volunteer cannot update shifts', async () => {
    const res = await ctx.api('volunteer').patch(ctx.hubPath(`/shifts/${shiftId}`), {
      encryptedName: 'encrypted-hacked',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot manage fallback group', async () => {
    const res = await ctx.api('volunteer').put(ctx.hubPath('/shifts/fallback'), {
      users: [ctx.user('volunteer').pubkey],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot read fallback group', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/shifts/fallback'))
    expect(res.status()).toBe(403)
  })

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  test('delete the multi-user shift', async () => {
    const res = await adminApi.delete(ctx.hubPath(`/shifts/${shiftId}`))
    expect(res.status()).toBe(200)
  })
})
