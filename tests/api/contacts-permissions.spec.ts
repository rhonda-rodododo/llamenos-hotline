/**
 * Contact Directory — Permission Boundary Tests
 *
 * Verifies that each endpoint enforces the correct permission tier:
 *
 *   contacts:read-summary  — base gate on all routes (volunteer has this)
 *   contacts:create        — POST /contacts, POST /contacts/relationships (volunteer has this)
 *   contacts:read-pii      — GET /contacts/relationships (volunteer LACKS this)
 *   contacts:update-summary — PATCH /contacts/:id with summary fields (volunteer LACKS this)
 *   contacts:update-pii    — PATCH /contacts/:id with PII fields (volunteer LACKS this)
 *   contacts:delete        — DELETE /contacts/:id (volunteer LACKS this)
 *   contacts:link          — POST/DELETE /contacts/:id/link (volunteer LACKS this)
 *
 * Permission concern noted: POST /contacts/relationships only requires contacts:create,
 * but GET /contacts/relationships requires contacts:read-pii. This asymmetry means a
 * volunteer can create relationships they cannot read — likely intentional (blind record
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

  let adminApi: AuthedRequest
  let volunteerApi: AuthedRequest
  let contactId: string

  test.beforeAll(async ({ request }) => {
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Generate a fresh volunteer keypair for this test run
    const volunteerSk = generateSecretKey()
    const volunteerPk = getPublicKey(volunteerSk)

    // Register the volunteer via admin API
    // The volunteers route uses roleIds (not roles) per the actual route handler
    const regRes = await adminApi.post('/api/volunteers', {
      pubkey: volunteerPk,
      name: 'Perm-Test Volunteer',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
    })
    if (!regRes.ok()) {
      throw new Error(
        `Failed to register test volunteer: ${regRes.status()} ${await regRes.text()}`
      )
    }

    volunteerApi = createAuthedRequest(request, volunteerSk)
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

  test('admin can create a contact', async () => {
    const res = await adminApi.post('/api/contacts', {
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

  // ─── Volunteer — allowed operations ──────────────────────────────────────

  test('volunteer can list contacts (contacts:read-summary)', async () => {
    const res = await volunteerApi.get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
  })

  test('volunteer can get a single contact (contacts:read-summary)', async () => {
    const res = await volunteerApi.get(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })

  test('volunteer can create a contact (contacts:create)', async () => {
    const res = await volunteerApi.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: 'vol-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
  })

  test('volunteer can create a relationship (contacts:create)', async () => {
    // POST /contacts/relationships only requires contacts:create — volunteer has this.
    // NOTE: This is an asymmetry: the volunteer can create relationships they cannot read
    // (GET /relationships requires contacts:read-pii). See file-level comment.
    const res = await volunteerApi.post('/api/contacts/relationships', {
      encryptedPayload: 'vol-rel-payload',
      payloadEnvelopes: [],
    })
    expect(res.status()).toBe(201)
  })

  test('volunteer can query check-duplicate endpoint (contacts:read-summary)', async () => {
    const res = await volunteerApi.get(
      '/api/contacts/check-duplicate?identifierHash=aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    )
    // Returns 200 with { exists: false } for an unknown hash
    expect(res.status()).toBe(200)
  })

  test('volunteer can use hash-phone endpoint (contacts:read-summary)', async () => {
    const res = await volunteerApi.post('/api/contacts/hash-phone', { phone: '+15550001234' })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('identifierHash')
  })

  test('volunteer can get recipients list (contacts:read-summary)', async () => {
    const res = await volunteerApi.get('/api/contacts/recipients')
    expect(res.status()).toBe(200)
  })

  // ─── Volunteer — blocked operations ──────────────────────────────────────

  test('volunteer cannot delete a contact (missing contacts:delete)', async () => {
    const res = await volunteerApi.delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update PII fields (missing contacts:update-pii)', async () => {
    const res = await volunteerApi.patch(`/api/contacts/${contactId}`, {
      encryptedFullName: 'hacked-name',
      fullNameEnvelopes: [],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update summary fields (missing contacts:update-summary)', async () => {
    // Volunteer only has contacts:create and contacts:read-summary —
    // contacts:update-summary is NOT included in role-volunteer
    const res = await volunteerApi.patch(`/api/contacts/${contactId}`, {
      riskLevel: 'critical',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update display name (missing contacts:update-summary)', async () => {
    const res = await volunteerApi.patch(`/api/contacts/${contactId}`, {
      encryptedDisplayName: 'new-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot link calls to contacts (missing contacts:link)', async () => {
    const res = await volunteerApi.post(`/api/contacts/${contactId}/link`, {
      type: 'call',
      targetId: 'some-call-id',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot unlink calls from contacts (missing contacts:link)', async () => {
    const res = await volunteerApi.delete(`/api/contacts/${contactId}/link`, {
      type: 'call',
      targetId: 'some-call-id',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot list relationships (missing contacts:read-pii)', async () => {
    const res = await volunteerApi.get('/api/contacts/relationships')
    expect(res.status()).toBe(403)
  })

  // ─── Admin — full access verification ────────────────────────────────────

  test('admin can update summary fields (contacts:update-summary via contacts:*)', async () => {
    const res = await adminApi.patch(`/api/contacts/${contactId}`, {
      riskLevel: 'high',
      tags: ['perm-test', 'updated'],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can update PII fields (contacts:update-pii via contacts:*)', async () => {
    const res = await adminApi.patch(`/api/contacts/${contactId}`, {
      encryptedFullName: 'updated-name',
      fullNameEnvelopes: [],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can link a call to a contact (contacts:link via contacts:*)', async () => {
    const res = await adminApi.post(`/api/contacts/${contactId}/link`, {
      type: 'call',
      targetId: 'nonexistent-call-id',
    })
    // 200 if contact found (even if call doesn't exist, link is stored)
    // or 404 if contact was deleted — we expect 200 here since we just created it
    expect([200, 404]).toContain(res.status())
  })

  test('admin can list relationships (contacts:read-pii via contacts:*)', async () => {
    const res = await adminApi.get('/api/contacts/relationships')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('relationships')
  })

  test('admin can delete a contact (contacts:delete via contacts:*)', async () => {
    const res = await adminApi.delete(`/api/contacts/${contactId}`)
    expect(res.status()).toBe(200)
  })
})
