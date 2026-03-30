/**
 * API-driven test setup helpers.
 *
 * These helpers create test data directly via API calls, bypassing the UI.
 * This is significantly faster than using UI automation for setup and reduces
 * test brittleness by not depending on UI selectors for setup steps.
 *
 * Use these helpers in beforeAll/beforeEach hooks to set up test fixtures.
 */

import type { APIRequestContext } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey as nostrGetPubkey } from 'nostr-tools/pure'
import { ADMIN_NSEC } from './helpers'
import {
  type AuthedRequest,
  createAuthedRequest,
  createAuthedRequestFromNsec,
  enrollInAuthentik,
} from './helpers/authed-request'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestUser {
  sk: Uint8Array
  pubkey: string
  nsec: string
  name: string
  phone: string
  roleIds: string[]
  api: AuthedRequest
}

interface CreateVolunteerResult {
  pubkey: string
  nsec: string
  name: string
  phone: string
}

interface CreateBanResult {
  phone: string
  reason: string
}

interface CreateShiftResult {
  id: string
  name: string
}

export type RoleAlias = 'super-admin' | 'hub-admin' | 'reviewer' | 'volunteer' | 'reporter'

const ROLE_ID_MAP: Record<RoleAlias, string> = {
  'super-admin': 'role-super-admin',
  'hub-admin': 'role-hub-admin',
  reviewer: 'role-reviewer',
  volunteer: 'role-volunteer',
  reporter: 'role-reporter',
}

// Monotonic counter to ensure unique phones even within the same millisecond
let phoneCounter = 0

/**
 * Generate a unique phone number for testing.
 * Uses monotonic counter to avoid collisions in parallel tests.
 */
export function uniquePhone(): string {
  const ts = Date.now().toString().slice(-5)
  const counter = (phoneCounter++).toString().padStart(4, '0')
  return `+1555${ts}${counter}`
}

/**
 * Generate a unique name for testing.
 */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

/**
 * Generate a unique slug-safe string.
 */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── TestContext: Reusable multi-role test environment ────────────────────────

/**
 * Manages a complete test environment: hub, users with different roles, and cleanup.
 *
 * Usage:
 * ```ts
 * let ctx: TestContext
 * test.beforeAll(async ({ request }) => {
 *   ctx = await TestContext.create(request, {
 *     roles: ['volunteer', 'reviewer', 'reporter', 'hub-admin'],
 *   })
 * })
 * test.beforeEach(async ({ request }) => { ctx.refreshApis(request) })
 * test.afterAll(async () => { await ctx.cleanup() })
 * ```
 */
export class TestContext {
  private _adminApi: AuthedRequest
  readonly hubId: string
  readonly hubName: string
  private readonly users = new Map<RoleAlias, TestUser>()
  private readonly customRoleIds: string[] = []
  private rawRequest: APIRequestContext

  get adminApi(): AuthedRequest {
    return this._adminApi
  }

  private constructor(
    request: APIRequestContext,
    adminApi: AuthedRequest,
    hubId: string,
    hubName: string
  ) {
    this.rawRequest = request
    this._adminApi = adminApi
    this.hubId = hubId
    this.hubName = hubName
  }

  static async create(
    request: APIRequestContext,
    opts?: {
      roles?: RoleAlias[]
      hubName?: string
    }
  ): Promise<TestContext> {
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const hubName = opts?.hubName ?? uniqueName('TestHub')

    // Create a hub
    const hubRes = await adminApi.post('/api/hubs', { name: hubName })
    if (!hubRes.ok()) {
      throw new Error(`Failed to create test hub: ${hubRes.status()} ${await hubRes.text()}`)
    }
    const { hub } = await hubRes.json()

    const ctx = new TestContext(request, adminApi, hub.id, hubName)

    // Create users for each requested role
    const roles = opts?.roles ?? ['volunteer', 'reviewer', 'reporter']
    for (const role of roles) {
      await ctx.addUser(role)
    }

    return ctx
  }

  /** Add a user with the given role, creating them as a volunteer then assigning the role. */
  async addUser(role: RoleAlias, name?: string): Promise<TestUser> {
    const sk = generateSecretKey()
    const pubkey = nostrGetPubkey(sk)
    const nsec = nip19.nsecEncode(sk)
    const phone = uniquePhone()
    const userName = name ?? `Test ${role} ${Date.now().toString(36)}`
    const roleId = ROLE_ID_MAP[role]

    // Create volunteer with the requested role
    const createRes = await this.adminApi.post('/api/volunteers', {
      name: userName,
      phone,
      pubkey,
      roleIds: [roleId],
    })
    if (!createRes.ok()) {
      throw new Error(`Failed to create ${role}: ${createRes.status()} ${await createRes.text()}`)
    }

    // Enroll in Authentik so userinfo / token refresh works for this user
    await enrollInAuthentik(this.adminApi, pubkey)

    // Add as hub member
    await this.adminApi.post(`/api/hubs/${this.hubId}/members`, {
      pubkey,
      roleIds: [roleId],
    })

    const api = createAuthedRequest(this.rawRequest, sk)
    const user: TestUser = { sk, pubkey, nsec, name: userName, phone, roleIds: [roleId], api }
    this.users.set(role, user)
    return user
  }

