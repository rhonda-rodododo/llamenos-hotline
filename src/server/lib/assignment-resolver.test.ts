/**
 * Assignment Resolver unit tests.
 *
 * Tests use a mock Database to verify resolver logic without requiring Postgres.
 * Integration tests requiring real DB should go in assignment-resolver.integration.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import type { AssignmentCheck, AssignmentResolver } from './assignment-resolver'
import { ContactsAssignmentResolver } from './assignment-resolver'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockDb(opts: {
  contact?: { createdBy: string; assignedTo: string | null } | null
  callLinkRows?: unknown[]
  listRows?: { id: string }[]
}) {
  let executeCallCount = 0
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (opts.contact ? [opts.contact] : []),
        }),
      }),
    }),
    execute: () => {
      // In isAssigned, execute is called once (call link check).
      // In listAssignedIds, execute is called once (the big SELECT DISTINCT).
      // We use callLinkRows for isAssigned and listRows for listAssignedIds.
      executeCallCount++
      // If listRows are provided and this is a listAssignedIds call, return them.
      // If callLinkRows are provided, return them (isAssigned call link check).
      // The test distinguishes by setting only the relevant option.
      if (opts.listRows !== undefined) {
        return Promise.resolve(opts.listRows)
      }
      return Promise.resolve(opts.callLinkRows ?? [])
    },
  } as never // Cast to Database — mock only implements what we need
}

// ---------------------------------------------------------------------------
// Interface contract tests
// ---------------------------------------------------------------------------

describe('AssignmentResolver interface', () => {
  test('ContactsAssignmentResolver implements AssignmentResolver', () => {
    const resolver: AssignmentResolver = new ContactsAssignmentResolver(createMockDb({}))
    expect(typeof resolver.isAssigned).toBe('function')
    expect(typeof resolver.listAssignedIds).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// isAssigned tests
// ---------------------------------------------------------------------------

describe('ContactsAssignmentResolver.isAssigned', () => {
  const baseCheck: AssignmentCheck = {
    resourceId: 'contact-1',
    userPubkey: 'user-abc',
    hubId: 'hub-1',
  }

  test('returns true when user is createdBy', async () => {
    const db = createMockDb({
      contact: { createdBy: 'user-abc', assignedTo: null },
    })
    const resolver = new ContactsAssignmentResolver(db)
    expect(await resolver.isAssigned(baseCheck)).toBe(true)
  })

  test('returns true when user is assignedTo', async () => {
    const db = createMockDb({
      contact: { createdBy: 'other-user', assignedTo: 'user-abc' },
    })
    const resolver = new ContactsAssignmentResolver(db)
    expect(await resolver.isAssigned(baseCheck)).toBe(true)
  })

  test('returns true when user is linked via call leg', async () => {
    const db = createMockDb({
      contact: { createdBy: 'other-user', assignedTo: null },
      callLinkRows: [{ '?column?': 1 }],
    })
    const resolver = new ContactsAssignmentResolver(db)
    expect(await resolver.isAssigned(baseCheck)).toBe(true)
  })

  test('returns false when user has no assignment', async () => {
    const db = createMockDb({
      contact: { createdBy: 'other-user', assignedTo: 'yet-another' },
      callLinkRows: [],
    })
    const resolver = new ContactsAssignmentResolver(db)
    expect(await resolver.isAssigned(baseCheck)).toBe(false)
  })

  test('returns false when contact does not exist', async () => {
    const db = createMockDb({
      contact: null,
      callLinkRows: [],
    })
    const resolver = new ContactsAssignmentResolver(db)
    expect(await resolver.isAssigned(baseCheck)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listAssignedIds tests
// ---------------------------------------------------------------------------

describe('ContactsAssignmentResolver.listAssignedIds', () => {
  test('returns list of assigned contact IDs', async () => {
    const db = createMockDb({
      listRows: [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }],
    })
    const resolver = new ContactsAssignmentResolver(db)
    const ids = await resolver.listAssignedIds('user-abc', 'hub-1')
    expect(ids).toEqual(['c-1', 'c-2', 'c-3'])
  })

  test('returns empty array when no assignments', async () => {
    const db = createMockDb({ listRows: [] })
    const resolver = new ContactsAssignmentResolver(db)
    const ids = await resolver.listAssignedIds('user-abc', 'hub-1')
    expect(ids).toEqual([])
  })
})
