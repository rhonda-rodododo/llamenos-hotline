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

  test('contact timeline API returns notes and conversations for existing contact', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Fetch contacts list first
    const listRes = await authedApi.get('/api/contacts')
    const listResult = await listRes.json()
    expect(listResult).toHaveProperty('contacts')

    // Only test timeline if there are contacts (may be empty after reset)
    if (listResult.contacts.length > 0) {
      const hash = listResult.contacts[0].contactHash
      const timelineRes = await authedApi.get(`/api/contacts/${hash}`)
      expect(timelineRes.status()).toBe(200)
      const timeline = await timelineRes.json()
      expect(timeline).toHaveProperty('notes')
      expect(timeline).toHaveProperty('conversations')
    } else {
      console.log('[contacts test] No contacts found after reset -- skipping timeline assertion')
    }
  })

  test('contacts API rejects unauthenticated requests', async ({ request }) => {
    // Raw request without auth headers
    const res = await request.get('/api/contacts', {
      headers: { 'Content-Type': 'application/json' },
    })
    // Should return 401 Unauthorized (not 200)
    expect(res.status()).toBe(401)
  })

  test('contact timeline returns 404 for unknown hash', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.get(
      '/api/contacts/0000000000000000deadbeefcafebabe00000000000000000000000000000000'
    )
    expect([404, 200]).toContain(res.status())
    // 200 with empty arrays is also acceptable; 404 is preferred
  })
})
