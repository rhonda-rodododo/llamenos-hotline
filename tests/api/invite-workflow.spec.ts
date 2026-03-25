/**
 * Invite Workflow API Tests
 *
 * Create invite, validate code, redeem with Schnorr signature, revoke.
 * Permission enforcement on invite endpoints.
 */

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { AUTH_PREFIX } from '../../src/shared/crypto-labels'
import { TestContext } from '../api-helpers'
import { uniquePhone } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import {
  type AuthedRequest,
  createAuthedRequest,
  createAuthedRequestFromNsec,
} from '../helpers/authed-request'

/** Create a Schnorr signature for invite redeem (raw token, not JSON-wrapped). */
function signForRedeem(
  sk: Uint8Array,
  pubkey: string,
  timestamp: number,
  method: string,
  path: string
): string {
  const message = `${AUTH_PREFIX}${pubkey}:${timestamp}:${method}:${path}`
  const messageHash = sha256(utf8ToBytes(message))
  return bytesToHex(schnorr.sign(messageHash, sk))
}

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Invite Workflow', () => {
  test.describe.configure({ mode: 'serial' })

  let inviteCode: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin'],
      hubName: 'Invite Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Create Invites ─────────────────────────────────────────────────────

  test('admin can create an invite', async () => {
    const phone = uniquePhone()
    const res = await adminApi.post('/api/invites', {
      name: 'Invited User',
      phone,
      roleIds: ['role-volunteer'],
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.invite).toBeDefined()
    expect(body.invite.code).toBeTruthy()
    expect(typeof body.invite.code).toBe('string')
    inviteCode = body.invite.code
  })

  test('admin can list invites', async () => {
    const res = await adminApi.get('/api/invites')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.invites).toBeDefined()
    expect(Array.isArray(body.invites)).toBe(true)
    expect(body.invites.length).toBeGreaterThanOrEqual(1)
  })

  // ─── Validate Invite ────────────────────────────────────────────────────

  test('validate valid invite code', async ({ request }) => {
    expect(inviteCode).toBeDefined()
    const res = await request.get(`/api/invites/validate/${inviteCode}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(true)
  })

  test('validate invalid invite code', async ({ request }) => {
    const res = await request.get('/api/invites/validate/nonexistent-code-123')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(false)
  })

  // ─── Redeem Invite ───────────────────────────────────────────────────────

  test('redeem invite with valid Schnorr signature', async ({ request }) => {
    expect(inviteCode).toBeDefined()
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const timestamp = Date.now()
    const token = signForRedeem(sk, pubkey, timestamp, 'POST', '/api/invites/redeem')

    const res = await request.post('/api/invites/redeem', {
      data: {
        code: inviteCode,
        pubkey,
        timestamp,
        token,
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // redeemInvite returns the created volunteer, not { ok: true }
    expect(body.pubkey || body.ok).toBeTruthy()

    // Code should now be consumed
    const validateRes = await request.get(`/api/invites/validate/${inviteCode}`)
    const validateBody = await validateRes.json()
    expect(validateBody.valid).toBe(false)
  })

  test('redeem with already-used code fails', async ({ request }) => {
    expect(inviteCode).toBeDefined()
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const timestamp = Date.now()
    const token = signForRedeem(sk, pubkey, timestamp, 'POST', '/api/invites/redeem')

    const res = await request.post('/api/invites/redeem', {
      data: {
        code: inviteCode,
        pubkey,
        timestamp,
        token,
      },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).not.toBe(500)
  })

  // ─── Revoke Invite ───────────────────────────────────────────────────────

  test('admin can create and revoke an invite', async () => {
    // Create a new invite
    const createRes = await adminApi.post('/api/invites', {
      name: 'Revokable User',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
    })
    expect(createRes.status()).toBe(201)
    const { code } = await createRes.json()

    // Revoke it
    const revokeRes = await adminApi.delete(`/api/invites/${code}`)
    expect(revokeRes.status()).toBe(200)

    // Code should no longer be valid
    const validateRes = await adminApi.get(`/api/invites/validate/${code}`)
    const validateBody = await validateRes.json()
    expect(validateBody.valid).toBe(false)
  })

  // ─── Permission Enforcement ──────────────────────────────────────────────

  test('volunteer cannot create invites', async () => {
    const res = await ctx.api('volunteer').post('/api/invites', {
      name: 'Unauthorized',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
    })
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot list invites', async () => {
    const res = await ctx.api('volunteer').get('/api/invites')
    expect(res.status()).toBe(403)
  })

  test('available channels requires invites:create', async () => {
    // Admin: allowed
    const adminRes = await adminApi.get('/api/invites/available-channels')
    expect(adminRes.status()).toBe(200)

    // Volunteer: denied
    const volRes = await ctx.api('volunteer').get('/api/invites/available-channels')
    expect(volRes.status()).toBe(403)
  })
})
