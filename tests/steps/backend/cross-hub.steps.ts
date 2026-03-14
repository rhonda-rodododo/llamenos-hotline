/**
 * Cross-Hub Case Visibility step definitions (Epic 328).
 *
 * Tests the cross-hub sharing toggle — enable, disable, and default state.
 * Reuses the existing "case management is enabled" and "the server is reset"
 * steps from entity-schema.steps.ts and common.steps.ts respectively.
 */
import { expect } from '@playwright/test'
import { Given, When, Then, Before } from './fixtures'
import {
  enableCrossHubSharingViaApi,
  getCrossHubSharingViaApi,
} from '../../api-helpers'

// ── Local State ────────────────────────────────────────────────────

interface CrossHubState {
  crossHubEnabled?: boolean
}

let crossHub: CrossHubState

Before({ tags: '@cases' }, async () => {
  crossHub = {}
})

// ── Given ──────────────────────────────────────────────────────────

Given('cross-hub sharing is enabled', async ({ request }) => {
  const result = await enableCrossHubSharingViaApi(request, true)
  crossHub.crossHubEnabled = result.enabled
})

// ── When ───────────────────────────────────────────────────────────

When('the admin enables cross-hub sharing', async ({ request }) => {
  const result = await enableCrossHubSharingViaApi(request, true)
  crossHub.crossHubEnabled = result.enabled
})

When('the admin disables cross-hub sharing', async ({ request }) => {
  const result = await enableCrossHubSharingViaApi(request, false)
  crossHub.crossHubEnabled = result.enabled
})

// ── Then ───────────────────────────────────────────────────────────

Then('cross-hub sharing should be enabled', async ({ request }) => {
  const result = await getCrossHubSharingViaApi(request)
  expect(result.enabled).toBe(true)
})

Then('cross-hub sharing should be disabled', async ({ request }) => {
  const result = await getCrossHubSharingViaApi(request)
  expect(result.enabled).toBe(false)
})
