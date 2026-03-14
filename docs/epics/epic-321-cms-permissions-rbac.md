# Epic 321: CMS Permissions & RBAC

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 315 (Schema Engine), Epic 319 (Record Entity)
**Blocks**: Epic 322 (Contact Relationships), Epic 328 (Cross-Hub), Epic 330 (Desktop Case UI)
**Branch**: `desktop`

## Summary

Extend the existing permission system with entity-type-level access control, 3-tier envelope recipient determination, and template-suggested role creation. `EntityTypeDefinition.accessRoles` and `editRoles` restrict which roles can see or edit records of each type. The envelope recipient logic determines who gets summary, fields, and PII tier decryption keys based on their role, assignment status, and entity type configuration. Includes a route for creating roles from template suggestions. ~12 files created/modified.

## Problem Statement

Epic 315 added CMS permission domains (`cases:*`, `contacts:*`, `events:*`, `evidence:*`) and Epic 319 implemented basic permission checks on record CRUD. But the current system has gaps:

1. **No entity-type-level access**: A volunteer with `cases:read-own` can see all entity types. There is no way to say "Jail Support Coordinators can see arrest cases but not medical encounters."
2. **No envelope recipient logic**: The 3-tier encryption model (summary/fields/PII) exists in the schema but there is no implementation that determines which pubkeys get envelopes for each tier based on role permissions, assignment, and entity type configuration.
3. **No template role creation**: Templates suggest roles with CMS permissions, but there is no API to create those roles. Admins must manually create each role after applying a template.
4. **Assignment-based filtering is incomplete**: `cases:read-own` should only return records where the requesting user's pubkey is in `assignedTo`. `cases:read-assigned` should also include team members. The filtering logic needs refinement.

## Implementation

### Phase 1: API + Shared Specs

#### Task 1: Entity-Type-Level Access Enforcement

**File**: `apps/worker/middleware/permission-guard.ts` (extend)

Add entity-type-level permission checking to the existing `requirePermission` middleware. When a route accesses records, the middleware must also check that the user's role is included in the entity type's `accessRoles` (for reads) or `editRoles` (for writes).

```typescript
/**
 * Check entity-type-level access.
 * If the entity type has accessRoles/editRoles defined, the user's role must
 * be in the list. If the lists are empty, fall back to generic cases:* permissions.
 */
export function requireEntityTypeAccess(action: 'read' | 'write') {
  return async (c: Context<AppEnv>, next: Next) => {
    const entityTypeId = c.req.param('entityTypeId') ?? c.req.query('entityTypeId')
    if (!entityTypeId) return next() // No entity type context, skip

    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.settings.fetch(new Request('http://do/settings/entity-types'))
    const { entityTypes } = await res.json() as { entityTypes: EntityTypeDefinition[] }
    const entityType = entityTypes.find(et => et.id === entityTypeId)
    if (!entityType) return c.json({ error: 'Entity type not found' }, 404)

    const userRoles = c.get('roles') as string[] ?? []

    if (action === 'read') {
      // If accessRoles is defined and non-empty, check membership
      if (entityType.accessRoles && entityType.accessRoles.length > 0) {
        if (!userRoles.some(r => entityType.accessRoles!.includes(r))) {
          return c.json({ error: 'No access to this entity type' }, 403)
        }
      }
    } else {
      // For writes, check editRoles
      if (entityType.editRoles && entityType.editRoles.length > 0) {
        if (!userRoles.some(r => entityType.editRoles!.includes(r))) {
          return c.json({ error: 'Cannot edit this entity type' }, 403)
        }
      }
    }

    c.set('entityType', entityType)
    return next()
  }
}
```

#### Task 2: Assignment-Based Record Filtering

**File**: `apps/worker/durable-objects/case-do.ts` (extend)

Refine the `GET /records` handler to enforce assignment-based visibility:

