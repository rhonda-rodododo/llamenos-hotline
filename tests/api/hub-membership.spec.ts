import { test, expect } from '@playwright/test'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'
import { ADMIN_NSEC, resetTestState } from '../helpers'
import { createVolunteerViaApi } from '../api-helpers'

test.describe('Hub membership management', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test('add a volunteer as hub member and then remove them', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a volunteer via API
    const vol = await createVolunteerViaApi(request)

    // Create a hub
    const hubRes = await authedApi.post('/api/hubs', { name: 'Membership Test Hub', description: 'E2E hub membership test' })
    expect(hubRes.ok()).toBe(true)
    const hubResult = await hubRes.json()
    expect(hubResult).toHaveProperty('hub')
    const hubId = hubResult.hub.id

    // Add the volunteer as a hub member with role-volunteer
    const addRes = await authedApi.post(`/api/hubs/${hubId}/members`, { pubkey: vol.pubkey, roleIds: ['role-volunteer'] })
    expect(addRes.ok()).toBe(true)

    // Remove the volunteer from the hub
    const removeRes = await authedApi.delete(`/api/hubs/${hubId}/members/${vol.pubkey}`)
    expect(removeRes.ok()).toBe(true)
  })

  test('adding a member with an invalid pubkey returns error', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a hub to test against
    const hubRes = await authedApi.post('/api/hubs', { name: 'Error Test Hub' })
    const hubResult = await hubRes.json()
    const hubId = hubResult.hub.id

    // Attempt to add a member with an empty/invalid pubkey
    const addRes = await authedApi.post(`/api/hubs/${hubId}/members`, { pubkey: '', roleIds: [] })
    expect(addRes.ok()).toBe(false)
    expect([400, 422, 500]).toContain(addRes.status())
  })

  test('hub membership is isolated across hubs (volunteer added to hub1 not in hub2)', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a volunteer
    const vol = await createVolunteerViaApi(request)

    // Create two hubs
    const hub1Res = await authedApi.post('/api/hubs', { name: 'Isolation Hub 1' })
    const hub2Res = await authedApi.post('/api/hubs', { name: 'Isolation Hub 2' })
    const hub1 = (await hub1Res.json()).hub
    const hub2 = (await hub2Res.json()).hub

    // Add volunteer to hub1 only
    await authedApi.post(`/api/hubs/${hub1.id}/members`, { pubkey: vol.pubkey, roleIds: ['role-volunteer'] })

    // Fetch volunteer record and verify hub roles
    const volRes = await authedApi.get(`/api/volunteers/${vol.pubkey}`)
    const volRecord = await volRes.json()

    // Single volunteer endpoint returns projected volunteer directly (not wrapped in {volunteer: ...})
    const hubIds: string[] = (volRecord.hubRoles ?? []).map(
      (r: { hubId: string }) => r.hubId,
    )
    expect(hubIds).toContain(hub1.id)
    expect(hubIds).not.toContain(hub2.id)
  })

  test('hub member add is idempotent (adding same member twice is safe)', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const vol = await createVolunteerViaApi(request)

    const hubRes = await authedApi.post('/api/hubs', { name: 'Idempotency Hub' })
    const hubId = (await hubRes.json()).hub.id

    // First add
    const add1 = await authedApi.post(`/api/hubs/${hubId}/members`, { pubkey: vol.pubkey, roleIds: ['role-volunteer'] })
    expect(add1.ok()).toBe(true)

    // Second add (same member) — should be accepted or return a clear error, not a 500
    const add2 = await authedApi.post(`/api/hubs/${hubId}/members`, { pubkey: vol.pubkey, roleIds: ['role-volunteer'] })
    // 200/201 (upsert) or 409 (conflict) are both acceptable; 500 is not
    expect(add2.status()).not.toBe(500)
  })
})
