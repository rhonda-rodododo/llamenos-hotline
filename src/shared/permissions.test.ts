import { describe, expect, test } from 'bun:test'
import { DEFAULT_ROLES, PERMISSION_CATALOG, hasPermission } from './permissions'

describe('voicemail permissions', () => {
  test('voicemail:* permissions exist in catalog', () => {
    expect(PERMISSION_CATALOG['voicemail:listen']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:read']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:notify']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:delete']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:manage']).toBeDefined()
  })

  test('Hub Admin has voicemail:* wildcard', () => {
    const hubAdmin = DEFAULT_ROLES.find((r) => r.id === 'role-hub-admin')!
    // Cast to Role[] to satisfy hasPermission signature (createdAt/updatedAt optional in runtime)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasPermission([hubAdmin.id], DEFAULT_ROLES as any, 'voicemail:listen')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hasPermission([hubAdmin.id], DEFAULT_ROLES as any, 'voicemail:manage')).toBe(true)
  })

  test('User role has voicemail:read and calls:read-history', () => {
    const volunteerRole = DEFAULT_ROLES.find((r) => r.id === 'role-volunteer')!
    expect(volunteerRole.permissions).toContain('voicemail:read')
    expect(volunteerRole.permissions).toContain('calls:read-history')
    expect(volunteerRole.permissions).not.toContain('voicemail:listen')
  })

  test('Voicemail Reviewer role exists with correct permissions', () => {
    const reviewer = DEFAULT_ROLES.find((r) => r.id === 'role-voicemail-reviewer')!
    expect(reviewer).toBeDefined()
    expect(reviewer.permissions).toContain('voicemail:listen')
    expect(reviewer.permissions).toContain('voicemail:read')
    expect(reviewer.permissions).toContain('voicemail:notify')
    expect(reviewer.permissions).toContain('notes:read-all')
    expect(reviewer.permissions).toContain('calls:read-history')
  })
})