```typescript
// When listing records, filter by the caller's access level:
// - cases:read-all  -> all records of accessible entity types
// - cases:read-assigned -> records where assignedTo includes caller OR caller's team members
// - cases:read-own -> records where assignedTo includes caller's pubkey only
//
// The permission level is passed via a header from the route layer.

this.router.get('/records', async (req) => {
  const accessLevel = req.headers.get('x-access-level') // 'all' | 'assigned' | 'own'
  const callerPubkey = req.headers.get('x-pubkey')
  const teamPubkeys = req.headers.get('x-team-pubkeys')?.split(',') ?? []

  // ... existing pagination and filter logic ...

  // Apply access-level filtering
  if (accessLevel === 'own') {
    records = records.filter(r => r.assignedTo.includes(callerPubkey))
  } else if (accessLevel === 'assigned') {
    const allowedPubkeys = [callerPubkey, ...teamPubkeys]
    records = records.filter(r => r.assignedTo.some(pk => allowedPubkeys.includes(pk)))
  }
  // 'all' -> no additional filtering

  return json({ records: paged, total, page, limit, hasMore })
})
```

#### Task 3: Envelope Recipient Determination Utility

**File**: `apps/worker/lib/envelope-recipients.ts` (new)

Server-side utility that computes which pubkeys should receive envelopes for each tier of a record. This is used by the API layer to include recipient pubkey lists in responses, enabling the client to build envelopes correctly.

```typescript
import type { EntityTypeDefinition } from '../schemas/entity-schema'

interface EnvelopeRecipients {
  summary: string[]   // Pubkeys for summary tier
  fields: string[]    // Pubkeys for fields tier
  pii: string[]       // Pubkeys for PII tier
}

/**
 * Determine envelope recipients for a record based on entity type definition,
 * record assignments, and hub membership.
 *
 * Summary tier:
 *   - All hub members whose roles are in entityType.accessRoles (or all if empty)
 *   - Always: hub admins
 *
 * Fields tier:
 *   - Assigned volunteers (record.assignedTo[])
 *   - Hub admins with cases:read-all
 *   - Roles listed in entityType.editRoles
 *
 * PII tier:
 *   - Hub admins only
 *   - Roles with contacts:view-pii permission
 */
export function determineEnvelopeRecipients(
  entityType: EntityTypeDefinition,
  assignedTo: string[],
  hubMembers: Array<{ pubkey: string; roles: string[]; permissions: string[] }>,
): EnvelopeRecipients {
  const adminPubkeys = hubMembers
    .filter(m => m.permissions.includes('cases:read-all') || m.permissions.includes('cases:*'))
    .map(m => m.pubkey)

  // Summary tier
  let summaryRecipients: string[]
  if (entityType.accessRoles && entityType.accessRoles.length > 0) {
    summaryRecipients = hubMembers
      .filter(m => m.roles.some(r => entityType.accessRoles!.includes(r)))
      .map(m => m.pubkey)
  } else {
    // No access restrictions -> all hub members with any cases:read-* permission
    summaryRecipients = hubMembers
      .filter(m => m.permissions.some(p => p.startsWith('cases:read')))
      .map(m => m.pubkey)
  }
  // Always include admins
  summaryRecipients = [...new Set([...summaryRecipients, ...adminPubkeys])]

  // Fields tier
  const editRolePubkeys = entityType.editRoles && entityType.editRoles.length > 0
    ? hubMembers.filter(m => m.roles.some(r => entityType.editRoles!.includes(r))).map(m => m.pubkey)
    : []
  const fieldsRecipients = [...new Set([...assignedTo, ...adminPubkeys, ...editRolePubkeys])]

  // PII tier
  const piiRecipients = hubMembers
    .filter(m => m.permissions.includes('contacts:view-pii') || m.permissions.includes('contacts:*'))
    .map(m => m.pubkey)

  return {
    summary: summaryRecipients,
    fields: fieldsRecipients,
    pii: [...new Set([...adminPubkeys, ...piiRecipients])],
  }
}
```

#### Task 4: Template-Suggested Role Creation

**File**: `apps/worker/routes/settings.ts` (extend)

Add a route that creates roles from template suggestions:

