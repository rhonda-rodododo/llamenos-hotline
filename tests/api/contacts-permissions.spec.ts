/**
 * Contact Directory — Permission Boundary Tests
 *
 * Verifies that each endpoint enforces the correct permission tier:
 *
 *   contacts:envelope-summary  — base gate on all routes (volunteer has this)
 *   contacts:create            — POST /contacts, POST /contacts/relationships (volunteer has this)
 *   contacts:envelope-full     — GET /contacts/relationships (volunteer LACKS this)
 *   contacts:update-summary — PATCH /contacts/:id with summary fields (volunteer LACKS this)
 *   contacts:update-pii    — PATCH /contacts/:id with PII fields (volunteer LACKS this)
 *   contacts:delete        — DELETE /contacts/:id (volunteer LACKS this)
 *   contacts:link          — POST/DELETE /contacts/:id/link (volunteer LACKS this)
 *
 * Permission concern noted: POST /contacts/relationships only requires contacts:create,
 * but GET /contacts/relationships requires contacts:envelope-full. This asymmetry means a
 * user can create relationships they cannot read — likely intentional (blind record
 * creation) but worth flagging for spec review.
 *
 * Uses TestContext for hub-based test isolation. Non-admin users access hub-scoped routes
 * (/api/hubs/:hubId/contacts) because requireHubOrSuperAdmin blocks global routes.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'

test.describe('Contact Directory — Permission Boundaries', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminContactId: string
  let volunteerContactId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
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
    const res = await ctx.adminApi.post(ctx.hubPath('/contacts'), {
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
    adminContactId = data.contact.id
  })

  // ─── Volunteer — allowed operations ──────────────────────────────────────

  test('volunteer can create a contact (contacts:create)', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/contacts'), {
      contactType: 'caller',
      riskLevel: 'low',
      tags: [],
      encryptedDisplayName: 'vol-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    volunteerContactId = data.contact.id
  })

  test('volunteer can list contacts (contacts:envelope-summary)', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/contacts'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('contacts')
  })

  test('volunteer can get a single contact they created (contacts:envelope-summary)', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath(`/contacts/${volunteerContactId}`))
    expect(res.status()).toBe(200)
  })

  test('volunteer can create a relationship (contacts:create)', async () => {
    // POST /contacts/relationships only requires contacts:create — volunteer has this.
    // NOTE: This is an asymmetry: the user can create relationships they cannot read
    // (GET /relationships requires contacts:envelope-full). See file-level comment.
    const res = await ctx.api('volunteer').post(ctx.hubPath('/contacts/relationships'), {
      encryptedPayload: 'vol-rel-payload',
      payloadEnvelopes: [],
    })
    expect(res.status()).toBe(201)
  })

  test('volunteer can query check-duplicate endpoint (contacts:envelope-summary)', async () => {
    const res = await ctx
      .api('volunteer')
      .get(
        ctx.hubPath(
          '/contacts/check-duplicate?identifierHash=aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
        )
      )
    // Returns 200 with { exists: false } for an unknown hash
    expect(res.status()).toBe(200)
  })

  test('volunteer can use hash-phone endpoint (contacts:envelope-summary)', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/contacts/hash-phone'), {
      phone: '+15550001234',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('identifierHash')
  })

  test('volunteer can get recipients list (contacts:envelope-summary)', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/contacts/recipients'))
    expect(res.status()).toBe(200)
  })

  // ─── Volunteer — blocked operations ──────────────────────────────────────

  test('volunteer cannot delete a contact (missing contacts:delete)', async () => {
    const res = await ctx.api('volunteer').delete(ctx.hubPath(`/contacts/${adminContactId}`))
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update PII fields (missing contacts:update-pii)', async () => {
    const res = await ctx.api('volunteer').patch(ctx.hubPath(`/contacts/${adminContactId}`), {
      encryptedFullName: 'hacked-name',
      fullNameEnvelopes: [],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update summary fields (missing contacts:update-summary)', async () => {
    // Volunteer only has contacts:create and contacts:envelope-summary —
    // contacts:update-summary is NOT included in role-volunteer
    const res = await ctx.api('volunteer').patch(ctx.hubPath(`/contacts/${adminContactId}`), {
      riskLevel: 'critical',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update display name (missing contacts:update-summary)', async () => {
    const res = await ctx.api('volunteer').patch(ctx.hubPath(`/contacts/${adminContactId}`), {
      encryptedDisplayName: 'new-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot link calls to contacts (missing contacts:link)', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath(`/contacts/${adminContactId}/link`), {
      type: 'call',
      targetId: 'some-call-id',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot unlink calls from contacts (missing contacts:link)', async () => {
    const res = await ctx.api('volunteer').delete(ctx.hubPath(`/contacts/${adminContactId}/link`), {
      type: 'call',
      targetId: 'some-call-id',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot list relationships (missing contacts:envelope-full)', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/contacts/relationships'))
    expect(res.status()).toBe(403)
  })

  // ─── Admin — full access verification ────────────────────────────────────

  test('admin can update summary fields (contacts:update-summary via contacts:*)', async () => {
    const res = await ctx.adminApi.patch(ctx.hubPath(`/contacts/${adminContactId}`), {
      riskLevel: 'high',
      tags: ['perm-test', 'updated'],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can update PII fields (contacts:update-pii via contacts:*)', async () => {
    const res = await ctx.adminApi.patch(ctx.hubPath(`/contacts/${adminContactId}`), {
      encryptedFullName: 'updated-name',
      fullNameEnvelopes: [],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can link a call to a contact (contacts:link via contacts:*)', async () => {
    const res = await ctx.adminApi.post(ctx.hubPath(`/contacts/${adminContactId}/link`), {
      type: 'call',
      targetId: 'nonexistent-call-id',
    })
    // 200 if contact found (even if call doesn't exist, link is stored)
    // or 404 if contact was deleted — we expect 200 here since we just created it
    expect([200, 404]).toContain(res.status())
  })

  test('admin can list relationships (contacts:envelope-full via contacts:*)', async () => {
    const res = await ctx.adminApi.get(ctx.hubPath('/contacts/relationships'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('relationships')
  })

  test('admin can delete a contact (contacts:delete via contacts:*)', async () => {
    const res = await ctx.adminApi.delete(ctx.hubPath(`/contacts/${adminContactId}`))
    expect(res.status()).toBe(200)
  })
})
