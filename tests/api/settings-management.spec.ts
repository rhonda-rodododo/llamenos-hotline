/**
 * Settings Management API Tests
 *
 * Tests admin settings endpoints: call settings, spam settings, custom fields,
 * IVR languages, WebAuthn policy, data retention, setup state, and provider health.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Settings Management', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Settings Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Call Settings ───────────────────────────────────────────────────────

  test.describe('Call Settings', () => {
    test('admin can read call settings', async () => {
      const res = await adminApi.get('/api/settings/call')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Should have expected structure
      expect(body).toBeDefined()
    })

    test('admin can update call settings', async () => {
      const res = await adminApi.patch('/api/settings/call', {
        queueTimeoutSeconds: 120,
        voicemailMaxSeconds: 60,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot read call settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/call')
      expect(res.status()).toBe(403)
    })

    test('user cannot update call settings', async () => {
      const res = await ctx.api('volunteer').patch('/api/settings/call', {
        queueTimeoutSeconds: 999,
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── Spam Settings ───────────────────────────────────────────────────────

  test.describe('Spam Settings', () => {
    test('admin can read spam settings', async () => {
      const res = await adminApi.get('/api/settings/spam')
      expect(res.status()).toBe(200)
    })

    test('admin can update spam settings', async () => {
      const res = await adminApi.patch('/api/settings/spam', {
        captchaEnabled: false,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot read spam settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/spam')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Custom Fields ───────────────────────────────────────────────────────

  test.describe('Custom Fields', () => {
    test('admin can read custom fields', async () => {
      const res = await adminApi.get('/api/settings/custom-fields')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.fields ?? body)).toBe(true)
    })

    test('admin can set custom fields', async () => {
      const res = await adminApi.put('/api/settings/custom-fields', [
        {
          id: `field-test-${Date.now()}`,
          name: 'test_field',
          label: 'Test Field',
          type: 'text',
          required: false,
          visibleToUsers: true,
          editableByUsers: false,
          context: 'notes',
        },
      ])
      expect(res.status()).toBe(200)
    })

    test('user can read custom fields (filtered view)', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/custom-fields')
      // Users can read fields (needed for note forms) but get filtered view
      expect(res.status()).toBe(200)
    })
  })

  // ─── Transcription Settings ──────────────────────────────────────────────

  test.describe('Transcription Settings', () => {
    test('any authenticated user can read transcription settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/transcription')
      expect(res.status()).toBe(200)
    })

    test('admin can update transcription settings', async () => {
      const res = await adminApi.patch('/api/settings/transcription', {
        enabled: true,
        allowUserOptOut: true,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot update global transcription settings', async () => {
      const res = await ctx.api('volunteer').patch('/api/settings/transcription', {
        enabled: false,
      })
      expect(res.status()).toBe(403)
    })
  })

  // ─── IVR Languages ──────────────────────────────────────────────────────

  test.describe('IVR Languages', () => {
    test('admin can read IVR languages', async () => {
      const res = await adminApi.get('/api/settings/ivr-languages')
      expect(res.status()).toBe(200)
    })

    test('admin can update IVR languages', async () => {
      const res = await adminApi.patch('/api/settings/ivr-languages', ['en', 'es'])
      expect(res.status()).toBe(200)
    })

    test('user cannot read IVR languages', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/ivr-languages')
      expect(res.status()).toBe(403)
    })
  })

  // ─── WebAuthn Settings ───────────────────────────────────────────────────

  test.describe('WebAuthn Settings', () => {
    test('admin can read WebAuthn settings', async () => {
      const res = await adminApi.get('/api/settings/webauthn')
      expect(res.status()).toBe(200)
    })

    test('admin can update WebAuthn settings', async () => {
      const res = await adminApi.patch('/api/settings/webauthn', {
        required: false,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot manage WebAuthn settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/webauthn')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Data Retention (GDPR) ──────────────────────────────────────────────

  test.describe('Data Retention', () => {
    test('admin can read retention settings', async () => {
      const res = await adminApi.get('/api/settings/retention')
      expect(res.status()).toBe(200)
    })

    test('admin can update retention settings', async () => {
      const res = await adminApi.put('/api/settings/retention', {
        callRecordRetentionDays: 365,
        auditLogRetentionDays: 730,
      })
      expect(res.status()).toBe(200)
    })

    test('user cannot manage retention settings', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/retention')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Setup State ─────────────────────────────────────────────────────────

  test.describe('Setup State', () => {
    test('admin can read setup state', async () => {
      const res = await adminApi.get('/api/settings/setup')
      expect(res.status()).toBe(200)
    })

    test('user cannot read setup state', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/setup')
      expect(res.status()).toBe(403)
    })
  })

  // ─── Provider Health ─────────────────────────────────────────────────────

  test.describe('Provider Health', () => {
    test('admin can check provider health', async () => {
      const res = await adminApi.get('/api/settings/provider-health')
      expect(res.status()).toBe(200)
    })
  })

  // ─── Permissions Catalog ─────────────────────────────────────────────────

  test.describe('Permissions Catalog', () => {
    test('returns complete permissions organized by domain', async () => {
      const res = await adminApi.get('/api/settings/permissions')
      expect(res.status()).toBe(200)
      const body = await res.json()

      expect(body.permissions).toBeDefined()
      expect(body.byDomain).toBeDefined()

      // Verify key domains exist
      const expectedDomains = ['calls', 'notes', 'bans', 'shifts', 'settings', 'audit', 'users']
      for (const domain of expectedDomains) {
        expect(body.byDomain[domain], `domain '${domain}' should exist`).toBeDefined()
      }
    })

    test('user cannot read permissions catalog', async () => {
      const res = await ctx.api('volunteer').get('/api/settings/permissions')
      expect(res.status()).toBe(403)
    })
  })
})
