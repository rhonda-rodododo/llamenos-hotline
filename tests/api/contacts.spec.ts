import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Contacts API', () => {
  test.describe.configure({ mode: 'serial' })

  test('contacts API endpoint returns contacts array', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
    expect(Array.isArray(data.contacts)).toBe(true)
  })

  test('contact timeline API returns calls, conversations, and notes', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Fetch contacts list first
    const listRes = await authedApi.get('/api/contacts')
    const listResult = await listRes.json()
    expect(listResult).toHaveProperty('contacts')

    // Only test timeline if there are contacts (may be empty after reset)
    if (listResult.contacts.length > 0) {
      const id = listResult.contacts[0].id
      const timelineRes = await authedApi.get(`/api/contacts/${id}/timeline`)
      expect(timelineRes.status()).toBe(200)
      const timeline = await timelineRes.json()
      expect(timeline).toHaveProperty('calls')
      expect(timeline).toHaveProperty('conversations')
      expect(timeline).toHaveProperty('notes')
    } else {
      console.log('[contacts test] No contacts found after reset -- skipping timeline assertion')
    }
  })

  test('contacts API rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/contacts', {
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })

  test('contact returns 404 for unknown ID', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.get('/api/contacts/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(404)
  })
})
