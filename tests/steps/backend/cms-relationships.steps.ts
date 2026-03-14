/**
 * CMS relationship & affinity group step definitions for Epic 322.
 *
 * Covers contact-to-contact relationships and affinity groups with
 * member roles. Reuses "case management is enabled" from
 * entity-schema.steps.ts and "the server is reset" from common.steps.ts.
 */
import { expect } from '@playwright/test'
import { Given, When, Then, Before } from './fixtures'
import {
  createContactViaApi,
  createRelationshipViaApi,
  listRelationshipsViaApi,
  deleteRelationshipViaApi,
  createAffinityGroupViaApi,
  addGroupMemberViaApi,
  removeGroupMemberViaApi,
  listGroupMembersViaApi,
  getAffinityGroupViaApi,
  type RelationshipResult,
  type GroupResult,
  type GroupMemberResult,
} from '../../api-helpers'

// ── Local State ────────────────────────────────────────────────────

interface RelState {
  /** Named contacts: step alias → contact record */
  contacts: Map<string, Record<string, unknown>>
  /** Last relationship created */
  lastRelationship?: RelationshipResult
  /** Last relationship list result */
  relationshipList?: RelationshipResult[]
  /** Last affinity group created */
  lastGroup?: GroupResult
  /** Last group member list */
  groupMembers?: GroupMemberResult[]
}

let rel: RelState

Before({ tags: '@contacts' }, async () => {
  rel = {
    contacts: new Map(),
  }
})

// ── Helpers ────────────────────────────────────────────────────────

async function ensureNamedContact(
  request: import('@playwright/test').APIRequestContext,
  alias: string,
): Promise<Record<string, unknown>> {
  const existing = rel.contacts.get(alias)
  if (existing) return existing
  const contact = await createContactViaApi(request, {
    identifierHashes: [`idhash_${alias}_${Date.now()}`],
  })
  rel.contacts.set(alias, contact)
  return contact
}

// ============================================================
// RELATIONSHIP STEPS
// ============================================================

Given('a contact {string} exists', async ({ request }, alias: string) => {
  await ensureNamedContact(request, alias)
})

When(
  'the admin creates a {string} relationship from {string} to {string}',
  async ({ request }, relType: string, aliasA: string, aliasB: string) => {
    const a = rel.contacts.get(aliasA)
    const b = rel.contacts.get(aliasB)
    expect(a, `Contact "${aliasA}" not found`).toBeTruthy()
    expect(b, `Contact "${aliasB}" not found`).toBeTruthy()
    rel.lastRelationship = await createRelationshipViaApi(
      request,
      a!.id as string,
      b!.id as string,
      relType,
    )
  },
)

Then('the relationship should exist', async () => {
  expect(rel.lastRelationship).toBeTruthy()
  expect(rel.lastRelationship!.id).toBeTruthy()
})

Then(
  '{string} relationships should include {string}',
  async ({ request }, aliasA: string, aliasB: string) => {
    const a = rel.contacts.get(aliasA)
    const b = rel.contacts.get(aliasB)
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    const result = await listRelationshipsViaApi(request, a!.id as string)
    const bId = b!.id as string
    const found = result.relationships.some(
      r => r.contactIdA === bId || r.contactIdB === bId,
    )
    expect(found, `Expected ${aliasB} in ${aliasA}'s relationships`).toBe(true)
  },
)

Given(
  'contacts {string} and {string} with a bidirectional {string} relationship',
  async ({ request }, aliasA: string, aliasB: string, relType: string) => {
    const a = await ensureNamedContact(request, aliasA)
    const b = await ensureNamedContact(request, aliasB)
    rel.lastRelationship = await createRelationshipViaApi(
      request,
      a.id as string,
      b.id as string,
      relType,
      'bidirectional',
    )
  },
)

When('listing relationships for {string}', async ({ request }, alias: string) => {
  const contact = rel.contacts.get(alias)
  expect(contact, `Contact "${alias}" not found`).toBeTruthy()
  const result = await listRelationshipsViaApi(request, contact!.id as string)
  rel.relationshipList = result.relationships
})

Then('{string} should appear in the results', async ({}, alias: string) => {
  const contact = rel.contacts.get(alias)
  expect(contact, `Contact "${alias}" not found`).toBeTruthy()
  const contactId = contact!.id as string
  expect(rel.relationshipList).toBeTruthy()
  const found = rel.relationshipList!.some(
    r => r.contactIdA === contactId || r.contactIdB === contactId,
  )
  expect(found, `Expected ${alias} in relationship results`).toBe(true)
})

