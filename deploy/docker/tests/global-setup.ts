import { test, expect } from '@playwright/test'

test('reset test state', async ({ request }) => {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await request.post('/api/test-reset')
      if (res.ok()) return
      if (res.status() === 404) {
        throw new Error(
          'test-reset returned 404 — ENVIRONMENT must be "development". ' +
          'Start Docker with: bun run test:docker:up',
        )
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('test-reset returned 404')) throw err
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  const res = await request.post('/api/test-reset')
  expect(res.ok(), `test-reset failed: ${res.status()}`).toBeTruthy()
})
