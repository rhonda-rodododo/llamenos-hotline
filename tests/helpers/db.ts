import type { APIRequestContext, Page } from '@playwright/test'

const TEST_RESET_SECRET = process.env.DEV_RESET_SECRET || 'test-reset-secret'

/**
 * Full test reset: clears all state (call records, shifts, conversations, users)
 * except the admin account. Use in beforeEach/afterEach for complete isolation.
 */
export async function resetTestState(request: APIRequestContext) {
  const res = await request.post('/api/test-reset', {
    headers: { 'X-Test-Secret': TEST_RESET_SECRET },
  })
  if (!res.ok()) {
    throw new Error(`test-reset failed with status ${res.status()}: ${await res.text()}`)
  }
}

/**
 * Create a test hub via the authed API using the admin session baked into `page`.
 * Returns the new hub's ID.
 *
 * Usage: call in `test.beforeAll`, pair with `deleteTestHub` in `test.afterAll`
 * to get a fully isolated hub for each test file.
 *
 * Requires window.__authedFetch to be injected (see multi-hub.spec.ts beforeEach pattern).
 */
export async function createTestHub(page: Page, name: string): Promise<string> {
  const created = await page.evaluate(async (hubName: string) => {
    const fetch = window.__authedFetch ?? window.fetch
    const res = await fetch('/api/hubs', {
      method: 'POST',
      body: JSON.stringify({ name: hubName }),
    })
    if (!res.ok) throw new Error(`createTestHub failed: ${res.status} ${await res.text()}`)
    return res.json()
  }, name)
  return created.hub.id
}

/**
 * Delete a test hub via the authed API.
 * Safe to call even if the hub was already deleted (404 is ignored).
 *
 * Requires window.__authedFetch to be injected (see multi-hub.spec.ts beforeEach pattern).
 */
export async function deleteTestHub(page: Page, hubId: string): Promise<void> {
  await page.evaluate(async (id: string) => {
    const fetch = window.__authedFetch ?? window.fetch
    const res = await fetch(`/api/hubs/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      throw new Error(`deleteTestHub failed: ${res.status} ${await res.text()}`)
    }
  }, hubId)
}