Given(
  'contacts {string} and {string} with a relationship',
  async ({ request }, aliasA: string, aliasB: string) => {
    const a = await ensureNamedContact(request, aliasA)
    const b = await ensureNamedContact(request, aliasB)
    rel.lastRelationship = await createRelationshipViaApi(
      request,
      a.id as string,
      b.id as string,
      'support_contact',
    )
  },
)

When('the admin deletes the relationship', async ({ request }) => {
  expect(rel.lastRelationship).toBeTruthy()
  await deleteRelationshipViaApi(
    request,
    rel.lastRelationship!.contactIdA,
    rel.lastRelationship!.id,
  )
})

Then(
  'listing relationships for {string} should be empty',
  async ({ request }, alias: string) => {
    const contact = rel.contacts.get(alias)
    expect(contact, `Contact "${alias}" not found`).toBeTruthy()
    const result = await listRelationshipsViaApi(request, contact!.id as string)
    expect(result.relationships.length).toBe(0)
  },
)

// ============================================================
// AFFINITY GROUP STEPS
// ============================================================

When(
  'the admin creates an affinity group {string}',
  async ({ request }, name: string) => {
    // Groups require at least one member; create a placeholder contact
    const placeholder = await ensureNamedContact(request, `_group_seed_${Date.now()}`)
    rel.lastGroup = await createAffinityGroupViaApi(request, name, [
      { contactId: placeholder.id as string },
    ])
  },
)

Then(
  'the group should exist with name {string}',
  async ({ request }, _name: string) => {
    expect(rel.lastGroup).toBeTruthy()
    expect(rel.lastGroup!.id).toBeTruthy()
    // Verify via GET that the group persists
    const group = await getAffinityGroupViaApi(request, rel.lastGroup!.id)
    expect(group.id).toBe(rel.lastGroup!.id)
    // The encrypted details contain the name (base64-encoded JSON)
    const details = JSON.parse(atob(group.encryptedDetails))
    expect(details.name).toBe(_name)
  },
)

Given('an affinity group exists', async ({ request }) => {
  const seed = await ensureNamedContact(request, `_group_seed_${Date.now()}`)
  rel.lastGroup = await createAffinityGroupViaApi(request, `Test Group ${Date.now()}`, [
    { contactId: seed.id as string },
  ])
  // Remove the seed member so the group starts with known state
  await removeGroupMemberViaApi(request, rel.lastGroup.id, seed.id as string)
})

When(
  'the admin adds {string} to the group with role {string}',
  async ({ request }, alias: string, role: string) => {
    expect(rel.lastGroup).toBeTruthy()
    const contact = rel.contacts.get(alias)
    expect(contact, `Contact "${alias}" not found`).toBeTruthy()
    await addGroupMemberViaApi(request, rel.lastGroup!.id, contact!.id as string, role)
  },
)

Then('the group should have {int} member', async ({ request }, count: number) => {
  expect(rel.lastGroup).toBeTruthy()
  const result = await listGroupMembersViaApi(request, rel.lastGroup!.id)
  rel.groupMembers = result.members
  expect(result.members.length).toBe(count)
})

Then(
  '{string} should be in the group with role {string}',
  async ({}, alias: string, role: string) => {
    const contact = rel.contacts.get(alias)
    expect(contact, `Contact "${alias}" not found`).toBeTruthy()
    expect(rel.groupMembers).toBeTruthy()
    const member = rel.groupMembers!.find(m => m.contactId === contact!.id)
    expect(member, `Expected ${alias} in group members`).toBeTruthy()
    expect(member!.role).toBe(role)
  },
)

Given(
  'an affinity group with member {string} exists',
  async ({ request }, alias: string) => {
    const contact = await ensureNamedContact(request, alias)
    rel.lastGroup = await createAffinityGroupViaApi(
      request,
      `Group with ${alias} ${Date.now()}`,
      [{ contactId: contact.id as string }],
    )
  },
)

When('the admin removes {string} from the group', async ({ request }, alias: string) => {
  expect(rel.lastGroup).toBeTruthy()
  const contact = rel.contacts.get(alias)
  expect(contact, `Contact "${alias}" not found`).toBeTruthy()
  await removeGroupMemberViaApi(request, rel.lastGroup!.id, contact!.id as string)
})

Then('the group member count should be {int}', async ({ request }, count: number) => {
  expect(rel.lastGroup).toBeTruthy()
  const result = await listGroupMembersViaApi(request, rel.lastGroup!.id)
  expect(result.members.length).toBe(count)
})
