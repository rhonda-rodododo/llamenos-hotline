/**
 * Shared assertion step definitions used across multiple feature files.
 *
 * These read from the shared state module so that any When step from
 * any step file can set the response and these Then steps can verify it.
 */
import { expect } from '@playwright/test'
import { Then } from './fixtures'
import { shared } from './shared-state'

Then('the response status should be {int}', async ({}, expectedStatus: number) => {
  expect(shared.lastResponse).toBeDefined()
  expect(shared.lastResponse!.status).toBe(expectedStatus)
})

Then('the response status should not be {int}', async ({}, unexpectedStatus: number) => {
  expect(shared.lastResponse).toBeDefined()
  expect(shared.lastResponse!.status).not.toBe(unexpectedStatus)
})

Then('the response should indicate the role is protected', async ({}) => {
  expect(shared.lastResponse).toBeDefined()
  // System roles return 400 or 403 when deletion is attempted
  expect([400, 403]).toContain(shared.lastResponse!.status)
})
