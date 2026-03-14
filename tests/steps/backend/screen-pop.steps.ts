/**
 * Screen Pop step definitions for Epic 326.
 *
 * Covers caller identification via identifier hash,
 * records-by-contact listing, and interaction count updates.
 * Reuses "case management is enabled" from entity-schema.steps.ts
 * and "the server is reset" from common.steps.ts.
 *
 * Step names are prefixed "screen-pop" to avoid collisions with
 * the similar CMS contact steps in cms.steps.ts.
 */
import { expect } from '@playwright/test'
import { Given, When, Then, Before } from './fixtures'
import {
  createContactViaApi,
  createRecordViaApi,
  createEntityTypeViaApi,
  listEntityTypesViaApi,
  linkContactToRecordViaApi,
  updateRecordViaApi,
  identifyCallerViaApi,
  lookupContactViaApi,
  listRecordsByContactViaApi,
} from '../../api-helpers'
import type { CallerIdentificationResult } from '../../api-helpers'

// ── Local State ────────────────────────────────────────────────────

interface ScreenPopState {
  lastContact?: Record<string, unknown>
  identificationResult?: CallerIdentificationResult
  lookupResult?: { contact: Record<string, unknown> | null }
  contactRecords?: { records: Record<string, unknown>[]; total: number }
  entityTypeId?: string
}

let sp: ScreenPopState

Before({ tags: '@telephony' }, async () => {
  sp = {}
})

// ── Helpers ────────────────────────────────────────────────────────

async function resolveOrCreateEntityType(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  if (sp.entityTypeId) return sp.entityTypeId

  const types = await listEntityTypesViaApi(request)
  const existing = types.find(t => t.name === 'screen_pop_case')
  if (existing) {
    sp.entityTypeId = existing.id as string
    return sp.entityTypeId
  }

  const created = await createEntityTypeViaApi(request, {
    name: 'screen_pop_case',
    category: 'case',
  })
  sp.entityTypeId = created.id as string
  return sp.entityTypeId
}

// ── Given Steps ────────────────────────────────────────────────────

Given('a screen-pop contact exists with identifier hash {string}', async ({ request }, hash: string) => {
  sp.lastContact = await createContactViaApi(request, { identifierHashes: [hash] })
})

Given('{int} open records are linked to the contact', async ({ request }, count: number) => {
  const entityTypeId = await resolveOrCreateEntityType(request)
  const contactId = sp.lastContact!.id as string

  for (let i = 0; i < count; i++) {
    const record = await createRecordViaApi(request, entityTypeId, {
      statusHash: 'status_open',
    })
    await linkContactToRecordViaApi(request, record.id as string, contactId, 'subject')
  }
})

Given('{int} closed record is linked to the contact', async ({ request }, count: number) => {
  const entityTypeId = await resolveOrCreateEntityType(request)
  const contactId = sp.lastContact!.id as string

  for (let i = 0; i < count; i++) {
    const record = await createRecordViaApi(request, entityTypeId, {
      statusHash: 'status_closed',
    })
    await linkContactToRecordViaApi(request, record.id as string, contactId, 'subject')
    // Close the record by setting closedAt
    await updateRecordViaApi(request, record.id as string, {
      closedAt: new Date().toISOString(),
    })
  }
})

// ── When Steps ─────────────────────────────────────────────────────

When('a call arrives from identifier hash {string}', async ({ request }, hash: string) => {
  sp.identificationResult = await identifyCallerViaApi(request, hash)
})

When('the admin looks up identifier hash {string}', async ({ request }, hash: string) => {
  sp.lookupResult = await lookupContactViaApi(request, hash)
})

When('the admin lists records for the contact', async ({ request }) => {
  const contactId = sp.lastContact!.id as string
  sp.contactRecords = await listRecordsByContactViaApi(request, contactId)
})

// ── Then Steps ─────────────────────────────────────────────────────

Then('the contact identification should return the matching contact', async () => {
  expect(sp.identificationResult).toBeTruthy()
  expect(sp.identificationResult!.contact).not.toBeNull()
  if (sp.lastContact) {
    expect(sp.identificationResult!.contact!.id).toBe(sp.lastContact.id)
  }
})

Then('the contact identification should return no match', async () => {
  expect(sp.identificationResult).toBeTruthy()
  expect(sp.identificationResult!.contact).toBeNull()
  expect(sp.identificationResult!.activeCaseCount).toBe(0)
})

Then('the lookup result should include the contact', async () => {
  expect(sp.lookupResult).toBeTruthy()
  expect(sp.lookupResult!.contact).not.toBeNull()
  expect(sp.lookupResult!.contact!.id).toBe(sp.lastContact!.id)
})

Then('the contact record list should have {int} records', async ({}, count: number) => {
  expect(sp.contactRecords).toBeTruthy()
  expect(sp.contactRecords!.records.length).toBe(count)
})

Then('no closed records should be included', async () => {
  expect(sp.contactRecords).toBeTruthy()
  for (const record of sp.contactRecords!.records) {
    expect(record.closedAt).toBeFalsy()
  }
})

Then('the contact interactionCount should be {int}', async ({ request }, count: number) => {
  // Re-fetch the contact via its identifier hash to get updated interaction count
  const identifierHashes = sp.lastContact!.identifierHashes as string[] | undefined
  if (!identifierHashes || identifierHashes.length === 0) {
    throw new Error('No identifier hashes on contact')
  }
  const result = await lookupContactViaApi(request, identifierHashes[0])
  expect(result.contact).not.toBeNull()
  expect(result.contact!.interactionCount).toBe(count)
})