  /** Get the TestUser for a role. Throws if not created. */
  user(role: RoleAlias): TestUser {
    const u = this.users.get(role)
    if (!u)
      throw new Error(`No user for role '${role}'. Did you include it in TestContext.create()?`)
    return u
  }

  /** Get the AuthedRequest for a role. */
  api(role: RoleAlias): AuthedRequest {
    return this.user(role).api
  }

  /** Hub-scoped path helper. */
  hubPath(path: string): string {
    return `/api/hubs/${this.hubId}${path}`
  }

  /** Recreate AuthedRequest objects after Playwright creates new request context (beforeEach). */
  refreshApis(request: APIRequestContext): void {
    this.rawRequest = request
    for (const [, user] of this.users) {
      user.api = createAuthedRequest(request, user.sk)
    }
    this._adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  /** Create a custom role within the test hub and return its ID. */
  async createCustomRole(name: string, permissions: string[], slug?: string): Promise<string> {
    const roleSlug = slug ?? uniqueSlug(name.toLowerCase().replace(/\s+/g, '-'))
    const res = await this.adminApi.post('/api/settings/roles', {
      name,
      slug: roleSlug,
      permissions,
      description: `Test role: ${name}`,
    })
    if (res.status() !== 201) {
      throw new Error(`Failed to create custom role: ${res.status()} ${await res.text()}`)
    }
    const body = await res.json()
    this.customRoleIds.push(body.id)
    return body.id
  }

  /** Assign a user to a custom role (replaces existing roles). */
  async assignRole(pubkey: string, roleIds: string[]): Promise<void> {
    const res = await this.adminApi.patch(`/api/volunteers/${pubkey}`, { roles: roleIds })
    if (!res.ok()) {
      throw new Error(`Failed to assign role: ${res.status()} ${await res.text()}`)
    }
  }

  /** Delete the hub and all created custom roles. */
  async cleanup(): Promise<void> {
    const errors: string[] = []

    // Delete custom roles
    for (const roleId of this.customRoleIds) {
      try {
        await this.adminApi.delete(`/api/settings/roles/${roleId}`)
      } catch (e) {
        errors.push(`role ${roleId}: ${e}`)
      }
    }

    // Delete the hub
    try {
      const res = await this.adminApi.delete(`/api/hubs/${this.hubId}`)
      if (!res.ok() && res.status() !== 404) {
        errors.push(`hub: ${res.status()}`)
      }
    } catch (e) {
      errors.push(`hub: ${e}`)
    }

    if (errors.length > 0) {
      console.warn('TestContext cleanup errors:', errors.join(', '))
    }
  }
}

// ─── Standalone helpers (backward-compatible) ────────────────────────────────

/**
 * Create a volunteer directly via API.
 * Much faster than going through the UI.
 */
export async function createVolunteerViaApi(
  request: APIRequestContext,
  options?: { name?: string; phone?: string; roleIds?: string[] }
): Promise<CreateVolunteerResult> {
  const name = options?.name || uniqueName('TestVol')
  const phone = options?.phone || uniquePhone()
  const roleIds = options?.roleIds || ['role-volunteer']

  const sk = generateSecretKey()
  const actualPubkey = nostrGetPubkey(sk)
  const nsec = nip19.nsecEncode(sk)

  const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  const res = await adminApi.post('/api/volunteers', { name, phone, roleIds, pubkey: actualPubkey })

  if (!res.ok()) {
    throw new Error(`Failed to create volunteer: ${res.status()} ${await res.text()}`)
  }

  // Enroll in Authentik so userinfo / token refresh works for this user
  await enrollInAuthentik(adminApi, actualPubkey)

  return { pubkey: actualPubkey, nsec, name, phone }
}

/**
 * Create a volunteer and return both the result and the raw secret key.
 * Useful when you need an AuthedRequest for the new volunteer.
 */
export async function createVolunteerWithKey(
  request: APIRequestContext,
  options?: { name?: string; phone?: string; roleIds?: string[] }
): Promise<CreateVolunteerResult & { sk: Uint8Array }> {
  const name = options?.name || uniqueName('TestVol')
  const phone = options?.phone || uniquePhone()
  const roleIds = options?.roleIds || ['role-volunteer']

  const sk = generateSecretKey()
  const actualPubkey = nostrGetPubkey(sk)
  const nsec = nip19.nsecEncode(sk)

  const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  const res = await adminApi.post('/api/volunteers', { name, phone, roleIds, pubkey: actualPubkey })

  if (!res.ok()) {
    throw new Error(`Failed to create volunteer: ${res.status()} ${await res.text()}`)
  }

  // Enroll in Authentik so userinfo / token refresh works for this user
  await enrollInAuthentik(adminApi, actualPubkey)

  return { pubkey: actualPubkey, nsec, name, phone, sk }
}

export async function deleteVolunteerViaApi(
  request: APIRequestContext,
  pubkey: string
): Promise<void> {
  const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  const res = await adminApi.delete(`/api/volunteers/${pubkey}`)
  if (!res.ok()) {
    throw new Error(`Failed to delete volunteer: ${res.status()} ${await res.text()}`)
  }
}

export async function createBanViaApi(
  request: APIRequestContext,
  options?: { phone?: string; reason?: string }
): Promise<CreateBanResult> {
  const phone = options?.phone || uniquePhone()
  const reason = options?.reason || 'E2E test ban'

  const res = await request.post('/api/bans', {
    data: { phone, reason },
  })

  if (!res.ok()) {
    throw new Error(`Failed to create ban: ${res.status()} ${await res.text()}`)
  }

  return { phone, reason }
}

export async function removeBanViaApi(request: APIRequestContext, phone: string): Promise<void> {
  const res = await request.delete(`/api/bans/${encodeURIComponent(phone)}`)
  if (!res.ok()) {
    throw new Error(`Failed to remove ban: ${res.status()} ${await res.text()}`)
  }
}

export async function createShiftViaApi(
  request: APIRequestContext,
  options?: {
    name?: string
    startTime?: string
    endTime?: string
    days?: number[]
    volunteerPubkeys?: string[]
  }
): Promise<CreateShiftResult> {
  const name = options?.name || uniqueName('TestShift')
  const startTime = options?.startTime || '09:00'
  const endTime = options?.endTime || '17:00'
  const days = options?.days || [1, 2, 3, 4, 5]
  const volunteerPubkeys = options?.volunteerPubkeys || []

  const res = await request.post('/api/shifts', {
    data: { name, startTime, endTime, days, volunteerPubkeys },
  })

  if (!res.ok()) {
    throw new Error(`Failed to create shift: ${res.status()} ${await res.text()}`)
  }

  const data = await res.json()
  return { id: data.shift.id, name }
}

export async function deleteShiftViaApi(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`/api/shifts/${id}`)
  if (!res.ok()) {
    throw new Error(`Failed to delete shift: ${res.status()} ${await res.text()}`)
  }
}

