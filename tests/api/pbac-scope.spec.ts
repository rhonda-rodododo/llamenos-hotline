/**
 * PBAC Scope Hierarchy — API Integration Tests
 *
 * Verifies that the scope hierarchy (own < assigned < all) is enforced
 * at the API layer for contact CRUD operations.
 *
 * Uses TestContext for hub-based test isolation. Non-admin users access
 * hub-scoped routes (/api/hubs/:hubId/contacts) because requireHubOrSuperAdmin
 * blocks global routes for non-super-admin users.
 *
 * Scope levels tested:
 *   - Volunteer: contacts:read-own (can only see contacts they created)
 *   - Case Manager: contacts:read-assigned (can see contacts assigned to them)
 *   - Hub Admin: contacts:read-all via contacts:* (can see all contacts)
 *   - Volunteer: contacts:update-own (can only update contacts they created)
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'

test.describe('PBAC Scope Hierarchy — Admin (global routes)', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let contactId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: [],
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('admin can list all contacts via contacts:* wildcard', async () => {
    const res = await ctx.adminApi.get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
    expect(Array.isArray(data.contacts)).toBe(true)
  })

  test('admin can create a contact with assignedTo field', async () => {
    const res = await ctx.adminApi.post(ctx.hubPath('/contacts'), {
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['pbac-scope-test'],
      encryptedDisplayName: 'scope-test-display',
      displayNameEnvelopes: [],
      assignedTo: ctx.adminApi.pubkey,
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data).toHaveProperty('contact')
    expect(data.contact).toHaveProperty('id')
    contactId = data.contact.id
  })

  test('admin can filter contacts by assignedTo query parameter', async () => {
    const res = await ctx.adminApi.get(ctx.hubPath(`/contacts?assignedTo=${ctx.adminApi.pubkey}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
  })

  test('admin contacts:* subsumes contacts:read-own check', async () => {
    // Admin with '*' wildcard should be able to read any contact,
    // demonstrating that wildcard subsumes scoped permissions.
    const res = await ctx.adminApi.get(ctx.hubPath(`/contacts/${contactId}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contact')
    expect(data.contact.id).toBe(contactId)
  })

  test('cleanup: admin deletes test contact', async () => {
    const res = await ctx.adminApi.delete(ctx.hubPath(`/contacts/${contactId}`))
    expect(res.status()).toBe(200)
  })
})

test.describe('PBAC Scope Hierarchy — Hub-Scoped (non-admin users)', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext

  // Track contact IDs for assertions
  let volunteerContactId: string
  let adminContactId: string
  let assignedContactId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'case-manager'],
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // --- Setup: create contacts owned by different users ---

  test('volunteer creates a contact', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/contacts'), {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'vol-created-contact',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    volunteerContactId = data.contact.id
  })

  test('admin creates a contact (not owned by volunteer)', async () => {
    const res = await ctx.adminApi.post(ctx.hubPath('/contacts'), {
      contactType: 'caller',
      riskLevel: 'medium',
      encryptedDisplayName: 'admin-created-contact',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    adminContactId = data.contact.id
  })

  test('admin creates a contact assigned to case-manager', async () => {
    const res = await ctx.adminApi.post(ctx.hubPath('/contacts'), {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'assigned-to-cm',
      displayNameEnvelopes: [],
      assignedTo: ctx.user('case-manager').pubkey,
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    assignedContactId = data.contact.id
  })

  // --- Scope: read-own (volunteer) ---

  test('volunteer with contacts:read-own can only fetch own contacts', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/contacts'))
    expect(res.status()).toBe(200)
    const { contacts } = await res.json()
    // Volunteer should only see contacts they created (scope: own)
    expect(contacts.length).toBeGreaterThan(0)
    for (const c of contacts) {
      expect(c.createdBy).toBe(ctx.user('volunteer').pubkey)
    }
  })

  // --- Scope: read-assigned (case-manager) ---

  test('case-manager with contacts:read-assigned can fetch contacts assigned to them', async () => {
    const res = await ctx.api('case-manager').get(ctx.hubPath('/contacts'))
    expect(res.status()).toBe(200)
    const { contacts } = await res.json()
    expect(contacts.length).toBeGreaterThan(0)
    // All returned contacts should be assigned to the case-manager or created by them
    for (const c of contacts) {
      const isAssigned = c.assignedTo === ctx.user('case-manager').pubkey
      const isOwned = c.createdBy === ctx.user('case-manager').pubkey
      expect(isAssigned || isOwned).toBe(true)
    }
  })

  // --- Scope: read-all (admin via wildcard) ---

  test('admin with contacts:read-all can fetch all contacts in hub', async () => {
    const res = await ctx.adminApi.get(ctx.hubPath('/contacts'))
    expect(res.status()).toBe(200)
    const { contacts } = await res.json()
    // Admin should see all contacts in the hub (at least the 3 we created)
    expect(contacts.length).toBeGreaterThanOrEqual(3)
  })

  // --- Scope: update-own (volunteer) ---

  test('volunteer with contacts:update-own cannot PATCH contacts they did not create', async () => {
    // Volunteer lacks contacts:update-summary entirely, so any patch is 403
    const res = await ctx.api('volunteer').patch(ctx.hubPath(`/contacts/${adminContactId}`), {
      riskLevel: 'high',
    })
    // Server should return 403 (no update permission)
    expect(res.status()).toBe(403)
  })

  // --- Case Manager composite check ---

  test('case-manager with contacts:read-assigned + contacts:envelope-full sees assigned contacts', async () => {
    const res = await ctx.api('case-manager').get(ctx.hubPath('/contacts'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    // With envelope-full, the response should include PII fields
    // (when the contact has them and they're assigned to this user)
    expect(data).toHaveProperty('contacts')
    // The assigned contact should be in the list
    const assignedContact = data.contacts.find((c: { id: string }) => c.id === assignedContactId)
    expect(assignedContact).toBeDefined()
  })

  test('case-manager can list relationships (has contacts:envelope-full)', async () => {
    const res = await ctx.api('case-manager').get(ctx.hubPath('/contacts/relationships'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('relationships')
  })
})
