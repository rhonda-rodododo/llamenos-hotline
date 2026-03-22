import { test, expect } from '@playwright/test'
import { loginAsAdmin, resetTestState } from './helpers'
import { createVolunteerViaApi } from './api-helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

test.describe('Hub membership management', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    // Inject authed fetch helper that uses keyManager for auth headers
    await page.evaluate(() => {
      window.__authedFetch = async (url: string, options: RequestInit = {}) => {
        const km = (window as any).__TEST_KEY_MANAGER
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        }
        if (km?.isUnlocked()) {
          const reqMethod = (options.method || 'GET').toUpperCase()
          const reqPath = new URL(url, location.origin).pathname
          const token = km.createAuthToken(Date.now(), reqMethod, reqPath)
          headers['Authorization'] = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })
  })

  test('add a volunteer as hub member and then remove them', async ({ page, request }) => {
    // Create a volunteer via API
    const vol = await createVolunteerViaApi(request)

    // Create a hub via authed fetch
    const hubResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Membership Test Hub', description: 'E2E hub membership test' }),
      })
      if (!res.ok) return { error: await res.text(), status: res.status }
      return res.json()
    })
    expect(hubResult).toHaveProperty('hub')
    const hubId = (hubResult as { hub: { id: string } }).hub.id

    // Add the volunteer as a hub member with role-volunteer
    const addResult = await page.evaluate(
      async ({ hId, pubkey }: { hId: string; pubkey: string }) => {
        const res = await window.__authedFetch(`/api/hubs/${hId}/members`, {
          method: 'POST',
          body: JSON.stringify({ pubkey, roleIds: ['role-volunteer'] }),
        })
        return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : await res.text() }
      },
      { hId: hubId, pubkey: vol.pubkey }
    )
    expect(addResult.ok).toBe(true)

    // Remove the volunteer from the hub
    const removeResult = await page.evaluate(
      async ({ hId, pubkey }: { hId: string; pubkey: string }) => {
        const res = await window.__authedFetch(`/api/hubs/${hId}/members/${pubkey}`, {
          method: 'DELETE',
        })
        return { ok: res.ok, status: res.status }
      },
      { hId: hubId, pubkey: vol.pubkey }
    )
    expect(removeResult.ok).toBe(true)
  })

  test('adding a member with an invalid pubkey returns error', async ({ page }) => {
    // Create a hub to test against
    const hubResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Error Test Hub' }),
      })
      return res.json()
    })
    const hubId = (hubResult as { hub: { id: string } }).hub.id

    // Attempt to add a member with an empty/invalid pubkey
    const result = await page.evaluate(async (hId: string) => {
      const res = await window.__authedFetch(`/api/hubs/${hId}/members`, {
        method: 'POST',
        body: JSON.stringify({ pubkey: '', roleIds: [] }),
      })
      return { ok: res.ok, status: res.status }
    }, hubId)
    expect(result.ok).toBe(false)
    expect([400, 422, 500]).toContain(result.status)
  })

  test('hub membership is isolated across hubs (volunteer added to hub1 not in hub2)', async ({ page, request }) => {
    // Create a volunteer
    const vol = await createVolunteerViaApi(request)

    // Create two hubs
    const hubs = await page.evaluate(async () => {
      const r1 = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Isolation Hub 1' }),
      })
      const r2 = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Isolation Hub 2' }),
      })
      return [(await r1.json()).hub, (await r2.json()).hub] as Array<{ id: string; name: string }>
    })
    const [hub1, hub2] = hubs

    // Add volunteer to hub1 only
    await page.evaluate(
      async ({ hId, pubkey }: { hId: string; pubkey: string }) => {
        await window.__authedFetch(`/api/hubs/${hId}/members`, {
          method: 'POST',
          body: JSON.stringify({ pubkey, roleIds: ['role-volunteer'] }),
        })
      },
      { hId: hub1.id, pubkey: vol.pubkey }
    )

    // Fetch volunteer record and verify hub roles
    const volRecord = await page.evaluate(async (pubkey: string) => {
      const res = await window.__authedFetch(`/api/volunteers/${pubkey}`)
      return res.json()
    }, vol.pubkey)

    const hubIds: string[] = ((volRecord as { volunteer?: { hubRoles?: Array<{ hubId: string }> } }).volunteer?.hubRoles ?? []).map(
      (r: { hubId: string }) => r.hubId
    )
    expect(hubIds).toContain(hub1.id)
    expect(hubIds).not.toContain(hub2.id)
  })

  test('hub member add is idempotent (adding same member twice is safe)', async ({ page, request }) => {
    const vol = await createVolunteerViaApi(request)

    const hubResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/hubs', {
        method: 'POST',
        body: JSON.stringify({ name: 'Idempotency Hub' }),
      })
      return res.json()
    })
    const hubId = (hubResult as { hub: { id: string } }).hub.id

    // First add
    const add1 = await page.evaluate(
      async ({ hId, pubkey }: { hId: string; pubkey: string }) => {
        const res = await window.__authedFetch(`/api/hubs/${hId}/members`, {
          method: 'POST',
          body: JSON.stringify({ pubkey, roleIds: ['role-volunteer'] }),
        })
        return { ok: res.ok, status: res.status }
      },
      { hId: hubId, pubkey: vol.pubkey }
    )
    expect(add1.ok).toBe(true)

    // Second add (same member) — should be accepted or return a clear error, not a 500
    const add2 = await page.evaluate(
      async ({ hId, pubkey }: { hId: string; pubkey: string }) => {
        const res = await window.__authedFetch(`/api/hubs/${hId}/members`, {
          method: 'POST',
          body: JSON.stringify({ pubkey, roleIds: ['role-volunteer'] }),
        })
        return { ok: res.ok, status: res.status }
      },
      { hId: hubId, pubkey: vol.pubkey }
    )
    // 200/201 (upsert) or 409 (conflict) are both acceptable; 500 is not
    expect(add2.status).not.toBe(500)
  })
})
