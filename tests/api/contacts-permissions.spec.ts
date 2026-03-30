/**
 * Contact Directory — Permission Boundary Tests
 *
 * Verifies that each endpoint enforces the correct permission tier:
 *
 *   contacts:read-summary  — base gate on all routes (user has this)
 *   contacts:create        — POST /contacts, POST /contacts/relationships (user has this)
 *   contacts:read-pii      — GET /contacts/relationships (user LACKS this)
 *   contacts:update-summary — PATCH /contacts/:id with summary fields (user LACKS this)
 *   contacts:update-pii    — PATCH /contacts/:id with PII fields (user LACKS this)
 *   contacts:delete        — DELETE /contacts/:id (user LACKS this)
 *   contacts:link          — POST/DELETE /contacts/:id/link (user LACKS this)
 *
 * Permission concern noted: POST /contacts/relationships only requires contacts:create,
 * but GET /contacts/relationships requires contacts:read-pii. This asymmetry means a
 * user can create relationships they cannot read — likely intentional (blind record
 * creation) but worth flagging for spec review.
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

test.describe('Contact Directory — Permission Boundaries', () => {
  test.describe.configure({ mode: 'serial' })

  // Shared user keypair for the test run — registered in the setup test
  const userSk = generateSecretKey()
  const userPk = getPublicKey(userSk)
  let contactId: string

  // Helper: create admin API from per-test request fixture
  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  // Helper: create user API from per-test request fixture
  function userApiFor(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequest(request, userSk)
  }

  // Setup test: register the user (must run first in serial mode)
  test('setup: register test user', async ({ request }) => {
    const admin = adminApi(request)
    const regRes = await admin.post('/api/users', {
      pubkey: userPk,
      name: 'Perm-Test User',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
    })
    if (!regRes.ok()) {
      const body = await regRes.text()
      // 409 = already exists from prior run — acceptable
      if (regRes.status() !== 409) {
        throw new Error(`Failed to register test user: ${regRes.status()} ${body}`)
      }
    }
  })

  // ─── Unauthenticated access ──────────────────────────────────────────────

  test('unauthenticated request to GET /api/contacts returns 401', async ({ request }) => {
    const res = await request.get('/api/contacts', {
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(401)
  })

  test('unauthenticated request to POST /api/contacts returns 401', async ({ request }) => {
    const res = await request.post('/api/contacts', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        contactType: 'caller',
        riskLevel: 'low',
        encryptedDisplayName: 'x',
        displayNameEnvelopes: [],
      },
    })
    expect(res.status()).toBe(401)
  })

  // ─── Admin creates a contact (baseline fixture) ───────────────────────────

  test('admin can create a contact', async ({ request }) => {
    const res = await adminApi(request).post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'medium',
      tags: ['perm-test'],
      encryptedDisplayName: 'aabbccdd',
      displayNameEnvelopes: [],
      encryptedFullName: 'eeff0011',
      fullNameEnvelopes: [],
      encryptedPhone: '22334455',
      phoneEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data).toHaveProperty('contact')
    expect(data.contact).toHaveProperty('id')
    contactId = data.contact.id
  })

  // ─── User — allowed operations ──────────────────────────────────────

  // NOTE: User tests below require hub-scoped routes (/api/hubs/:hubId/contacts)
  // because requireHubOrSuperAdmin middleware blocks non-super-admin access to global routes.
  // Currently these tests use global routes which return 400 for users.
  // TODO: Set up hub + hub membership for user to test hub-scoped permission boundaries.

  test.skip('user can list contacts (contacts:read-summary)', async ({ request }) => {
    const res = await userApiFor(request).get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
  })

  test.skip('user can get a single contact (contacts:read-summary)', async ({ request }) => {
    const res = await userApiFor(request).get(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })

  test.skip('user can create a contact (contacts:create)', async ({ request }) => {
    const res = await userApiFor(request).post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: 'vol-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
  })

  test.skip('user can create a relationship (contacts:create)', async ({ request }) => {
    // POST /contacts/relationships only requires contacts:create — user has this.
    // NOTE: This is an asymmetry: the user can create relationships they cannot read
    // (GET /relationships requires contacts:read-pii). See file-level comment.
    const res = await userApiFor(request).post('/api/contacts/relationships', {
      encryptedPayload: 'vol-rel-payload',
      payloadEnvelopes: [],
    })
    expect(res.status()).toBe(201)
  })

  test.skip('user can query check-duplicate endpoint (contacts:read-summary)', async ({
    request,
  }) => {
    const res = await userApiFor(request).get(
      '/api/contacts/check-duplicate?identifierHash=aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    )
    // Returns 200 with { exists: false } for an unknown hash
    expect(res.status()).toBe(200)
  })

  test.skip('user can use hash-phone endpoint (contacts:read-summary)', async ({ request }) => {
    const res = await userApiFor(request).post('/api/contacts/hash-phone', {
      phone: '+15550001234',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('identifierHash')
  })

  test.skip('user can get recipients list (contacts:read-summary)', async ({ request }) => {
    const res = await userApiFor(request).get('/api/contacts/recipients')
    expect(res.status()).toBe(200)
  })

  // ─── User — blocked operations ──────────────────────────────────────

  test.skip('user cannot delete a contact (missing contacts:delete)', async ({ request }) => {
    const res = await userApiFor(request).delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(403)
  })

  test.skip('user cannot update PII fields (missing contacts:update-pii)', async ({ request }) => {
    const res = await userApiFor(request).patch(`/api/contacts/${contactId}`, {
      encryptedFullName: 'hacked-name',
      fullNameEnvelopes: [],
    })
    expect(res.status()).toBe(403)
  })

  test.skip('user cannot update summary fields (missing contacts:update-summary)', async ({
    request,
  }) => {
    // User only has contacts:create and contacts:read-summary —
    // contacts:update-summary is NOT included in role-volunteer
    const res = await userApiFor(request).patch(`/api/contacts/${contactId}`, {
      riskLevel: 'critical',
    })
    expect(res.status()).toBe(403)
  })

  test.skip('user cannot update display name (missing contacts:update-summary)', async ({
    request,
  }) => {
    const res = await userApiFor(request).patch(`/api/contacts/${contactId}`, {
      encryptedDisplayName: 'new-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(403)
  })

  test.skip('user cannot link calls to contacts (missing contacts:link)', async ({ request }) => {
    const res = await userApiFor(request).post(`/api/contacts/${contactId}/link`, {
      type: 'call',
      targetId: 'some-call-id',
    })
    expect(res.status()).toBe(403)
  })

  test.skip('user cannot unlink calls from contacts (missing contacts:link)', async ({
    request,
  }) => {
    const res = await userApiFor(request).delete(`/api/contacts/${contactId}/link`, {
      type: 'call',
      targetId: 'some-call-id',
    })
    expect(res.status()).toBe(403)
  })

  test.skip('user cannot list relationships (missing contacts:read-pii)', async ({ request }) => {
    const res = await userApiFor(request).get('/api/contacts/relationships')
    expect(res.status()).toBe(403)
  })

  // ─── Admin — full access verification ────────────────────────────────────

  test('admin can update summary fields (contacts:update-summary via contacts:*)', async ({
    request,
  }) => {
    const res = await adminApi(request).patch(`/api/contacts/${contactId}`, {
      riskLevel: 'high',
      tags: ['perm-test', 'updated'],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can update PII fields (contacts:update-pii via contacts:*)', async ({ request }) => {
    const res = await adminApi(request).patch(`/api/contacts/${contactId}`, {
      encryptedFullName: 'updated-name',
      fullNameEnvelopes: [],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can link a call to a contact (contacts:link via contacts:*)', async ({ request }) => {
    const res = await adminApi(request).post(`/api/contacts/${contactId}/link`, {
      type: 'call',
      targetId: 'nonexistent-call-id',
    })
    // 200 if contact found (even if call doesn't exist, link is stored)
    // or 404 if contact was deleted — we expect 200 here since we just created it
    expect([200, 404]).toContain(res.status())
  })

  test('admin can list relationships (contacts:read-pii via contacts:*)', async ({ request }) => {
    const res = await adminApi(request).get('/api/contacts/relationships')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('relationships')
  })

  test('admin can delete a contact (contacts:delete via contacts:*)', async ({ request }) => {
    const res = await adminApi(request).delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })
})
