/**
 * Backend step definitions for hub management (Epic 353).
 *
 * Tests the GET /api/hubs and POST /api/hubs endpoints.
 * Admin creates hubs, lists them, and verifies they appear with
 * correct name and slug.
 */
import { expect } from '@playwright/test'
import { Given, When, Then, Before } from './fixtures'
import { apiGet, apiPost } from '../../api-helpers'
import { shared } from './shared-state'

// ── Local State ────────────────────────────────────────────────────

interface HubManagementState {
  hubList?: Array<{ id: string; name: string; slug: string; status: string }>
  createdHub?: { id: string; name: string; slug: string }
}

let hubState: HubManagementState

Before(async () => {
  hubState = {}
})

// ── Given ──────────────────────────────────────────────────────────

Given('the admin creates a hub via API', async ({ request }) => {
  const name = `BDD Hub ${Date.now()}`
  const slug = `bdd-hub-${Date.now()}`
  const res = await apiPost<{ hub: { id: string; name: string; slug: string } }>(
    request,
    '/hubs',
    { name, slug },
  )
  expect(res.status).toBe(200)
  hubState.createdHub = res.data.hub
})

// ── When ───────────────────────────────────────────────────────────

When('the admin lists all hubs', async ({ request }) => {
  const res = await apiGet<{ hubs: Array<{ id: string; name: string; slug: string; status: string }> }>(
    request,
    '/hubs',
  )
  expect(res.status).toBe(200)
  hubState.hubList = res.data.hubs
  shared.lastResponse = res
})

When(
  'the admin creates a hub with name {string} and slug {string}',
  async ({ request }, name: string, slug: string) => {
    const res = await apiPost<{ hub: { id: string; name: string; slug: string } }>(
      request,
      '/hubs',
      { name, slug },
    )
    shared.lastResponse = res
    if (res.data?.hub) {
      hubState.createdHub = res.data.hub
    }
  },
)

// ── Then ───────────────────────────────────────────────────────────

Then('the hub list should contain at least {int} hub', async ({}, count: number) => {
  expect(hubState.hubList).toBeTruthy()
  expect(hubState.hubList!.length).toBeGreaterThanOrEqual(count)
})

Then('each hub should have a name and slug', async () => {
  expect(hubState.hubList).toBeTruthy()
  for (const hub of hubState.hubList!) {
    expect(hub.name).toBeTruthy()
    expect(hub.slug).toBeTruthy()
  }
})

Then('the created hub should have name {string}', async ({}, expectedName: string) => {
  expect(hubState.createdHub).toBeTruthy()
  expect(hubState.createdHub!.name).toBe(expectedName)
})

Then('the created hub should have slug {string}', async ({}, expectedSlug: string) => {
  expect(hubState.createdHub).toBeTruthy()
  expect(hubState.createdHub!.slug).toBe(expectedSlug)
})

Then('the hub should appear in the list', async ({ request }) => {
  expect(hubState.createdHub).toBeTruthy()
  const res = await apiGet<{ hubs: Array<{ id: string }> }>(request, '/hubs')
  expect(res.status).toBe(200)
  const found = res.data.hubs.find(h => h.id === hubState.createdHub!.id)
  expect(found).toBeTruthy()
})
