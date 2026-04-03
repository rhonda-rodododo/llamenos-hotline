/**
 * Extended Settings API Tests
 *
 * Covers settings endpoints not in settings-management.spec.ts:
 * - Telephony provider config (GET/PATCH/test/verify-webhook)
 * - Messaging config (GET/PATCH/test)
 * - IVR audio recordings (GET/PUT/DELETE)
 * - Roles CRUD (list/create/update/delete)
 * - Fallback group (GET/PUT)
 * - Read-after-write persistence for call, spam, transcription settings
 *
 * Each test.describe block uses TestContext for hub-scoped isolation
 * so tests can run in parallel without interfering with each other.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

// ─── Telephony Provider ───────────────────────────────────────────────────────

test.describe('Telephony Provider Settings', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminApi: AuthedRequest

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Telephony Settings Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('admin can read telephony provider config', async () => {
    const res = await adminApi.get('/api/settings/telephony-provider')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('admin can update telephony provider config', async () => {
    const res = await adminApi.patch('/api/settings/telephony-provider', {
      type: 'twilio',
      phoneNumber: '+15551234567',
    })
    expect(res.status()).toBe(200)
  })

  test('telephony test with unknown provider returns 400', async () => {
    const res = await adminApi.post('/api/settings/telephony-provider/test', {
      type: 'nonexistent-provider',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  test('volunteer cannot read telephony provider config', async () => {
    const res = await ctx.api('volunteer').get('/api/settings/telephony-provider')
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update telephony provider config', async () => {
    const res = await ctx.api('volunteer').patch('/api/settings/telephony-provider', {
      type: 'twilio',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot test telephony provider', async () => {
    const res = await ctx.api('volunteer').post('/api/settings/telephony-provider/test', {
      type: 'twilio',
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot verify webhook', async () => {
    const res = await ctx.api('volunteer').get('/api/settings/telephony-provider/verify-webhook')
    expect(res.status()).toBe(403)
  })
})

// ─── Messaging Config ─────────────────────────────────────────────────────────

test.describe('Messaging Settings', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminApi: AuthedRequest

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Messaging Settings Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('admin can read messaging config', async () => {
    const res = await adminApi.get('/api/settings/messaging')
    expect(res.status()).toBe(200)
  })

  test('admin can update messaging config', async () => {
    const res = await adminApi.patch('/api/settings/messaging', {
      sms: { enabled: false },
    })
    expect(res.status()).toBe(200)
  })

  test('messaging test with unknown channel returns 400', async () => {
    const res = await adminApi.post('/api/settings/messaging/test', {
      channel: 'carrier-pigeon',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('volunteer cannot read messaging config', async () => {
    const res = await ctx.api('volunteer').get('/api/settings/messaging')
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update messaging config', async () => {
    const res = await ctx.api('volunteer').patch('/api/settings/messaging', {
      sms: { enabled: true },
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot test messaging channel', async () => {
    const res = await ctx.api('volunteer').post('/api/settings/messaging/test', {
      channel: 'sms',
    })
    expect(res.status()).toBe(403)
  })
})

// ─── IVR Audio ────────────────────────────────────────────────────────────────

test.describe('IVR Audio Settings', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminApi: AuthedRequest

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'IVR Audio Settings Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('admin can list IVR audio recordings', async () => {
    const res = await adminApi.get('/api/settings/ivr-audio')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.recordings).toBeDefined()
    expect(Array.isArray(body.recordings)).toBe(true)
  })

  test('admin can upload IVR audio', async () => {
    // Upload a minimal WAV-like payload for the greeting prompt in English
    const fakeAudio = Buffer.from('RIFF....WAVEfmt test-audio-data', 'utf-8')
    const res = await adminApi.put('/api/settings/ivr-audio/greeting/en', fakeAudio, {
      'Content-Type': 'audio/wav',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('uploaded audio appears in list', async () => {
    const res = await adminApi.get('/api/settings/ivr-audio')
    expect(res.status()).toBe(200)
    const body = await res.json()
    const greetingEn = body.recordings.find(
      (r: { promptType: string; language: string }) =>
        r.promptType === 'greeting' && r.language === 'en'
    )
    expect(greetingEn).toBeDefined()
  })

  test('admin can delete IVR audio', async () => {
    const res = await adminApi.delete('/api/settings/ivr-audio/greeting/en')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('volunteer cannot list IVR audio', async () => {
    const res = await ctx.api('volunteer').get('/api/settings/ivr-audio')
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot upload IVR audio', async () => {
    const fakeAudio = Buffer.from('test', 'utf-8')
    const res = await ctx
      .api('volunteer')
      .put('/api/settings/ivr-audio/greeting/en', fakeAudio, { 'Content-Type': 'audio/wav' })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot delete IVR audio', async () => {
    const res = await ctx.api('volunteer').delete('/api/settings/ivr-audio/greeting/en')
    expect(res.status()).toBe(403)
  })
})

// ─── Roles CRUD ───────────────────────────────────────────────────────────────

test.describe('Roles CRUD', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminApi: AuthedRequest
  let createdRoleId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Roles CRUD Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    // Clean up the created role if it still exists
    if (createdRoleId) {
      try {
        await adminApi.delete(`/api/settings/roles/${createdRoleId}`)
      } catch {
        // ignore cleanup errors
      }
    }
    await ctx.cleanup()
  })

  test('admin can list roles', async () => {
    const res = await adminApi.get('/api/settings/roles')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.roles).toBeDefined()
    expect(Array.isArray(body.roles)).toBe(true)
    // Built-in roles should be present
    expect(body.roles.length).toBeGreaterThan(0)
  })

  test('admin can create a custom role', async () => {
    const roleName = `test-role-${Date.now()}`
    const res = await adminApi.post('/api/settings/roles', {
      encryptedName: roleName,
      permissions: ['notes:read', 'calls:read'],
      description: 'E2E test custom role',
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.id).toBeDefined()
    createdRoleId = body.id
  })

  test('admin can update the custom role', async () => {
    expect(createdRoleId).toBeDefined()
    const res = await adminApi.patch(`/api/settings/roles/${createdRoleId}`, {
      permissions: ['notes:read', 'calls:read', 'bans:read'],
    })
    expect(res.status()).toBe(200)
  })

  test('admin can delete the custom role', async () => {
    expect(createdRoleId).toBeDefined()
    const res = await adminApi.delete(`/api/settings/roles/${createdRoleId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    createdRoleId = '' // cleared so afterAll doesn't try again
  })

  test('volunteer can list roles (public endpoint)', async () => {
    // Roles list is accessible to any authenticated user (no permission guard on GET /roles)
    const res = await ctx.api('volunteer').get('/api/settings/roles')
    expect(res.status()).toBe(200)
  })

  test('volunteer cannot create roles', async () => {
    const res = await ctx.api('volunteer').post('/api/settings/roles', {
      encryptedName: 'hacker-role',
      permissions: ['*'],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update roles', async () => {
    const res = await ctx.api('volunteer').patch('/api/settings/roles/role-volunteer', {
      permissions: ['*'],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot delete roles', async () => {
    const res = await ctx.api('volunteer').delete('/api/settings/roles/role-volunteer')
    expect(res.status()).toBe(403)
  })
})

// ─── Fallback Group ───────────────────────────────────────────────────────────

test.describe('Fallback Group Settings', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminApi: AuthedRequest

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Fallback Group Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('admin can read fallback group', async () => {
    const res = await adminApi.get('/api/settings/fallback-group')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.pubkeys).toBeDefined()
    expect(Array.isArray(body.pubkeys)).toBe(true)
  })

  test('admin can update fallback group', async () => {
    const volunteerPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.put('/api/settings/fallback-group', {
      pubkeys: [volunteerPubkey],
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.pubkeys).toContain(volunteerPubkey)
  })

  test('read-after-write: fallback group persists', async () => {
    const volunteerPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.get('/api/settings/fallback-group')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.pubkeys).toContain(volunteerPubkey)
  })

  test('admin can clear fallback group', async () => {
    const res = await adminApi.put('/api/settings/fallback-group', {
      pubkeys: [],
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.pubkeys).toEqual([])
  })

  test('volunteer cannot read fallback group', async () => {
    const res = await ctx.api('volunteer').get('/api/settings/fallback-group')
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot update fallback group', async () => {
    const res = await ctx.api('volunteer').put('/api/settings/fallback-group', {
      pubkeys: [ctx.user('volunteer').pubkey],
    })
    expect(res.status()).toBe(403)
  })
})

// ─── Read-After-Write Persistence ─────────────────────────────────────────────

test.describe('Settings Persistence (read-after-write)', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: TestContext
  let adminApi: AuthedRequest

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: [],
      hubName: 'Persistence Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test('call settings persist after update', async () => {
    // Update
    const updateRes = await adminApi.patch('/api/settings/call', {
      queueTimeoutSeconds: 180,
      voicemailMaxSeconds: 45,
    })
    expect(updateRes.status()).toBe(200)

    // Read back
    const readRes = await adminApi.get('/api/settings/call')
    expect(readRes.status()).toBe(200)
    const body = await readRes.json()
    expect(body.queueTimeoutSeconds).toBe(180)
    expect(body.voicemailMaxSeconds).toBe(45)
  })

  test('spam settings persist after update', async () => {
    const updateRes = await adminApi.patch('/api/settings/spam', {
      voiceCaptchaEnabled: true,
      captchaMaxAttempts: 5,
    })
    expect(updateRes.status()).toBe(200)

    const readRes = await adminApi.get('/api/settings/spam')
    expect(readRes.status()).toBe(200)
    const body = await readRes.json()
    expect(body.voiceCaptchaEnabled).toBe(true)
    expect(body.captchaMaxAttempts).toBe(5)
  })

  test('transcription settings persist after update', async () => {
    const updateRes = await adminApi.patch('/api/settings/transcription', {
      globalEnabled: true,
      allowUserOptOut: false,
    })
    expect(updateRes.status()).toBe(200)

    const readRes = await adminApi.get('/api/settings/transcription')
    expect(readRes.status()).toBe(200)
    const body = await readRes.json()
    expect(body.globalEnabled).toBe(true)
    expect(body.allowUserOptOut).toBe(false)
  })

  test('IVR languages persist after update', async () => {
    const updateRes = await adminApi.patch('/api/settings/ivr-languages', {
      enabledLanguages: ['en', 'es', 'fr'],
    })
    expect(updateRes.status()).toBe(200)

    const readRes = await adminApi.get('/api/settings/ivr-languages')
    expect(readRes.status()).toBe(200)
    const body = await readRes.json()
    expect(body.enabledLanguages).toEqual(expect.arrayContaining(['en', 'es', 'fr']))
  })

  test('retention settings persist after update', async () => {
    const updateRes = await adminApi.put('/api/settings/retention', {
      callRecordRetentionDays: 180,
      auditLogRetentionDays: 365,
    })
    expect(updateRes.status()).toBe(200)

    const readRes = await adminApi.get('/api/settings/retention')
    expect(readRes.status()).toBe(200)
    const body = await readRes.json()
    expect(body.callRecordRetentionDays).toBe(180)
    expect(body.auditLogRetentionDays).toBe(365)
  })

  test('setup state persists after update', async () => {
    const updateRes = await adminApi.patch('/api/settings/setup', {
      telephonyConfigured: true,
    })
    expect(updateRes.status()).toBe(200)

    const readRes = await adminApi.get('/api/settings/setup')
    expect(readRes.status()).toBe(200)
    const body = await readRes.json()
    expect(body.telephonyConfigured).toBe(true)
  })
})
