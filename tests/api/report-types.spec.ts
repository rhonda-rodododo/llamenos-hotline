/**
 * Report Type Management API Tests
 *
 * CRUD for report types: create, update, archive, unarchive, set default.
 * Permission enforcement (settings:manage-fields required).
 * Uses hub-scoped routes since report_types table has FK to hubs.
 */

import { test, expect } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { createAuthedRequestFromNsec, type AuthedRequest } from '../helpers/authed-request'
import { ADMIN_NSEC } from '../helpers'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Report Type Management', () => {
  test.describe.configure({ mode: 'serial' })

  let reportTypeId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'reviewer'],
      hubName: 'ReportTypes Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── CRUD ────────────────────────────────────────────────────────────────

  test('create report type', async () => {
    const res = await adminApi.post(ctx.hubPath('/report-types'), {
      name: 'Incident Report',
      description: 'For logging incidents during calls',
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('Incident Report')
    reportTypeId = body.id
  })

  test('list report types', async () => {
    const res = await adminApi.get(ctx.hubPath('/report-types'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    const types = body.reportTypes ?? body
    expect(Array.isArray(types)).toBe(true)
    expect(types.some((t: { id: string }) => t.id === reportTypeId)).toBe(true)
  })

  test('update report type', async () => {
    expect(reportTypeId).toBeDefined()
    const res = await adminApi.patch(ctx.hubPath(`/report-types/${reportTypeId}`), {
      name: 'Updated Incident Report',
      description: 'Updated description',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated Incident Report')
  })

  test('set report type as default', async () => {
    expect(reportTypeId).toBeDefined()
    const res = await adminApi.post(ctx.hubPath(`/report-types/${reportTypeId}/default`))
    expect(res.status()).toBe(200)
  })

  test('archive report type', async () => {
    expect(reportTypeId).toBeDefined()
    const res = await adminApi.delete(ctx.hubPath(`/report-types/${reportTypeId}`))
    expect(res.status()).toBe(200)
  })

  test('unarchive report type', async () => {
    expect(reportTypeId).toBeDefined()
    const res = await adminApi.post(ctx.hubPath(`/report-types/${reportTypeId}/unarchive`))
    expect(res.status()).toBe(200)
  })

  // ─── Permission Enforcement ──────────────────────────────────────────────

  test('all authenticated users can read report types (hub-scoped)', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/report-types'))
    expect(res.status()).toBe(200)
  })

  test('volunteer cannot create report types', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/report-types'), {
      name: 'Unauthorized Type',
    })
    expect(res.status()).toBe(403)
  })

  test('reviewer cannot manage report types', async () => {
    const res = await ctx.api('reviewer').post(ctx.hubPath('/report-types'), {
      name: 'Unauthorized Type',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot archive report types', async () => {
    expect(reportTypeId).toBeDefined()
    const res = await ctx.api('volunteer').delete(ctx.hubPath(`/report-types/${reportTypeId}`))
    expect(res.status()).toBe(403)
  })

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  test('create multiple report types', async () => {
    const type1 = await adminApi.post(ctx.hubPath('/report-types'), {
      name: 'Feedback Report',
      description: 'General feedback',
    })
    expect(type1.status()).toBe(201)

    const type2 = await adminApi.post(ctx.hubPath('/report-types'), {
      name: 'Emergency Report',
      description: 'Emergency situations',
    })
    expect(type2.status()).toBe(201)

    // Verify both appear in list
    const listRes = await adminApi.get(ctx.hubPath('/report-types'))
    const body = await listRes.json()
    const types = body.reportTypes ?? body
    expect(types.length).toBeGreaterThanOrEqual(3)
  })

  test('update nonexistent report type returns 404', async () => {
    const res = await adminApi.patch(ctx.hubPath('/report-types/nonexistent-id'), {
      name: 'Ghost Type',
    })
    expect(res.status()).toBe(404)
  })
})
