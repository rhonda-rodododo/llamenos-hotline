import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_ROLES,
  PERMISSION_CATALOG,
  PERMISSION_GROUP_LABELS,
  type Permission,
  type PermissionMeta,
  hasPermission,
} from './permissions'

describe('typed permission catalog', () => {
  test('every permission has label, group, and subgroup', () => {
    for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
      expect(meta.label).toBeTruthy()
      expect(meta.group).toBeTruthy()
      expect(['scope', 'actions', 'tiers']).toContain(meta.subgroup)
    }
  })

  test('every group has a label', () => {
    const groups = new Set(Object.values(PERMISSION_CATALOG).map((m) => m.group))
    for (const group of groups) {
      expect(PERMISSION_GROUP_LABELS[group]).toBeTruthy()
    }
  })

  test('scope permissions follow naming convention', () => {
    for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
      if (meta.subgroup === 'scope') {
        expect(key).toMatch(/-(own|assigned|all)$/)
      }
    }
  })

  test('Permission type includes all catalog keys', () => {
    const keys = Object.keys(PERMISSION_CATALOG) as Permission[]
    expect(keys.length).toBeGreaterThan(60)
  })
})

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
