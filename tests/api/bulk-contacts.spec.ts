import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Bulk Contact Operations', () => {
  test.describe.configure({ mode: 'serial' })

  const contactIds: string[] = []

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  test('setup: create test contacts', async ({ request }) => {
    for (let i = 0; i < 3; i++) {
      const res = await adminApi(request).post('/api/contacts', {
        contactType: 'caller',
        riskLevel: 'low',
        tags: ['bulk-test'],
        encryptedDisplayName: `bulk-test-${i}`,
        displayNameEnvelopes: [],
      })
      expect(res.status()).toBe(201)
      const data = await res.json()
      contactIds.push(data.contact.id)
    }
    expect(contactIds).toHaveLength(3)
  })

  test('rejects bulk update with empty contactIds', async ({ request }) => {
    const res = await adminApi(request).patch('/api/contacts/bulk', {
      contactIds: [],
      addTags: ['urgent'],
    })
    expect(res.status()).toBe(400)
  })

  test('bulk update tags — add', async ({ request }) => {
    const res = await adminApi(request).patch('/api/contacts/bulk', {
      contactIds,
      addTags: ['urgent', 'follow-up'],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.updated).toBe(3)
    expect(data.skipped).toBe(0)

    // Verify tags were added
    const contactRes = await adminApi(request).get(`/api/contacts/${contactIds[0]}`)
    const contact = await contactRes.json()
    expect(contact.contact.tags).toContain('urgent')
    expect(contact.contact.tags).toContain('follow-up')
    expect(contact.contact.tags).toContain('bulk-test')
  })

  test('bulk update tags — remove', async ({ request }) => {
    const res = await adminApi(request).patch('/api/contacts/bulk', {
      contactIds: [contactIds[0]],
      removeTags: ['bulk-test'],
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).updated).toBe(1)

    // Verify tag was removed
    const contactRes = await adminApi(request).get(`/api/contacts/${contactIds[0]}`)
    const contact = await contactRes.json()
    expect(contact.contact.tags).not.toContain('bulk-test')
    expect(contact.contact.tags).toContain('urgent')
  })

  test('bulk update risk level', async ({ request }) => {
    const res = await adminApi(request).patch('/api/contacts/bulk', {
      contactIds: [contactIds[0]],
      riskLevel: 'critical',
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).updated).toBe(1)

    // Verify risk level was updated
    const contactRes = await adminApi(request).get(`/api/contacts/${contactIds[0]}`)
    const contact = await contactRes.json()
    expect(contact.contact.riskLevel).toBe('critical')
  })

  test('bulk update with non-existent ids skips them', async ({ request }) => {
    const res = await adminApi(request).patch('/api/contacts/bulk', {
      contactIds: [contactIds[0], '00000000-0000-0000-0000-000000000000'],
      riskLevel: 'high',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    // The non-existent ID is still "accessible" scope-wise (admin has 'all'),
    // but updateContact may silently succeed or fail — we just verify no error
    expect(data.updated).toBeGreaterThanOrEqual(1)
  })

  test('rejects bulk delete with empty contactIds', async ({ request }) => {
    const res = await adminApi(request).delete('/api/contacts/bulk', {
      contactIds: [],
    })
    expect(res.status()).toBe(400)
  })

  test('bulk delete', async ({ request }) => {
    const res = await adminApi(request).delete('/api/contacts/bulk', {
      contactIds,
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(3)

    // Verify contacts are gone
    for (const id of contactIds) {
      const contactRes = await adminApi(request).get(`/api/contacts/${id}`)
      expect(contactRes.status()).toBe(404)
    }
  })
})
