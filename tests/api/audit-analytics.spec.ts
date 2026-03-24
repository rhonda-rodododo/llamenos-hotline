/**
 * Audit Log and Analytics API Tests
 *
 * Audit log querying with filters, analytics endpoints, and data format validation.
 */

import { test, expect } from '@playwright/test'
import { TestContext, uniquePhone } from '../api-helpers'
import { createAuthedRequestFromNsec, type AuthedRequest } from '../helpers/authed-request'
import { ADMIN_NSEC } from '../helpers'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Audit Log and Analytics', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin'],
      hubName: 'Audit Analytics Hub',
    })

    // Generate some audit entries by performing actions
    const setup = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Ban a number (creates audit entry)
    await setup.post(ctx.hubPath('/bans'), { phone: '+15550000077', reason: 'Audit test' })
    // Create and delete a shift (creates audit entries)
    const shiftRes = await setup.post(ctx.hubPath('/shifts'), {
      name: 'Audit Test Shift',
      startTime: '09:00',
      endTime: '17:00',
      days: [1],
      volunteerPubkeys: [],
    })
    if (shiftRes.ok()) {
      const { shift } = await shiftRes.json()
      await setup.delete(ctx.hubPath(`/shifts/${shift.id}`))
    }
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Audit Log ───────────────────────────────────────────────────────────

  test.describe('Audit Log', () => {
    test('admin can query audit log', async () => {
      const res = await adminApi.get(ctx.hubPath('/audit'))
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.entries).toBeDefined()
      expect(Array.isArray(body.entries)).toBe(true)
    })

    test('audit entries have required structure', async () => {
      const res = await adminApi.get(ctx.hubPath('/audit'))
      const { entries } = await res.json()

      if (entries.length > 0) {
        const entry = entries[0]
        expect(entry).toHaveProperty('event')
        expect(entry).toHaveProperty('actorPubkey')
        expect(entry).toHaveProperty('createdAt')
        // Hash-chain fields
        expect(entry).toHaveProperty('entryHash')
      }
    })

    test('audit log supports pagination', async () => {
      const page1 = await adminApi.get(ctx.hubPath('/audit?page=1&limit=2'))
      expect(page1.status()).toBe(200)
      const body1 = await page1.json()
      expect(body1.entries.length).toBeLessThanOrEqual(2)

      if (body1.entries.length === 2) {
        const page2 = await adminApi.get(ctx.hubPath('/audit?page=2&limit=2'))
        expect(page2.status()).toBe(200)
      }
    })

    test('audit log supports filtering by event category', async () => {
      // eventType is a category filter: 'shifts', 'calls', 'settings', etc.
      const res = await adminApi.get(ctx.hubPath('/audit?eventType=shifts'))
      expect(res.status()).toBe(200)
      const { entries } = await res.json()
      const shiftEvents = ['shiftCreated', 'shiftUpdated', 'shiftDeleted']
      for (const entry of entries) {
        expect(shiftEvents).toContain(entry.event)
      }
    })

    test('audit log supports filtering by actor', async () => {
      const actorPubkey = adminApi.pubkey
      const res = await adminApi.get(ctx.hubPath(`/audit?actorPubkey=${actorPubkey}`))
      expect(res.status()).toBe(200)
      const { entries } = await res.json()
      for (const entry of entries) {
        expect(entry.actorPubkey).toBe(actorPubkey)
      }
    })

    test('audit log supports date range filtering', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 86400000)
      // Use YYYY-MM-DD format to avoid URL encoding issues with ISO timestamps
      const dateFrom = yesterday.toISOString().slice(0, 10)
      const dateTo = now.toISOString().slice(0, 10)

      const res = await adminApi.get(ctx.hubPath(`/audit?dateFrom=${dateFrom}&dateTo=${dateTo}`))
      expect(res.status()).toBe(200)
    })

    test('volunteer cannot access audit log', async () => {
      const res = await ctx.api('volunteer').get(ctx.hubPath('/audit'))
      expect(res.status()).toBe(403)
    })

    test('hub-admin can access audit log', async () => {
      const res = await ctx.api('hub-admin').get(ctx.hubPath('/audit'))
      expect(res.status()).toBe(200)
    })

    test('audit entries never contain plaintext phone numbers', async () => {
      // Use search to find ban-related entries
      const res = await adminApi.get(ctx.hubPath('/audit?search=numberBanned'))
      const { entries } = await res.json()
      for (const entry of entries) {
        const serialized = JSON.stringify(entry)
        // Should not contain the raw phone we used
        expect(serialized).not.toContain('+15550000077')
        // If details contain phoneHash, it should be a 64-char hex string
        if (entry.details?.phoneHash) {
          expect(entry.details.phoneHash).toMatch(/^[0-9a-f]{64}$/)
        }
      }
    })
  })

  // ─── Analytics ───────────────────────────────────────────────────────────

  test.describe('Analytics', () => {
    test('call volume analytics returns data for 7 days', async () => {
      const res = await adminApi.get(ctx.hubPath('/analytics/calls?days=7'))
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Should return array or object with daily data
      expect(body).toBeDefined()
    })

    test('call volume analytics returns data for 30 days', async () => {
      const res = await adminApi.get(ctx.hubPath('/analytics/calls?days=30'))
      expect(res.status()).toBe(200)
    })

    test('hourly distribution analytics', async () => {
      const res = await adminApi.get(ctx.hubPath('/analytics/hours'))
      expect(res.status()).toBe(200)
    })

    test('volunteer analytics (requires audit:read)', async () => {
      const res = await adminApi.get(ctx.hubPath('/analytics/volunteers'))
      expect(res.status()).toBe(200)
    })

    test('hub-admin can access analytics', async () => {
      const res = await ctx.api('hub-admin').get(ctx.hubPath('/analytics/calls?days=7'))
      expect(res.status()).toBe(200)
    })

    test('volunteer cannot access analytics', async () => {
      const res = await ctx.api('volunteer').get(ctx.hubPath('/analytics/calls?days=7'))
      expect(res.status()).toBe(403)
    })
  })
})
