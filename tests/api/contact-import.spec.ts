import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Contact Import & Merge', () => {
  test.describe.configure({ mode: 'serial' })

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  // ---------------------------------------------------------------------------
  // Batch import
  // ---------------------------------------------------------------------------

  test('batch import creates contacts', async ({ request }) => {
    const api = adminApi(request)

    const contacts = Array.from({ length: 3 }, (_, i) => ({
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['import-test'],
      encryptedDisplayName: `import-contact-${i}`,
      displayNameEnvelopes: [],
    }))

    const res = await api.post('/api/contacts/import', { contacts })
    expect(res.status()).toBe(200)

    const data = await res.json()
    expect(data).toHaveProperty('created')
    expect(data).toHaveProperty('errors')
    expect(data.created).toBe(3)
    expect(data.errors).toHaveLength(0)
  })

  test('batch import rejects > 500 contacts', async ({ request }) => {
    const api = adminApi(request)

    const contacts = Array.from({ length: 501 }, (_, i) => ({
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: `overflow-${i}`,
      displayNameEnvelopes: [],
    }))

    const res = await api.post('/api/contacts/import', { contacts })
    expect(res.status()).toBe(400)

    const data = await res.json()
    expect(data.error).toMatch(/500/i)
  })

  test('batch import rejects empty contacts array', async ({ request }) => {
    const api = adminApi(request)

    const res = await api.post('/api/contacts/import', { contacts: [] })
    expect(res.status()).toBe(400)
  })

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  test('merge combines contacts and soft-deletes secondary', async ({ request }) => {
    const api = adminApi(request)

    // Create two contacts to merge
    const primaryRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['merge-primary'],
      encryptedDisplayName: 'Primary Contact',
      displayNameEnvelopes: [],
    })
    expect(primaryRes.status()).toBe(201)
    const primaryData = await primaryRes.json()
    const primaryId = primaryData.contact.id as string

    const secondaryRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['merge-secondary'],
      encryptedDisplayName: 'Secondary Contact',
      displayNameEnvelopes: [],
    })
    expect(secondaryRes.status()).toBe(201)
    const secondaryData = await secondaryRes.json()
    const secondaryId = secondaryData.contact.id as string

    // Merge secondary into primary
    const mergeRes = await api.post(`/api/contacts/${primaryId}/merge`, {
      secondaryId,
    })
    expect(mergeRes.status()).toBe(200)

    const mergeResult = await mergeRes.json()
    expect(mergeResult.ok).toBe(true)
    expect(mergeResult.primaryId).toBe(primaryId)
    // Merged tags should combine both sets
    expect(mergeResult.mergedTags).toContain('merge-primary')
    expect(mergeResult.mergedTags).toContain('merge-secondary')

    // Primary contact should still be accessible
    const primaryCheck = await api.get(`/api/contacts/${primaryId}`)
    expect(primaryCheck.status()).toBe(200)

    // Secondary should be soft-deleted (404 or mergedInto set)
    const secondaryCheck = await api.get(`/api/contacts/${secondaryId}`)
    // Either 404 (filtered out) or accessible with mergedInto set — both valid
    if (secondaryCheck.status() === 200) {
      const secondaryResult = await secondaryCheck.json()
      expect(secondaryResult.contact.mergedInto).toBe(primaryId)
    } else {
      expect(secondaryCheck.status()).toBe(404)
    }

    // Cleanup
    await api.delete(`/api/contacts/${primaryId}`)
  })

  test('merge returns 404 for unknown primary contact', async ({ request }) => {
    const api = adminApi(request)

    // Create a real secondary contact
    const secondaryRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'Temp Secondary',
      displayNameEnvelopes: [],
    })
    expect(secondaryRes.status()).toBe(201)
    const { contact } = await secondaryRes.json()

    const res = await api.post('/api/contacts/00000000-0000-0000-0000-000000000000/merge', {
      secondaryId: contact.id,
    })
    expect(res.status()).toBe(404)

    // Cleanup
    await api.delete(`/api/contacts/${contact.id}`)
  })

  test('merge returns 400 when secondaryId is missing', async ({ request }) => {
    const api = adminApi(request)

    const primaryRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'Temp Primary',
      displayNameEnvelopes: [],
    })
    expect(primaryRes.status()).toBe(201)
    const { contact } = await primaryRes.json()

    const res = await api.post(`/api/contacts/${contact.id}/merge`, {})
    expect(res.status()).toBe(400)

    // Cleanup
    await api.delete(`/api/contacts/${contact.id}`)
  })
})