```typescript
// POST /api/settings/roles/from-template
// Creates roles with permissions from a template's suggestedRoles array.
settings.post('/roles/from-template',
  requirePermission('settings:manage'),
  async (c) => {
    const { roles } = await c.req.json<{ roles: Array<{
      name: string
      slug: string
      description: string
      permissions: string[]
    }> }>()

    const dos = getScopedDOs(c.env, c.get('hubId'))
    const created: Array<{ id: string; name: string }> = []

    for (const suggested of roles) {
      // Validate all permissions exist in PERMISSION_CATALOG
      const invalidPerms = suggested.permissions.filter(p => !isValidPermission(p))
      if (invalidPerms.length > 0) {
        return c.json({
          error: `Invalid permissions: ${invalidPerms.join(', ')}`,
          role: suggested.name,
        }, 400)
      }

      // Create role via SettingsDO
      const res = await dos.settings.fetch(new Request('http://do/settings/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: suggested.name,
          slug: suggested.slug,
          description: suggested.description,
          permissions: suggested.permissions,
          isTemplate: true,
        }),
      }))

      if (res.ok) {
        const role = await res.json() as { id: string; name: string }
        created.push(role)
        await audit(dos.records, 'roleCreatedFromTemplate', c.get('pubkey'), {
          roleId: role.id,
          roleName: role.name,
        })
      }
    }

    return c.json({ created, count: created.length }, 201)
  },
)
```

#### Task 5: Record Routes Enhancement

**File**: `apps/worker/routes/records.ts` (extend)

Update the record list route to determine the caller's access level and pass it to CaseDO:

