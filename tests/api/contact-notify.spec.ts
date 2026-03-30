import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Contact Notify API', () => {
  test.describe.configure({ mode: 'serial' })

  const adminApi = (request: import('@playwright/test').APIRequestContext) =>
    createAuthedRequestFromNsec(request, ADMIN_NSEC)

  let contactId: string

  test('setup: create contact', async ({ request }) => {
    const res = await adminApi(request).post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'notify-test-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    contactId = data.contact.id
    expect(contactId).toBeTruthy()
  })

  test('notify endpoint accepts notifications array', async ({ request }) => {
    const res = await adminApi(request).post(`/api/contacts/${contactId}/notify`, {
      notifications: [
        {
          contactId: 'support-contact-id',
          channel: { type: 'sms', identifier: '+15550001234' },
          message: 'Test notification',
        },
      ],
    })
    // Should return 200 with results (adapter may fail since SMS isn't configured in tests)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('results')
    expect(Array.isArray(data.results)).toBe(true)
    expect(data.results).toHaveLength(1)
    expect(data.results[0]).toHaveProperty('contactId', 'support-contact-id')
    expect(data.results[0]).toHaveProperty('status')
    // Status will be 'failed' since SMS isn't configured, but the endpoint works
    expect(['sent', 'failed']).toContain(data.results[0].status)
  })

  test('notify with empty notifications returns 400', async ({ request }) => {
    const res = await adminApi(request).post(`/api/contacts/${contactId}/notify`, {
      notifications: [],
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('notifications array is required')
  })

  test('notify for nonexistent contact returns 404', async ({ request }) => {
    const res = await adminApi(request).post(
      '/api/contacts/00000000-0000-0000-0000-000000000000/notify',
      {
        notifications: [
          {
            contactId: 'test',
            channel: { type: 'sms', identifier: '+15550001234' },
            message: 'Test',
          },
        ],
      }
    )
    expect(res.status()).toBe(404)
  })

  test('unauthenticated notify returns 401', async ({ request }) => {
    const res = await request.post(`/api/contacts/${contactId}/notify`, {
      data: { notifications: [] },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })

  test('cleanup: delete contact', async ({ request }) => {
    const res = await adminApi(request).delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })
})
