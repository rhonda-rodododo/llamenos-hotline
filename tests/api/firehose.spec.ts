/**
 * Firehose Connection CRUD API Tests
 *
 * Full lifecycle: create, list, get, status, update, pause/resume, delete.
 * Permission enforcement (firehose:manage and firehose:read required).
 * Uses hub-scoped routes so each test run is isolated.
 *
 * NOTE: POST /firehose returns 503 when FIREHOSE_AGENT_SEAL_KEY is not set.
 * Tests that create connections check for 503 and skip gracefully when the
 * seal key is not configured in the test environment.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Firehose Connections API', () => {
  test.describe.configure({ mode: 'serial' })

  let connectionId: string
  let reportTypeId: string
  let sealKeyConfigured: boolean

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Firehose Test Hub',
    })
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a report type for firehose connections to reference
    const rtRes = await adminApi.post(ctx.hubPath('/report-types'), {
      encryptedName: 'encrypted-firehose-test-report-type',
    })
    expect(rtRes.status()).toBe(201)
    const rtData = await rtRes.json()
    const rt = rtData.reportType ?? rtData
    reportTypeId = rt.id

    // Probe whether FIREHOSE_AGENT_SEAL_KEY is configured by attempting a create
    const probeRes = await adminApi.post(ctx.hubPath('/firehose'), {
      reportTypeId,
      displayName: 'probe-connection',
      extractionIntervalSec: 60,
      bufferTtlDays: 7,
    })
    if (probeRes.status() === 503) {
      sealKeyConfigured = false
      return
    }
    sealKeyConfigured = true
    expect(probeRes.status()).toBe(201)
    const probeData = await probeRes.json()
    connectionId = probeData.connection.id
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── CRUD ────────────────────────────────────────────────────────────────

  test('POST /firehose - creates a connection', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping create test')
      return
    }
    // connectionId was set during beforeAll probe — verify it was created correctly
    expect(connectionId).toBeTruthy()

    // Fetch the connection to verify fields
    const res = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection
    expect(conn.id).toBe(connectionId)
    expect(conn.agentPubkey).toBeTruthy()
    expect(conn.status).toBe('pending')
    expect(conn.reportTypeId).toBe(reportTypeId)
    // encryptedAgentNsec must NOT be in the response
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  test('GET /firehose - lists connections', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping list test')
      return
    }
    const res = await adminApi.get(ctx.hubPath('/firehose'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.connections)).toBe(true)
    expect(data.connections.length).toBeGreaterThanOrEqual(1)
    expect(data.connections.some((c: { id: string }) => c.id === connectionId)).toBe(true)
  })

  test('GET /firehose/:id - gets a connection', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping get test')
      return
    }
    const res = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection
    expect(conn.id).toBe(connectionId)
    expect(conn.reportTypeId).toBe(reportTypeId)
    expect(conn.hubId).toBe(ctx.hubId)
    expect(conn.agentPubkey).toBeTruthy()
    expect(typeof conn.extractionIntervalSec).toBe('number')
    expect(typeof conn.bufferTtlDays).toBe('number')
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  test('GET /firehose/status - returns health for all connections', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping status test')
      return
    }
    const res = await adminApi.get(ctx.hubPath('/firehose/status'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.statuses)).toBe(true)
    expect(data.statuses.some((s: { id: string }) => s.id === connectionId)).toBe(true)
    const health = data.statuses.find((s: { id: string }) => s.id === connectionId)
    expect(health).toBeDefined()
    expect(typeof health.bufferSize).toBe('number')
    expect(typeof health.extractionCount).toBe('number')
  })

  test('PATCH /firehose/:id - updates extraction interval and geo context', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping update test')
      return
    }
    const res = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      extractionIntervalSec: 120,
      geoContext: 'North America',
      geoContextCountryCodes: ['US', 'CA'],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection
    expect(conn.extractionIntervalSec).toBe(120)
    expect(conn.geoContext).toBe('North America')
    expect(conn.geoContextCountryCodes).toEqual(['US', 'CA'])
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  test('PATCH /firehose/:id - pauses and resumes connection', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping pause/resume test')
      return
    }

    // Pause
    const pauseRes = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      status: 'paused',
    })
    expect(pauseRes.status()).toBe(200)
    const paused = (await pauseRes.json()).connection
    expect(paused.status).toBe('paused')

    // Resume (set to active)
    const resumeRes = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      status: 'active',
    })
    expect(resumeRes.status()).toBe(200)
    const resumed = (await resumeRes.json()).connection
    expect(resumed.status).toBe('active')
  })

  test('PATCH /firehose/nonexistent-id - returns 404', async () => {
    const res = await adminApi.patch(ctx.hubPath('/firehose/nonexistent-conn-id'), {
      extractionIntervalSec: 60,
    })
    expect(res.status()).toBe(404)
  })

  test('GET /firehose/nonexistent-id - returns 404', async () => {
    const res = await adminApi.get(ctx.hubPath('/firehose/nonexistent-conn-id'))
    expect(res.status()).toBe(404)
  })

  test('DELETE /firehose/:id - deletes a connection', async () => {
    if (!sealKeyConfigured) {
      test.skip(true, 'FIREHOSE_AGENT_SEAL_KEY not configured — skipping delete test')
      return
    }

    // Delete the connection
    const deleteRes = await adminApi.delete(ctx.hubPath(`/firehose/${connectionId}`))
    expect(deleteRes.status()).toBe(200)
    const deleteData = await deleteRes.json()
    expect(deleteData.ok).toBe(true)

    // Verify it no longer exists
    const getRes = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(getRes.status()).toBe(404)
  })

  // ─── Permission Enforcement ──────────────────────────────────────────────

  test('volunteer cannot list firehose connections', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/firehose'))
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot create firehose connections', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/firehose'), {
      reportTypeId: reportTypeId ?? 'any-id',
      displayName: 'unauthorized-connection',
    })
    expect(res.status()).toBe(403)
  })

  // ─── POST returns 503 when seal key is missing ────────────────────────────

  test('POST /firehose - responds 503 when seal key not configured (env-dependent)', async () => {
    // This test verifies behavior in either env state:
    // - If sealKeyConfigured is false, the probe in beforeAll already returned 503
    // - If sealKeyConfigured is true, the key is set and we cannot easily test 503 here
    // We verify the route exists and behaves correctly based on env config.
    if (sealKeyConfigured) {
      // Key is configured — a valid request should succeed (already tested above)
      test.skip(true, 'Seal key is configured — 503 path not reachable in this env')
    } else {
      // Verify the 503 response contract
      const res = await adminApi.post(ctx.hubPath('/firehose'), {
        reportTypeId: reportTypeId ?? 'placeholder-id',
        displayName: 'no-key-connection',
      })
      expect(res.status()).toBe(503)
      const data = await res.json()
      expect(typeof data.error).toBe('string')
    }
  })
})