```typescript
records.get('/',
  requirePermission(['cases:read-own', 'cases:read-assigned', 'cases:read-all']),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const permissions = c.get('permissions') as string[]

    // Determine access level from permissions (highest wins)
    let accessLevel: 'all' | 'assigned' | 'own'
    if (permissions.includes('cases:read-all') || permissions.includes('cases:*')) {
      accessLevel = 'all'
    } else if (permissions.includes('cases:read-assigned')) {
      accessLevel = 'assigned'
    } else {
      accessLevel = 'own'
    }

    const headers = new Headers()
    headers.set('x-access-level', accessLevel)
    headers.set('x-pubkey', c.get('pubkey'))

    // For 'assigned' level, include team member pubkeys
    if (accessLevel === 'assigned') {
      // Fetch team members from SettingsDO based on shared roles
      const teamPubkeys = await getTeamPubkeys(dos.settings, c.get('pubkey'))
      headers.set('x-team-pubkeys', teamPubkeys.join(','))
    }

    const qs = buildQueryString(c.req.query())
    const res = await dos.caseManager.fetch(new Request(`http://do/records?${qs}`, { headers }))
    return new Response(res.body, res)
  },
)
```

#### Task 6: Envelope Recipients Route

**File**: `apps/worker/routes/records.ts` (extend)

Add a route that returns envelope recipient pubkeys for a record, enabling the client to build envelopes:

```typescript
// GET /api/records/:id/envelope-recipients
// Returns the pubkeys that should receive envelopes for each tier.
records.get('/:id/envelope-recipients',
  requirePermission('cases:read-own'),
  async (c) => {
    const id = c.req.param('id')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    // Fetch record to get entityTypeId and assignedTo
    const recordRes = await dos.caseManager.fetch(new Request(`http://do/records/${id}`))
    if (!recordRes.ok) return c.json({ error: 'Record not found' }, 404)
    const record = await recordRes.json() as { entityTypeId: string; assignedTo: string[] }

    // Fetch entity type definition
    const etRes = await dos.settings.fetch(new Request('http://do/settings/entity-types'))
    const { entityTypes } = await etRes.json() as { entityTypes: EntityTypeDefinition[] }
    const entityType = entityTypes.find(et => et.id === record.entityTypeId)
    if (!entityType) return c.json({ error: 'Entity type not found' }, 404)

    // Fetch hub members
    const membersRes = await dos.settings.fetch(new Request('http://do/settings/members'))
    const { members } = await membersRes.json()

    const recipients = determineEnvelopeRecipients(entityType, record.assignedTo, members)
    return c.json(recipients)
  },
)
```

#### Task 7: i18n Strings

**File**: `packages/i18n/locales/en.json`

```json
{
  "rbac": {
    "entityTypeAccess": "Entity Type Access",
    "accessRoles": "Who can view",
    "editRoles": "Who can edit",
    "noRestrictions": "All hub members",
    "restrictedTo": "Restricted to: {{roles}}",
    "envelopeTiers": "Encryption Tiers",
    "summaryTier": "Summary (visible to all readers)",
    "fieldsTier": "Fields (visible to assigned + admins)",
    "piiTier": "PII (visible to admins only)",
    "createFromTemplate": "Create Roles from Template",
    "suggestedRoles": "Suggested Roles",
    "createSelected": "Create Selected Roles",
    "rolesCreated": "{{count}} roles created",
    "noAccessToType": "You do not have access to this entity type",
    "assignmentRequired": "You can only view records assigned to you"
  }
}
```

#### Task 8: BDD Feature File

**File**: `packages/test-specs/features/core/cms-permissions.feature`

```gherkin
@backend
Feature: CMS Permissions & RBAC
  Entity-type-level access control, assignment-based filtering,
  and envelope recipient determination for the case management system.

  Background:
    Given a registered admin "admin1"
    And case management is enabled
    And an entity type "arrest_case" with category "case"
    And an entity type "medical_encounter" with category "case"

  @cases @permissions
  Scenario: Entity type with accessRoles restricts visibility
    Given entity type "arrest_case" has accessRoles ["jail_support"]
    And a volunteer "vol1" with role "jail_support"
    And a volunteer "vol2" with role "street_medic"
    When volunteer "vol1" lists records of type "arrest_case"
    Then the request should succeed
    When volunteer "vol2" lists records of type "arrest_case"
    Then the response status should be 403

  @cases @permissions
  Scenario: Empty accessRoles allows all roles
    Given entity type "arrest_case" has no accessRoles restrictions
    And a volunteer "vol1" with role "intake_volunteer"
    When volunteer "vol1" lists records of type "arrest_case"
    Then the request should succeed

  @cases @permissions
  Scenario: Volunteer with cases:read-own sees only assigned records
    Given a volunteer "vol1" with permission "cases:read-own"
    And record "A" assigned to "vol1"
    And record "B" assigned to "vol2"
    And record "C" not assigned to anyone
    When volunteer "vol1" lists records
    Then only record "A" should be returned

  @cases @permissions
  Scenario: Volunteer with cases:read-assigned sees team records
    Given a volunteer "vol1" with role "jail_support" and permission "cases:read-assigned"
    And a volunteer "vol2" with role "jail_support"
    And record "A" assigned to "vol1"
    And record "B" assigned to "vol2"
    And record "C" assigned to "vol3" with role "street_medic"
    When volunteer "vol1" lists records
    Then records "A" and "B" should be returned
    But record "C" should not be returned

  @cases @permissions
  Scenario: Envelope recipients follow 3-tier model
    Given entity type "arrest_case" with piiFields ["arrestee_name", "phone_number"]
    And a record assigned to volunteer "vol1"
    When admin "admin1" requests envelope recipients for the record
    Then the summary tier should include all members with cases:read access
    And the fields tier should include "vol1" and admin pubkeys
    And the PII tier should include only admin pubkeys and contacts:view-pii holders

  @cases @permissions
  Scenario: Entity type editRoles restricts write access
    Given entity type "arrest_case" has editRoles ["jail_support", "admin"]
    And a volunteer "vol1" with role "legal_observer"
    When volunteer "vol1" tries to update a record of type "arrest_case"
    Then the response status should be 403

  @cases @permissions
  Scenario: Create roles from template suggestions
    Given a template "jail-support" with suggestedRoles:
      | name                    | slug                     | permissions                                     |
      | Hotline Coordinator     | hotline_coordinator      | cases:*, events:*, contacts:*                    |
      | Intake Volunteer        | intake_volunteer         | cases:create, cases:read-own, contacts:create    |
    When admin "admin1" creates roles from the template suggestions
    Then 2 new roles should be created
    And role "Hotline Coordinator" should have permission "cases:*"
    And role "Intake Volunteer" should have permission "cases:create"

  @cases @permissions
  Scenario: Creating roles with invalid permissions fails
    When admin "admin1" tries to create a role with permission "fake:nonexistent"
    Then the response status should be 400
    And the error should mention "Invalid permissions"

  @cases @permissions
  Scenario: Admin with cases:read-all sees all records regardless of assignment
    Given records assigned to various volunteers
    When admin "admin1" lists records
    Then all records should be returned regardless of assignment

  @cases @permissions
  Scenario: Volunteer cannot create template roles
    Given a registered volunteer "vol1"
    When volunteer "vol1" tries to create roles from template suggestions
    Then the response status should be 403
