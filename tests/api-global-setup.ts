/**
 * API test global setup — seeds the admin from ADMIN_PUBKEY via test-reset.
 * This is separate from the UI global setup which does real browser bootstrap.
 */
import { expect, test } from '@playwright/test'

const TEST_RESET_SECRET = process.env.DEV_RESET_SECRET || 'test-reset-secret'

test('reset test state for API tests', async ({ request }) => {
  // Retry in case the server is still initializing
  for (let i = 0; i < 10; i++) {
    try {
      const res = await request.post('/api/test-reset', {
        headers: { 'X-Test-Secret': TEST_RESET_SECRET },
      })
      if (res.ok()) return
      if (res.status() === 404) {
        throw new Error('test-reset returned 404 — ENVIRONMENT must be set to "development".')
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('returned 404')) throw err
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  // Final attempt with assertion
  const res = await request.post('/api/test-reset', {
    headers: { 'X-Test-Secret': TEST_RESET_SECRET },
  })
  expect(
    res.ok(),
    `test-reset failed with status ${res.status()}: ${await res.text()}`
  ).toBeTruthy()
})
