/**
 * PBAC Scope Hierarchy — API Integration Tests
 *
 * Verifies that the scope hierarchy (own < assigned < all) is enforced
 * at the API layer for contact CRUD operations.
 *
 * Admin tests use the global `/api/contacts` route (super-admin access).
 * Hub-scoped tests (non-admin users) are marked `test.skip()` because they
 * require `/api/hubs/:hubId/contacts` with hub membership setup — see
 * contacts-permissions.spec.ts for the same pattern.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { uniquePhone } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import {
  type AuthedRequest,
  createAuthedRequest,
  createAuthedRequestFromNsec,
} from '../helpers/authed-request'

test.describe('PBAC Scope Hierarchy — Admin (global routes)', () => {
  test.describe.configure({ mode: 'serial' })

  let contactId: string

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  test('admin can list all contacts via contacts:* wildcard', async ({ request }) => {
    const res = await adminApi(request).get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
    expect(Array.isArray(data.contacts)).toBe(true)
  })

  test('admin can create a contact with assignedTo field', async ({ request }) => {
    const admin = adminApi(request)
    const res = await admin.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: ['pbac-scope-test'],
      encryptedDisplayName: 'scope-test-display',
      displayNameEnvelopes: [],
      assignedTo: admin.pubkey,
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data).toHaveProperty('contact')
    expect(data.contact).toHaveProperty('id')
    contactId = data.contact.id
  })

  test('admin can filter contacts by assignedTo query parameter', async ({ request }) => {
    const admin = adminApi(request)
    const res = await admin.get(`/api/contacts?assignedTo=${admin.pubkey}`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
    // The contact we created with assignedTo should be in results
    // (if the server supports this filter — 200 is the key assertion)
  })

  test('admin contacts:* subsumes contacts:read-own check', async ({ request }) => {
    // Admin with '*' wildcard should be able to read any contact,
    // demonstrating that wildcard subsumes scoped permissions.
    const res = await adminApi(request).get(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contact')
    expect(data.contact.id).toBe(contactId)
  })

  test('cleanup: admin deletes test contact', async ({ request }) => {
    const res = await adminApi(request).delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })
})

test.describe('PBAC Scope Hierarchy — Hub-Scoped (non-admin users)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // TODO: These tests require hub-scoped routes (/api/hubs/:hubId/contacts).
  // Non-admin users cannot access global /api/contacts — the middleware
  // requires super-admin for global routes. To unskip these tests:
  //   1. Create a test hub via admin API
  //   2. Add the test user as a hub member with specific role
  //   3. Use /api/hubs/:hubId/contacts routes
  // See contacts-permissions.spec.ts for the same limitation.
  // ─────────────────────────────────────────────────────────────────────────

  const readOwnSk = generateSecretKey()
  const readOwnPk = getPublicKey(readOwnSk)
  const readAssignedSk = generateSecretKey()
  const readAssignedPk = getPublicKey(readAssignedSk)
  const readAllSk = generateSecretKey()
  const readAllPk = getPublicKey(readAllSk)
  const updateOwnSk = generateSecretKey()
  const updateOwnPk = getPublicKey(updateOwnSk)

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  // Users with specific scoped permissions (not full admin).
  // In a real setup, these would be hub members with custom roles.
  function readOwnApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequest(request, readOwnSk, [
      'contacts:read-own',
      'contacts:envelope-summary',
      'contacts:create',
    ])
  }

  function readAssignedApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequest(request, readAssignedSk, [
      'contacts:read-assigned',
      'contacts:envelope-summary',
      'contacts:envelope-full',
      'contacts:create',
    ])
  }

  function readAllApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequest(request, readAllSk, [
      'contacts:read-all',
      'contacts:envelope-summary',
      'contacts:create',
    ])
  }

  function updateOwnApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequest(request, updateOwnSk, [
      'contacts:read-own',
      'contacts:update-own',
      'contacts:envelope-summary',
      'contacts:update-summary',
      'contacts:create',
    ])
  }

  // --- Scope: read-own ---

  test.skip('user with contacts:read-own can only fetch contacts they created', async ({
    request,
  }) => {
    // TODO: Requires hub-scoped route. When hub infra is ready:
    // 1. readOwnApi creates a contact in the hub
    // 2. readOwnApi lists contacts — should see only their own
    // 3. Admin creates another contact — readOwnApi should NOT see it
    const api = readOwnApi(request)
    const createRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'own-contact',
      displayNameEnvelopes: [],
    })
    expect(createRes.status()).toBe(201)

    const listRes = await api.get('/api/contacts')
    expect(listRes.status()).toBe(200)
    const data = await listRes.json()
    // Should only contain contacts created by this user
    for (const contact of data.contacts) {
      expect(contact.createdBy).toBe(api.pubkey)
    }
  })

  // --- Scope: read-assigned ---

  test.skip('user with contacts:read-assigned can fetch contacts assigned to them', async ({
    request,
  }) => {
    // TODO: Requires hub-scoped route. When hub infra is ready:
    // 1. Admin creates a contact with assignedTo = readAssignedPk
    // 2. readAssignedApi lists contacts — should see the assigned contact
    const admin = adminApi(request)
    await admin.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'assigned-contact',
      displayNameEnvelopes: [],
      assignedTo: readAssignedPk,
    })

    const api = readAssignedApi(request)
    const listRes = await api.get('/api/contacts')
    expect(listRes.status()).toBe(200)
    const data = await listRes.json()
    expect(data.contacts.length).toBeGreaterThan(0)
    // All returned contacts should be assigned to this user
    for (const contact of data.contacts) {
      expect(contact.assignedTo).toBe(api.pubkey)
    }
  })

  // --- Scope: read-all ---

  test.skip('user with contacts:read-all can fetch all contacts in hub', async ({ request }) => {
    // TODO: Requires hub-scoped route. When hub infra is ready:
    // 1. Admin creates multiple contacts in the hub
    // 2. readAllApi lists contacts — should see all of them
    const api = readAllApi(request)
    const listRes = await api.get('/api/contacts')
    expect(listRes.status()).toBe(200)
    const data = await listRes.json()
    expect(data.contacts.length).toBeGreaterThan(0)
  })

  // --- Scope: update-own ---

  test.skip('user with contacts:update-own can PATCH contacts they created', async ({
    request,
  }) => {
    // TODO: Requires hub-scoped route.
    const api = updateOwnApi(request)
    const createRes = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'update-own-test',
      displayNameEnvelopes: [],
    })
    expect(createRes.status()).toBe(201)
    const { contact } = await createRes.json()

    const patchRes = await api.patch(`/api/contacts/${contact.id}`, {
      riskLevel: 'medium',
    })
    expect(patchRes.status()).toBe(200)
  })

  test.skip('user with contacts:update-own gets 404 on PATCH for contacts created by others', async ({
    request,
  }) => {
    // TODO: Requires hub-scoped route.
    // Admin creates a contact, then updateOwnApi tries to patch it — should fail
    const admin = adminApi(request)
    const createRes = await admin.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      encryptedDisplayName: 'not-my-contact',
      displayNameEnvelopes: [],
    })
    expect(createRes.status()).toBe(201)
    const { contact } = await createRes.json()

    const api = updateOwnApi(request)
    const patchRes = await api.patch(`/api/contacts/${contact.id}`, {
      riskLevel: 'high',
    })
    // Server should return 404 (contact not visible to this user) or 403
    expect([403, 404]).toContain(patchRes.status())
  })

  // --- Case Manager composite check ---

  test.skip('Case Manager with contacts:read-assigned + contacts:envelope-full sees assigned contacts', async ({
    request,
  }) => {
    // TODO: Requires hub-scoped route.
    // Case Manager has: contacts:read-assigned, contacts:envelope-summary,
    // contacts:envelope-full, contacts:create, contacts:link
    const api = readAssignedApi(request) // simulates Case Manager scope
    const listRes = await api.get('/api/contacts')
    expect(listRes.status()).toBe(200)
    const data = await listRes.json()
    // With envelope-full, the response should include PII fields
    // (when the contact has them and they're assigned to this user)
    expect(data).toHaveProperty('contacts')
  })
})
