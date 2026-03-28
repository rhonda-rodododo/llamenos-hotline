import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Multi-hub architecture — API', () => {
  test.describe.configure({ mode: 'serial' })

  test('config returns hubs array', async ({ request }) => {
    const res = await request.get('/api/config')
    expect(res.ok()).toBe(true)
    const config = await res.json()
    expect(config).toHaveProperty('hubs')
    expect(Array.isArray(config.hubs)).toBe(true)
  })

  test('hub CRUD operations via API', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a hub
    const createRes = await authedApi.post('/api/hubs', {
      name: 'Test Hub',
      description: 'E2E test hub',
    })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created).toHaveProperty('hub')
    expect(created.hub.name).toBe('Test Hub')
    expect(created.hub.status).toBe('active')
    expect(created.hub.id).toBeTruthy()

    // List hubs — should include the new one
    const listRes = await authedApi.get('/api/hubs')
    expect(listRes.ok()).toBe(true)
    const listData = await listRes.json()
    expect(listData.hubs.some((h: { id: string }) => h.id === created.hub.id)).toBe(true)

    // Get hub details
    const getRes = await authedApi.get(`/api/hubs/${created.hub.id}`)
    expect(getRes.ok()).toBe(true)
    const fetched = await getRes.json()
    expect(fetched.hub.name).toBe('Test Hub')

    // Update hub
    const updateRes = await authedApi.patch(`/api/hubs/${created.hub.id}`, { name: 'Updated Hub' })
    expect(updateRes.ok()).toBe(true)
    const updated = await updateRes.json()
    expect(updated.hub.name).toBe('Updated Hub')
  })

  test('hub-scoped routes use per-hub DOs', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a hub
    const createRes = await authedApi.post('/api/hubs', { name: 'Scoped Hub' })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    // Access hub-scoped audit log
    const auditRes = await authedApi.get(`/api/hubs/${hubId}/audit`)
    expect(auditRes.ok()).toBe(true)
    const auditData = await auditRes.json()
    expect(auditData).toHaveProperty('entries')

    // Access hub-scoped shifts
    const shiftsRes = await authedApi.get(`/api/hubs/${hubId}/shifts`)
    expect(shiftsRes.ok()).toBe(true)
    const shiftsData = await shiftsRes.json()
    expect(shiftsData).toHaveProperty('shifts')

    // Access hub-scoped bans
    const bansRes = await authedApi.get(`/api/hubs/${hubId}/bans`)
    expect(bansRes.ok()).toBe(true)
    const bansData = await bansRes.json()
    expect(bansData).toHaveProperty('bans')

    // Hub-scoped data should be independent from global
    // The new hub should have empty bans (no global data leaking)
    expect(bansData.bans).toHaveLength(0)
  })

  test('hub member management', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a hub
    const createRes = await authedApi.post('/api/hubs', { name: 'Member Hub' })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    // Use admin's pubkey
    const adminPubkey = authedApi.pubkey

    // Add admin as member to the new hub with a different role
    const addRes = await authedApi.post(`/api/hubs/${hubId}/members`, {
      pubkey: adminPubkey,
      roleIds: ['role-volunteer'],
    })
    expect(addRes.ok()).toBe(true)

    // Remove member from hub
    const removeRes = await authedApi.delete(`/api/hubs/${hubId}/members/${adminPubkey}`)
    expect(removeRes.ok()).toBe(true)
  })

  test('hub delete via API returns 404 for nonexistent hub', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const deleteRes = await authedApi.delete('/api/hubs/nonexistent-hub-id')
    expect(deleteRes.status()).toBe(404)
  })

  test('hub-scoped data is isolated', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create two hubs
    const hub1Res = await authedApi.post('/api/hubs', { name: 'Hub A' })
    expect(hub1Res.ok()).toBe(true)
    const hub1 = (await hub1Res.json()).hub

    const hub2Res = await authedApi.post('/api/hubs', { name: 'Hub B' })
    expect(hub2Res.ok()).toBe(true)
    const hub2 = (await hub2Res.json()).hub

    // Create a ban in hub A
    const banRes = await authedApi.post(`/api/hubs/${hub1.id}/bans`, {
      phone: '+15559990001',
      reason: 'Hub A test ban',
    })
    expect(banRes.ok()).toBe(true)

    // Hub A should have the ban (phone is E2EE envelope-encrypted — check structural presence)
    const hub1BansRes = await authedApi.get(`/api/hubs/${hub1.id}/bans`)
    expect(hub1BansRes.ok()).toBe(true)
    const hub1Bans = await hub1BansRes.json()
    expect(hub1Bans.bans.length).toBeGreaterThan(0)
    // Ban phone is E2EE: encryptedPhone present, phone sentinel is '[encrypted]'
    expect(
      hub1Bans.bans.some((b: { encryptedPhone?: string }) => b.encryptedPhone !== undefined)
    ).toBe(true)

    // Hub B should NOT have the ban (isolated)
    const hub2BansRes = await authedApi.get(`/api/hubs/${hub2.id}/bans`)
    expect(hub2BansRes.ok()).toBe(true)
    const hub2Bans = await hub2BansRes.json()
    expect(hub2Bans.bans.length).toBe(0)
  })
})
