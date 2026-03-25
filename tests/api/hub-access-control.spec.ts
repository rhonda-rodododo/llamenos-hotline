/**
 * Hub Admin Zero-Trust Visibility -- API Tests
 *
 * Verifies that:
 *   - New hubs default to allowSuperAdminAccess = false
 *   - Super admins cannot self-grant access via the API
 */

import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Hub access control API', () => {
  test.describe.configure({ mode: 'serial' })

  let testHubId: string
  const testHubName = `access-ctrl-api-${Date.now()}`

  test('newly created hub defaults to allowSuperAdminAccess = false', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a hub via API
    const createRes = await authedApi.post('/api/hubs', { name: testHubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created).toHaveProperty('hub')
    testHubId = created.hub.id

    // Verify via GET that allowSuperAdminAccess defaults to false
    const fetchRes = await authedApi.get(`/api/hubs/${testHubId}`)
    const fetched = await fetchRes.json()
    expect(fetched.hub.allowSuperAdminAccess).toBe(false)
  })

  test('super admin cannot self-grant hub access via PATCH /api/hubs/:hubId/settings', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // The admin user IS the super admin -- attempt to self-grant should be blocked
    const res = await authedApi.patch(`/api/hubs/${testHubId}/settings`, {
      allowSuperAdminAccess: true,
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Super admin cannot modify')
  })
})
