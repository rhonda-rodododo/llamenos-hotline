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
  teamLinkRows?: unknown[]
  listRows?: { id: string }[]
}) {
  // Track execute call count so isAssigned can route to the right mock result:
  //   call 0 → callLinkRows (call-leg check)
  //   call 1 → teamLinkRows (team membership check)
  // In listAssignedIds, execute is called once (big SELECT DISTINCT) → listRows.
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
      if (opts.listRows !== undefined) {
        return Promise.resolve(opts.listRows)
      }
      const callIndex = executeCallCount++
      if (callIndex === 0) {
        return Promise.resolve(opts.callLinkRows ?? [])
      }
      // callIndex === 1: team membership check
      return Promise.resolve(opts.teamLinkRows ?? [])
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
      callLinkRows: [{ found: 1 }],
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

  test("returns true when contact assigned to user's team", async () => {
    const db = createMockDb({
      contact: { createdBy: 'other-user', assignedTo: null },
      callLinkRows: [], // no call link
      teamLinkRows: [{ found: 1 }], // but team membership exists
    })
    const resolver = new ContactsAssignmentResolver(db)
    expect(await resolver.isAssigned(baseCheck)).toBe(true)
  })

  test('returns false when contact has no team assignment', async () => {
    const db = createMockDb({
      contact: { createdBy: 'other-user', assignedTo: null },
      callLinkRows: [],
      teamLinkRows: [], // no team link either
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

  test('returns team-assigned contacts in list', async () => {
    // The SQL query includes team assignments in the same UNION/OR clause,
    // so the mock just verifies the resolver returns whatever the DB gives back.
    const db = createMockDb({
      listRows: [{ id: 'c-1' }, { id: 'c-team-1' }],
    })
    const resolver = new ContactsAssignmentResolver(db)
    const ids = await resolver.listAssignedIds('user-abc', 'hub-1')
    expect(ids).toEqual(['c-1', 'c-team-1'])
  })
})
