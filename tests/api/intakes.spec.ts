import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Intakes API', () => {
  test.describe.configure({ mode: 'serial' })

  let intakeId: string

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  test('submit intake', async ({ request }) => {
    const res = await adminApi(request).post('/api/intakes', {
      encryptedPayload: 'encrypted-test-payload',
      payloadEnvelopes: [],
      callId: 'test-call-123',
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.intake).toHaveProperty('id')
    expect(data.intake.status).toBe('pending')
    expect(data.intake.encryptedPayload).toBe('encrypted-test-payload')
    expect(data.intake.callId).toBe('test-call-123')
    intakeId = data.intake.id
  })

  test('list intakes', async ({ request }) => {
    const res = await adminApi(request).get('/api/intakes')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('intakes')
    expect(Array.isArray(data.intakes)).toBe(true)
    expect(data.intakes.length).toBeGreaterThan(0)
  })

  test('list intakes with status filter', async ({ request }) => {
    const res = await adminApi(request).get('/api/intakes?status=pending')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.intakes.every((i: { status: string }) => i.status === 'pending')).toBe(true)
  })

  test('get single intake', async ({ request }) => {
    const res = await adminApi(request).get(`/api/intakes/${intakeId}`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.intake.id).toBe(intakeId)
  })

  test('get nonexistent intake returns 404', async ({ request }) => {
    const res = await adminApi(request).get('/api/intakes/nonexistent-id')
    expect(res.status()).toBe(404)
  })

  test('update intake status to reviewed', async ({ request }) => {
    const res = await adminApi(request).patch(`/api/intakes/${intakeId}`, {
      status: 'reviewed',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.intake.status).toBe('reviewed')
    expect(data.intake.reviewedBy).toBeTruthy()
  })

  test('update intake status to merged', async ({ request }) => {
    const res = await adminApi(request).patch(`/api/intakes/${intakeId}`, {
      status: 'merged',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.intake.status).toBe('merged')
  })

  test('update with invalid status returns 400', async ({ request }) => {
    const res = await adminApi(request).patch(`/api/intakes/${intakeId}`, {
      status: 'invalid-status',
    })
    expect(res.status()).toBe(400)
  })

  test('submit intake without payload returns 400', async ({ request }) => {
    const res = await adminApi(request).post('/api/intakes', {
      payloadEnvelopes: [],
    })
    expect(res.status()).toBe(400)
  })

  test('unauthenticated request returns 401', async ({ request }) => {
    const res = await request.get('/api/intakes')
    expect(res.status()).toBe(401)
  })
})