export async function listVolunteersViaApi(
  request: APIRequestContext
): Promise<Array<{ pubkey: string; name: string; phone: string }>> {
  const res = await request.get('/api/volunteers')
  if (!res.ok()) {
    throw new Error(`Failed to list volunteers: ${res.status()} ${await res.text()}`)
  }
  const data = await res.json()
  return data.volunteers
}

export async function listBansViaApi(
  request: APIRequestContext
): Promise<Array<{ phone: string; reason: string }>> {
  const res = await request.get('/api/bans')
  if (!res.ok()) {
    throw new Error(`Failed to list bans: ${res.status()} ${await res.text()}`)
  }
  const data = await res.json()
  return data.bans
}

export async function listShiftsViaApi(
  request: APIRequestContext
): Promise<Array<{ id: string; name: string }>> {
  const res = await request.get('/api/shifts')
  if (!res.ok()) {
    throw new Error(`Failed to list shifts: ${res.status()} ${await res.text()}`)
  }
  const data = await res.json()
  return data.shifts
}

export async function cleanupTestData(
  request: APIRequestContext,
  data: {
    volunteerPubkeys?: string[]
    banPhones?: string[]
    shiftIds?: string[]
  }
): Promise<void> {
  const errors: Error[] = []

  for (const pubkey of data.volunteerPubkeys || []) {
    try {
      await deleteVolunteerViaApi(request, pubkey)
    } catch (e) {
      errors.push(e as Error)
    }
  }

  for (const phone of data.banPhones || []) {
    try {
      await removeBanViaApi(request, phone)
    } catch (e) {
      errors.push(e as Error)
    }
  }

  for (const id of data.shiftIds || []) {
    try {
      await deleteShiftViaApi(request, id)
    } catch (e) {
      errors.push(e as Error)
    }
  }

  if (errors.length > 0) {
    console.warn('Cleanup errors:', errors.map((e) => e.message).join(', '))
  }
}
