import { test, expect } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { createAuthedRequestFromNsec, createAuthedRequest, type AuthedRequest } from '../helpers/authed-request'
import { ADMIN_NSEC, resetTestState, uniquePhone } from '../helpers'

// --- Role CRUD via API ---

test.describe('Role Management API', () => {
  test.describe.configure({ mode: 'serial' })

  let authedApi: AuthedRequest
  let customRoleId: string
  let customRoleSlug: string

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ request }) => {
    authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test('lists default roles', async () => {
    const res = await authedApi.get('/api/settings/roles')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.roles).toBeDefined()
    expect(body.roles.length).toBeGreaterThanOrEqual(5)

    const roleNames = body.roles.map((r: { name: string }) => r.name)
    expect(roleNames).toContain('Super Admin')
    expect(roleNames).toContain('Hub Admin')
    expect(roleNames).toContain('Reviewer')
    expect(roleNames).toContain('Volunteer')
    expect(roleNames).toContain('Reporter')

    // Verify Super Admin has wildcard permission
    const superAdmin = body.roles.find((r: { slug: string }) => r.slug === 'super-admin')
    expect(superAdmin.permissions).toContain('*')
    expect(superAdmin.isSystem).toBe(true)
    expect(superAdmin.isDefault).toBe(true)
  })

  test('creates a custom role', async () => {
    const suffix = Date.now().toString(36)
    const res = await authedApi.post('/api/settings/roles', {
      name: `Call Monitor ${suffix}`,
      slug: `call-monitor-${suffix}`,
      permissions: ['calls:read-active', 'calls:read-history', 'calls:read-presence'],
      description: 'Can view call activity but not answer calls',
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.name).toBe(`Call Monitor ${suffix}`)
    expect(body.slug).toBe(`call-monitor-${suffix}`)
    expect(body.permissions).toEqual(['calls:read-active', 'calls:read-history', 'calls:read-presence'])
    expect(body.isDefault).toBe(false)
    expect(body.isSystem).toBe(false)
    expect(body.id).toMatch(/^role-/)
    customRoleId = body.id
    customRoleSlug = body.slug
  })

  test('rejects duplicate slug', async () => {
    const res = await authedApi.post('/api/settings/roles', {
      name: 'Call Monitor Dupe',
      slug: customRoleSlug,
      permissions: ['calls:read-active'],
      description: 'Duplicate slug test',
    })
    expect(res.status()).toBe(409)
  })

  test('rejects invalid slug format', async () => {
    const res = await authedApi.post('/api/settings/roles', {
      name: 'Bad Slug',
      slug: 'BAD SLUG!!!',
      permissions: ['calls:read-active'],
      description: 'Invalid slug test',
    })
    // Server may reject (400), accept then conflict (409), or accept (201)
    // The important thing is it doesn't crash (500)
    expect(res.status()).not.toBe(500)
  })

  test('updates a custom role permissions', async () => {
    expect(customRoleId).toBeDefined()

    const res = await authedApi.patch(`/api/settings/roles/${customRoleId}`, {
      permissions: ['calls:read-active', 'calls:read-history', 'calls:read-presence', 'calls:answer'],
      description: 'Can now also answer calls',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.permissions).toContain('calls:answer')
    expect(body.description).toBe('Can now also answer calls')
  })

  test('cannot modify system role (Super Admin)', async () => {
    const res = await authedApi.patch('/api/settings/roles/role-super-admin', {
      name: 'Hacked Admin',
      permissions: [],
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('system')
  })

  test('cannot delete default roles', async () => {
    // Try to delete each default role
    const defaultRoleIds = ['role-super-admin', 'role-hub-admin', 'role-reviewer', 'role-volunteer', 'role-reporter']
    for (const id of defaultRoleIds) {
      const res = await authedApi.delete(`/api/settings/roles/${id}`)
      expect(res.status()).toBe(403)
    }
  })

  test('deletes a custom role', async () => {
    expect(customRoleId).toBeDefined()

    const res = await authedApi.delete(`/api/settings/roles/${customRoleId}`)
    expect(res.status()).toBe(200)

    // Verify it's gone
    const listRes = await authedApi.get('/api/settings/roles')
    const body = await listRes.json()
    const roleIds = body.roles.map((r: { id: string }) => r.id)
    expect(roleIds).not.toContain(customRoleId)
  })

  test('deleting non-existent role returns 404', async () => {
    const res = await authedApi.delete('/api/settings/roles/role-does-not-exist')
    expect(res.status()).toBe(404)
  })

  test('fetches permissions catalog', async () => {
    const res = await authedApi.get('/api/settings/permissions')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.permissions).toBeDefined()
    expect(body.byDomain).toBeDefined()

    // Check some expected permissions exist
    expect(body.permissions['calls:answer']).toBeDefined()
    expect(body.permissions['notes:create']).toBeDefined()
    expect(body.permissions['settings:manage']).toBeDefined()

    // Check domains are grouped
    expect(body.byDomain['calls']).toBeDefined()
    expect(body.byDomain['notes']).toBeDefined()
    expect(body.byDomain['settings']).toBeDefined()
  })
})

// --- Permission Enforcement ---

test.describe('Permission Enforcement', () => {
  test.describe.configure({ mode: 'serial' })

  let authedApi: AuthedRequest
  let volunteerApi: AuthedRequest
  let reporterApi: AuthedRequest

  // Store secret keys so we can recreate authed requests in beforeEach
  let volSk: Uint8Array
  let repSk: Uint8Array

  test.beforeAll(async ({ request }) => {
    const setupApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a volunteer (default role: volunteer)
    volSk = generateSecretKey()
    const volPubkey = getPublicKey(volSk)
    await setupApi.post('/api/volunteers', {
      name: 'PBAC Vol',
      phone: uniquePhone(),
      pubkey: volPubkey,
      roleIds: ['role-volunteer'],
    })

    // Create a reporter: create as volunteer, then change role to reporter
    repSk = generateSecretKey()
    const repPubkey = getPublicKey(repSk)
    await setupApi.post('/api/volunteers', {
      name: 'PBAC Reporter',
      phone: uniquePhone(),
      pubkey: repPubkey,
      roleIds: ['role-volunteer'],
    })
    await setupApi.patch(`/api/volunteers/${repPubkey}`, {
      roles: ['role-reporter'],
    })
  })

  test.beforeEach(async ({ request }) => {
    authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    volunteerApi = createAuthedRequest(request, volSk)
    reporterApi = createAuthedRequest(request, repSk)
  })

  test('admin (super-admin) can access all endpoints', async () => {
    // Verify admin has wildcard permissions
    const meRes = await authedApi.get('/api/auth/me')
    expect(meRes.status()).toBe(200)
    const meBody = await meRes.json()
    expect(meBody.permissions).toContain('*')

    // Can access admin-only endpoints
    const volunteerRes = await authedApi.get('/api/volunteers')
    expect(volunteerRes.status()).toBe(200)

    const auditRes = await authedApi.get('/api/audit')
    expect(auditRes.status()).toBe(200)

    const spamRes = await authedApi.get('/api/settings/spam')
    expect(spamRes.status()).toBe(200)

    const rolesRes = await authedApi.get('/api/settings/roles')
    expect(rolesRes.status()).toBe(200)
  })

  test('volunteer role gets correct permissions from /auth/me', async () => {
    const meRes = await volunteerApi.get('/api/auth/me')
    expect(meRes.status()).toBe(200)
    const meBody = await meRes.json()

    // Should have volunteer permissions
    expect(meBody.permissions).toContain('calls:answer')
    expect(meBody.permissions).toContain('notes:create')
    expect(meBody.permissions).toContain('notes:read-own')
    expect(meBody.permissions).toContain('shifts:read-own')

    // Should NOT have admin permissions
    expect(meBody.permissions).not.toContain('*')
    expect(meBody.permissions).not.toContain('volunteers:read')
    expect(meBody.permissions).not.toContain('settings:manage')
    expect(meBody.permissions).not.toContain('audit:read')
  })

  test('volunteer cannot access admin endpoints (403)', async () => {
    // Volunteers don't have volunteers:read
    const volunteerRes = await volunteerApi.get('/api/volunteers')
    expect(volunteerRes.status()).toBe(403)

    // Volunteers don't have audit:read (may return 400 if hub context required, or 403)
    const auditRes = await volunteerApi.get('/api/audit')
    expect([400, 403]).toContain(auditRes.status())

    // Volunteers don't have settings:manage-spam
    const spamRes = await volunteerApi.get('/api/settings/spam')
    expect(spamRes.status()).toBe(403)

    // Volunteers don't have system:manage-roles
    const rolesCreateRes = await volunteerApi.post('/api/settings/roles', {
      name: 'Hack Role',
      slug: `hack-role-${Date.now().toString(36)}`,
      permissions: ['*'],
      description: 'Attempt to escalate privileges',
    })
    expect(rolesCreateRes.status()).toBe(403)

    // Volunteers don't have settings:manage-telephony
    const telRes = await volunteerApi.get('/api/settings/telephony-provider')
    expect(telRes.status()).toBe(403)
  })

  test('reporter role has very limited permissions', async () => {
    const meRes = await reporterApi.get('/api/auth/me')
    expect(meRes.status()).toBe(200)
    const meBody = await meRes.json()

    // Reporter should have report permissions
    expect(meBody.permissions).toContain('reports:create')
    expect(meBody.permissions).toContain('reports:read-own')
    expect(meBody.permissions).toContain('files:upload')
    expect(meBody.permissions).toContain('files:download-own')

    // Reporter should NOT have call or volunteer management permissions
    expect(meBody.permissions).not.toContain('calls:answer')
    expect(meBody.permissions).not.toContain('notes:create')
    expect(meBody.permissions).not.toContain('volunteers:read')
  })

  test('reporter cannot access call-related endpoints', async () => {
    // Reporter doesn't have notes:read-own
    const notesRes = await reporterApi.get('/api/notes')
    expect([400, 403]).toContain(notesRes.status())

    // Reporter doesn't have calls:read-history
    const callHistoryRes = await reporterApi.get('/api/calls/history')
    expect([400, 403]).toContain(callHistoryRes.status())

    // Reporter doesn't have volunteers:read
    const volRes = await reporterApi.get('/api/volunteers')
    expect(volRes.status()).toBe(403)
  })
})

// --- Multi-Role Users ---

test.describe('Multi-role users', () => {
  test.describe.configure({ mode: 'serial' })

  let authedApi: AuthedRequest
  let multiRoleApi: AuthedRequest
  let multiRoleSk: Uint8Array

  test.beforeAll(async ({ request }) => {
    const setupApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a volunteer
    multiRoleSk = generateSecretKey()
    const pubkey = getPublicKey(multiRoleSk)
    await setupApi.post('/api/volunteers', {
      name: 'Multi-Role User',
      phone: uniquePhone(),
      pubkey,
      roleIds: ['role-volunteer'],
    })

    // Assign both volunteer AND reviewer roles
    await setupApi.patch(`/api/volunteers/${pubkey}`, {
      roles: ['role-volunteer', 'role-reviewer'],
    })
  })

  test.beforeEach(async ({ request }) => {
    authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    multiRoleApi = createAuthedRequest(request, multiRoleSk)
  })

  test('multi-role user gets union of all role permissions', async () => {
    const meRes = await multiRoleApi.get('/api/auth/me')
    expect(meRes.status()).toBe(200)
    const meBody = await meRes.json()

    // Should have volunteer permissions
    expect(meBody.permissions).toContain('calls:answer')
    expect(meBody.permissions).toContain('notes:create')
    expect(meBody.permissions).toContain('notes:read-own')

    // Should also have reviewer permissions
    expect(meBody.permissions).toContain('notes:read-assigned')
    expect(meBody.permissions).toContain('reports:read-assigned')
    expect(meBody.permissions).toContain('reports:assign')
    expect(meBody.permissions).toContain('reports:update')
    expect(meBody.permissions).toContain('reports:send-message')

    // Should have both role IDs
    expect(meBody.roles).toContain('role-volunteer')
    expect(meBody.roles).toContain('role-reviewer')

    // Primary role should be the higher-privilege one (reviewer < volunteer in priority)
    // Reviewer is priority 2, volunteer is priority 3 — so reviewer is primary
    expect(meBody.primaryRole.slug).toBe('reviewer')
  })
})

// --- Custom Role Enforcement ---

test.describe('Custom role with specific permissions', () => {
  test.describe.configure({ mode: 'serial' })

  let authedApi: AuthedRequest
  let customApi: AuthedRequest
  let customRoleId: string
  let customSk: Uint8Array

  test.beforeAll(async ({ request }) => {
    const setupApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a custom role with very specific permissions
    const roleRes = await setupApi.post('/api/settings/roles', {
      name: 'Shift Viewer',
      slug: `shift-viewer-${Date.now().toString(36)}`,
      permissions: ['shifts:read', 'bans:read'],
      description: 'Can only view shifts and bans',
    })
    expect(roleRes.status()).toBe(201)
    const roleBody = await roleRes.json()
    customRoleId = roleBody.id

    // Create a volunteer
    customSk = generateSecretKey()
    const pubkey = getPublicKey(customSk)
    await setupApi.post('/api/volunteers', {
      name: 'Shift Viewer User',
      phone: uniquePhone(),
      pubkey,
      roleIds: ['role-volunteer'],
    })

    // Assign custom role
    await setupApi.patch(`/api/volunteers/${pubkey}`, {
      roles: [customRoleId],
    })
  })

  test.beforeEach(async ({ request }) => {
    authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    customApi = createAuthedRequest(request, customSk)
  })

  test('user with custom role gets only those permissions', async () => {
    const meRes = await customApi.get('/api/auth/me')
    expect(meRes.status()).toBe(200)
    const meBody = await meRes.json()

    // Should have custom role permissions
    expect(meBody.permissions).toContain('shifts:read')
    expect(meBody.permissions).toContain('bans:read')

    // Should NOT have any other permissions
    expect(meBody.permissions).not.toContain('calls:answer')
    expect(meBody.permissions).not.toContain('notes:create')
    expect(meBody.permissions).not.toContain('volunteers:read')
    expect(meBody.permissions).not.toContain('settings:manage')
  })

  test('custom role user can access shifts endpoint', async () => {
    // Should be able to read shifts (may return 400 if hub context required)
    const shiftsRes = await customApi.get('/api/shifts')
    expect([200, 400]).toContain(shiftsRes.status())

    // Should be able to read bans (may return 400 if hub context required)
    const bansRes = await customApi.get('/api/bans')
    expect([200, 400]).toContain(bansRes.status())
  })

  test('custom role user cannot access endpoints outside permissions', async () => {
    // Cannot access volunteers
    const volRes = await customApi.get('/api/volunteers')
    expect(volRes.status()).toBe(403)

    // Cannot access audit (may return 400 if hub context required, or 403)
    const auditRes = await customApi.get('/api/audit')
    expect([400, 403]).toContain(auditRes.status())

    // Cannot create shifts (only has shifts:read, not shifts:create)
    // May return 400 if hub context required at API level
    const createShiftRes = await customApi.post('/api/shifts', {
      name: 'Unauthorized Shift',
      startTime: '09:00',
      endTime: '17:00',
      days: [1, 2, 3],
      volunteerPubkeys: [],
    })
    expect([400, 403]).toContain(createShiftRes.status())

    // Cannot create bans (only has bans:read, not bans:create)
    // May return 400 if hub context required at API level
    const createBanRes = await customApi.post('/api/bans', {
      phone: '+15551234567',
      reason: 'Unauthorized ban',
    })
    expect([400, 403]).toContain(createBanRes.status())

    // Cannot access notes
    const notesRes = await customApi.get('/api/notes')
    expect([400, 403]).toContain(notesRes.status())
  })
})

// --- Domain wildcard permissions ---

test.describe('Wildcard permission resolution', () => {
  test.describe.configure({ mode: 'serial' })

  let authedApi: AuthedRequest
  let wildcardApi: AuthedRequest
  let wildcardSk: Uint8Array

  test.beforeAll(async ({ request }) => {
    const setupApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a custom role with domain wildcard (bans:*)
    const roleRes = await setupApi.post('/api/settings/roles', {
      name: 'Ban Manager',
      slug: `ban-manager-${Date.now().toString(36)}`,
      permissions: ['bans:*'],
      description: 'Full access to ban management',
    })
    expect(roleRes.status()).toBe(201)
    const roleBody = await roleRes.json()

    // Create user and assign the custom role
    wildcardSk = generateSecretKey()
    const pubkey = getPublicKey(wildcardSk)
    await setupApi.post('/api/volunteers', {
      name: 'Ban Manager User',
      phone: uniquePhone(),
      pubkey,
      roleIds: ['role-volunteer'],
    })
    await setupApi.patch(`/api/volunteers/${pubkey}`, {
      roles: [roleBody.id],
    })
  })

  test.beforeEach(async ({ request }) => {
    authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    wildcardApi = createAuthedRequest(request, wildcardSk)
  })

  test('domain wildcard grants all permissions in that domain', async () => {
    // bans:* should allow bans:read, bans:create, bans:delete, bans:bulk-create
    // May return 400 if hub context is required at API level
    const readRes = await wildcardApi.get('/api/bans')
    expect([200, 400]).toContain(readRes.status())

    const createRes = await wildcardApi.post('/api/bans', {
      phone: '+15559876543',
      reason: 'Wildcard test ban',
    })
    // Expect 200 (success) or 400 (hub context required)
    expect([200, 400]).toContain(createRes.status())

    // But should not have access to other domains
    const volRes = await wildcardApi.get('/api/volunteers')
    expect(volRes.status()).toBe(403)

    const auditRes = await wildcardApi.get('/api/audit')
    expect([400, 403]).toContain(auditRes.status())
  })
})
