import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Teams API', () => {
  test.describe.configure({ mode: 'serial' })

  let teamId: string

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  test('list teams returns array', async ({ request }) => {
    const res = await adminApi(request).get('/api/teams')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('teams')
    expect(Array.isArray(data.teams)).toBe(true)
  })

  test('create team', async ({ request }) => {
    const res = await adminApi(request).post('/api/teams', {
      encryptedName: 'encrypted-team-name',
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.team).toHaveProperty('id')
    expect(data.team).toHaveProperty('encryptedName', 'encrypted-team-name')
    teamId = data.team.id
  })

  test('create team rejects missing encryptedName', async ({ request }) => {
    const res = await adminApi(request).post('/api/teams', {})
    expect(res.status()).toBe(400)
  })

  test('update team', async ({ request }) => {
    const res = await adminApi(request).patch(`/api/teams/${teamId}`, {
      encryptedName: 'updated-team-name',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.team.encryptedName).toBe('updated-team-name')
  })

  test('update nonexistent team returns 404', async ({ request }) => {
    const res = await adminApi(request).patch('/api/teams/00000000-0000-0000-0000-000000000000', {
      encryptedName: 'nope',
    })
    expect(res.status()).toBe(404)
  })

  test('list members (initially empty)', async ({ request }) => {
    const res = await adminApi(request).get(`/api/teams/${teamId}/members`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.members).toHaveLength(0)
  })

  test('add member', async ({ request }) => {
    const api = adminApi(request)
    const meRes = await api.get('/api/users/me')
    const me = await meRes.json()

    const res = await api.post(`/api/teams/${teamId}/members`, {
      pubkeys: [me.user.pubkey],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('added')
    expect(data.added).toBe(1)
  })

  test('add member rejects empty pubkeys', async ({ request }) => {
    const res = await adminApi(request).post(`/api/teams/${teamId}/members`, {
      pubkeys: [],
    })
    expect(res.status()).toBe(400)
  })

  test('list members shows added member', async ({ request }) => {
    const res = await adminApi(request).get(`/api/teams/${teamId}/members`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.members.length).toBeGreaterThan(0)
  })

  test('list team contacts (initially empty)', async ({ request }) => {
    const res = await adminApi(request).get(`/api/teams/${teamId}/contacts`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.assignments).toHaveLength(0)
  })

  test('assign contacts to team', async ({ request }) => {
    const api = adminApi(request)

    // Create a contact first
    const contactRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'team-test-contact',
      displayNameEnvelopes: [],
    })
    expect(contactRes.status()).toBe(201)
    const contactId = (await contactRes.json()).contact.id

    const res = await api.post(`/api/teams/${teamId}/contacts`, {
      contactIds: [contactId],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.assigned).toBe(1)
    expect(data.skipped).toBe(0)
  })

  test('duplicate assignment is skipped', async ({ request }) => {
    const api = adminApi(request)

    // Get assignments to find existing contactId
    const listRes = await api.get(`/api/teams/${teamId}/contacts`)
    const assignments = (await listRes.json()).assignments
    expect(assignments.length).toBeGreaterThan(0)
    const contactId = assignments[0].contactId

    const res = await api.post(`/api/teams/${teamId}/contacts`, {
      contactIds: [contactId],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.skipped).toBe(1)
  })

  test('assign contacts rejects empty contactIds', async ({ request }) => {
    const res = await adminApi(request).post(`/api/teams/${teamId}/contacts`, {
      contactIds: [],
    })
    expect(res.status()).toBe(400)
  })

  test('unassign contact', async ({ request }) => {
    const api = adminApi(request)

    const listRes = await api.get(`/api/teams/${teamId}/contacts`)
    const assignments = (await listRes.json()).assignments
    expect(assignments.length).toBeGreaterThan(0)
    const contactId = assignments[0].contactId

    const res = await api.delete(`/api/teams/${teamId}/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })

  test('unassign nonexistent contact returns 404', async ({ request }) => {
    const res = await adminApi(request).delete(
      `/api/teams/${teamId}/contacts/00000000-0000-0000-0000-000000000000`
    )
    expect(res.status()).toBe(404)
  })

  test('remove member', async ({ request }) => {
    const api = adminApi(request)

    const membersRes = await api.get(`/api/teams/${teamId}/members`)
    const members = (await membersRes.json()).members
    expect(members.length).toBeGreaterThan(0)
    const memberPubkey = members[0].userPubkey

    const res = await api.delete(`/api/teams/${teamId}/members/${memberPubkey}`)
    expect(res.status()).toBe(200)
  })

  test('remove nonexistent member returns 404', async ({ request }) => {
    const res = await adminApi(request).delete(
      `/api/teams/${teamId}/members/0000000000000000000000000000000000000000000000000000000000000000`
    )
    expect(res.status()).toBe(404)
  })

  test('delete team cascades', async ({ request }) => {
    const res = await adminApi(request).delete(`/api/teams/${teamId}`)
    expect(res.status()).toBe(200)
  })

  test('deleted team is gone', async ({ request }) => {
    const res = await adminApi(request).get('/api/teams')
    const data = await res.json()
    const found = data.teams.find((t: { id: string }) => t.id === teamId)
    expect(found).toBeUndefined()
  })

  test('delete nonexistent team returns 404', async ({ request }) => {
    const res = await adminApi(request).delete('/api/teams/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(404)
  })

  test('unauthenticated request is rejected', async ({ request }) => {
    const res = await request.get('/api/teams', {
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })
})