```

#### Task 9: Backend Step Definitions

**File**: `tests/steps/backend/cms-permissions.steps.ts`

Implement step definitions for all scenarios in `cms-permissions.feature`.

### Phase 2: Desktop UI

Deferred to Epic 330 (Desktop Case Management UI) which integrates entity-type access restrictions into the record list and detail views.

### Phase 3: Integration Gate

`bun run test:backend:bdd`

## Files to Create

| File | Purpose |
|------|---------|
| `apps/worker/lib/envelope-recipients.ts` | 3-tier envelope recipient determination logic |
| `packages/test-specs/features/core/cms-permissions.feature` | BDD scenarios |
| `tests/steps/backend/cms-permissions.steps.ts` | Backend step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `apps/worker/middleware/permission-guard.ts` | Add `requireEntityTypeAccess` middleware |
| `apps/worker/durable-objects/case-do.ts` | Refine record list handler with assignment-level filtering |
| `apps/worker/routes/records.ts` | Add access-level determination, envelope recipients route |
| `apps/worker/routes/settings.ts` | Add `POST /api/settings/roles/from-template` route |
| `packages/i18n/locales/en.json` | Add rbac i18n section |
| `packages/i18n/locales/*.json` | Propagate to all 13 locales |

## Testing

### Backend BDD (Phase 1 gate)

`bun run test:backend:bdd` -- 10 scenarios in `cms-permissions.feature`

### Typecheck

`bun run typecheck` -- all new types must compile

## Acceptance Criteria & Test Scenarios

- [ ] Entity types with accessRoles restrict record visibility by role
  -> `packages/test-specs/features/core/cms-permissions.feature: "Entity type with accessRoles restricts visibility"`
- [ ] Empty accessRoles fall back to generic permission checks
  -> `packages/test-specs/features/core/cms-permissions.feature: "Empty accessRoles allows all roles"`
- [ ] cases:read-own returns only records assigned to the caller
  -> `packages/test-specs/features/core/cms-permissions.feature: "Volunteer with cases:read-own sees only assigned records"`
- [ ] cases:read-assigned includes team members' records
  -> `packages/test-specs/features/core/cms-permissions.feature: "Volunteer with cases:read-assigned sees team records"`
- [ ] Envelope recipients correctly follow 3-tier model
  -> `packages/test-specs/features/core/cms-permissions.feature: "Envelope recipients follow 3-tier model"`
- [ ] Entity type editRoles restrict write access
  -> `packages/test-specs/features/core/cms-permissions.feature: "Entity type editRoles restricts write access"`
- [ ] Roles can be created from template suggestions
  -> `packages/test-specs/features/core/cms-permissions.feature: "Create roles from template suggestions"`
- [ ] Invalid permissions in role creation are rejected
  -> `packages/test-specs/features/core/cms-permissions.feature: "Creating roles with invalid permissions fails"`
- [ ] Admin with cases:read-all bypasses assignment filter
  -> `packages/test-specs/features/core/cms-permissions.feature: "Admin with cases:read-all sees all records regardless of assignment"`
- [ ] Volunteers cannot create template roles
  -> `packages/test-specs/features/core/cms-permissions.feature: "Volunteer cannot create template roles"`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/cms-permissions.feature` | New | 10 scenarios for CMS permission enforcement |
| `tests/steps/backend/cms-permissions.steps.ts` | New | Backend step definitions |

## Risk Assessment

- **High risk**: Envelope recipient determination (Task 3) -- this is the core security mechanism. If the logic is wrong, users may get envelopes they should not have (data leak) or miss envelopes they need (broken access). Must be thoroughly tested with multiple role combinations. Mitigated by comprehensive BDD scenarios covering each tier.
- **Medium risk**: Assignment-based filtering (Task 2) -- performance impact of filtering large record sets. Mitigated by the existing `idx:assigned:{pubkey}:{recordId}` prefix scan in CaseDO.
- **Medium risk**: Entity-type access middleware (Task 1) -- adds a SettingsDO fetch on every entity-type-scoped request. Mitigated by caching entity type definitions per request (already in context from earlier middleware).
- **Low risk**: Template role creation (Task 4) -- straightforward CRUD, reuses existing role creation logic.
- **Low risk**: i18n (Task 7) -- additive, no existing string changes.

## Execution

- **Phase 1**: Permission middleware -> Assignment filtering -> Envelope recipients -> Template roles -> Record routes -> i18n -> BDD -> gate
- **Phase 2**: No dedicated UI (Epic 330 integrates these restrictions into the case management UI)
- **Phase 3**: `bun run test:all`
