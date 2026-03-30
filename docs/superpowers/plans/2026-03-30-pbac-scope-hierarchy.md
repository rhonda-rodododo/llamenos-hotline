# PBAC Scope Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the permission system with typed metadata, hierarchical scope resolution, extensible assignment resolvers, the Case Manager default role, and a metadata-driven role editor UI.

**Architecture:** Replace flat `Record<string, string>` permission catalog with typed `PermissionMeta` objects. Add scope hierarchy to `permissionGranted()`. Implement domain-specific assignment resolvers. Update the role editor to render permissions by group/subgroup. All changes are pre-production — clean cut, no backwards compatibility.

**Tech Stack:** TypeScript, Drizzle ORM, Hono, React, shadcn/ui, bun:test, Playwright

**Prerequisite:** Volunteer → User rename plan must be completed first (uses `users:*` domain).

---

### Task 1: Typed Permission Catalog

**Files:**
- Modify: `src/shared/permissions.ts`
- Modify: `src/shared/permissions.test.ts`

- [ ] **Step 1: Write tests for typed catalog**

In `src/shared/permissions.test.ts`, add:

```typescript
import { PERMISSION_CATALOG, PERMISSION_GROUP_LABELS, type Permission, type PermissionMeta } from './permissions'

describe('typed permission catalog', () => {
  test('every permission has label, group, and subgroup', () => {
    for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
      expect(meta.label).toBeTruthy()
      expect(meta.group).toBeTruthy()
      expect(['scope', 'actions', 'tiers']).toContain(meta.subgroup)
    }
  })

  test('every group has a label', () => {
    const groups = new Set(
      Object.values(PERMISSION_CATALOG).map((m) => m.group)
    )
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/shared/permissions.test.ts`
Expected: FAIL — catalog values are strings, not objects.

- [ ] **Step 3: Convert PERMISSION_CATALOG to typed metadata**

Replace the entire `PERMISSION_CATALOG` object in `src/shared/permissions.ts` with the typed version from the spec (Section 1). Add `PermissionMeta` interface and `PERMISSION_GROUP_LABELS`.

Key structural change:
```typescript
// Before
'calls:answer': 'Answer incoming calls',

// After
'calls:answer': {
  label: 'Answer incoming calls',
  group: 'calls',
  subgroup: 'actions',
},
```

Add all new permissions from the spec:
- `contacts:read-own`, `contacts:read-assigned`, `contacts:read-all` (scope)
- `contacts:update-own`, `contacts:update-assigned`, `contacts:update-all` (scope)
- `contacts:envelope-summary`, `contacts:envelope-full` (tiers — renames from `read-summary`/`read-pii`)
- `contacts:update-summary`, `contacts:update-pii` (actions)
- `notes:update-assigned`, `notes:update-all` (scope)
- `conversations:read-own` (scope)
- `files:download-assigned` (scope)
- `shifts:read-assigned` (scope)
- `shifts:read-all` (rename from `shifts:read`)

Remove old permission names:
- `contacts:read-summary` → now `contacts:envelope-summary`
- `contacts:read-pii` → now `contacts:envelope-full`
- `shifts:read` → now `shifts:read-all`

- [ ] **Step 4: Fix getPermissionsByDomain()**

Update the helper to return typed metadata:
```typescript
export function getPermissionsByDomain(): Record<string, { key: Permission; meta: PermissionMeta }[]> {
  const result: Record<string, { key: Permission; meta: PermissionMeta }[]> = {}
  for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
    const domain = key.split(':')[0]
    if (!result[domain]) result[domain] = []
    result[domain].push({ key: key as Permission, meta })
  }
  return result
}
```

- [ ] **Step 5: Fix all compilation errors from catalog change**

Every file that accesses `PERMISSION_CATALOG[key]` and expects a string now gets a `PermissionMeta` object. Find and fix:
- Any place using catalog values as strings → use `.label`
- Import the new types where needed

Run: `bun run typecheck`
Fix all errors.

- [ ] **Step 6: Run tests**

Run: `bun test src/shared/permissions.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/permissions.ts src/shared/permissions.test.ts
git commit -m "feat: convert PERMISSION_CATALOG to typed PermissionMeta with groups"
```

---

### Task 2: Scope Hierarchy Resolution

**Files:**
- Modify: `src/shared/permissions.ts`
- Modify: `src/shared/permissions.test.ts`

- [ ] **Step 1: Write tests for scope hierarchy**

```typescript
describe('scope hierarchy', () => {
  test('read-all subsumes read-assigned', () => {
    expect(permissionGranted(['contacts:read-all'], 'contacts:read-assigned')).toBe(true)
  })

  test('read-all subsumes read-own', () => {
    expect(permissionGranted(['contacts:read-all'], 'contacts:read-own')).toBe(true)
  })

  test('read-assigned subsumes read-own', () => {
    expect(permissionGranted(['contacts:read-assigned'], 'contacts:read-own')).toBe(true)
  })

  test('read-own does NOT subsume read-assigned', () => {
    expect(permissionGranted(['contacts:read-own'], 'contacts:read-assigned')).toBe(false)
  })

  test('read-own does NOT subsume read-all', () => {
    expect(permissionGranted(['contacts:read-own'], 'contacts:read-all')).toBe(false)
  })

  test('update-all subsumes update-own', () => {
    expect(permissionGranted(['notes:update-all'], 'notes:update-own')).toBe(true)
  })

  test('scope hierarchy works across domains independently', () => {
    expect(permissionGranted(['contacts:read-all'], 'notes:read-own')).toBe(false)
  })

  test('wildcard still works', () => {
    expect(permissionGranted(['*'], 'contacts:read-own')).toBe(true)
    expect(permissionGranted(['contacts:*'], 'contacts:read-own')).toBe(true)
  })

  test('non-scoped permissions unaffected', () => {
    expect(permissionGranted(['contacts:create'], 'contacts:create')).toBe(true)
    expect(permissionGranted(['contacts:create'], 'contacts:delete')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/shared/permissions.test.ts`
Expected: FAIL — `read-all` doesn't subsume `read-assigned` yet.

- [ ] **Step 3: Add scope hierarchy to permissionGranted()**

```typescript
const SCOPE_LEVELS: Record<string, number> = {
  own: 0,
  assigned: 1,
  all: 2,
}

export function permissionGranted(grantedPermissions: string[], required: string): boolean {
  if (grantedPermissions.includes('*')) return true
  if (grantedPermissions.includes(required)) return true
  const domain = required.split(':')[0]
  if (grantedPermissions.includes(`${domain}:*`)) return true

  // Scope hierarchy: -all subsumes -assigned subsumes -own
  const scopeMatch = required.match(/^(.+)-(own|assigned|all)$/)
  if (scopeMatch) {
    const [, base, requiredScope] = scopeMatch
    const requiredLevel = SCOPE_LEVELS[requiredScope]
    if (requiredLevel === undefined) return false
    for (const granted of grantedPermissions) {
      const grantedMatch = granted.match(/^(.+)-(own|assigned|all)$/)
      if (grantedMatch && grantedMatch[1] === base) {
        const grantedLevel = SCOPE_LEVELS[grantedMatch[2]]
        if (grantedLevel !== undefined && grantedLevel >= requiredLevel) return true
      }
    }
  }

  return false
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/shared/permissions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/permissions.ts src/shared/permissions.test.ts
git commit -m "feat: add scope hierarchy resolution to permissionGranted()"
```

---

### Task 3: Permission Renames & Default Roles Update

**Files:**
- Modify: `src/shared/permissions.ts` (default roles)
- Create: `drizzle/migrations/XXXX_pbac_permission_renames.sql`
- Modify: All files referencing old permission names

- [ ] **Step 1: SQL migration for stored permission renames**

Generate or manually create a migration:
```sql
UPDATE roles SET permissions = replace(
  replace(
    replace(permissions::text,
      '"contacts:read-summary"', '"contacts:envelope-summary"'),
    '"contacts:read-pii"', '"contacts:envelope-full"'),
  '"shifts:read"', '"shifts:read-all"'
)::jsonb;

ALTER TABLE contacts ADD COLUMN assigned_to TEXT;
CREATE INDEX contacts_assigned_to_idx ON contacts (assigned_to) WHERE assigned_to IS NOT NULL;
```

- [ ] **Step 2: Update DEFAULT_ROLES in permissions.ts**

Add Case Manager role. Update existing roles per spec Section 5:
- Volunteer: add `contacts:read-own`, rename `contacts:read-summary` → `contacts:envelope-summary`
- Hub Admin: already uses `contacts:*` wildcard — no change needed
- Voicemail Reviewer: add `contacts:read-assigned`, rename tier permission

- [ ] **Step 3: Search and replace old permission names in code**

```bash
grep -rn "contacts:read-summary\|contacts:read-pii\|shifts:read['\"]" src/ tests/ --include="*.ts" --include="*.tsx"
```

Replace all hits:
- `contacts:read-summary` → `contacts:envelope-summary`
- `contacts:read-pii` → `contacts:envelope-full`
- `shifts:read` (exact, not `shifts:read-*`) → `shifts:read-all`

- [ ] **Step 4: Run typecheck and tests**

```bash
bun run typecheck
bun test src/shared/permissions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/ drizzle/ src/server/ src/client/ tests/
git commit -m "feat: rename contact tier permissions and add Case Manager role"
```

---

### Task 4: Assignment Resolver Interface & Contacts Implementation

**Files:**
- Create: `src/server/lib/assignment-resolver.ts`
- Create: `src/server/lib/assignment-resolver.test.ts`
- Modify: `src/server/db/schema/contacts.ts` (add `assignedTo` column)
- Modify: `src/server/services/contacts.ts` (add scope filtering)
- Modify: `src/server/routes/contacts.ts` (add scope enforcement)

- [ ] **Step 1: Write the assignment resolver interface and contacts implementation**

Create `src/server/lib/assignment-resolver.ts`:

```typescript
import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { contactCallLinks, contactConversationLinks, contacts } from '../db/schema'
import { callLegs } from '../db/schema/calls'

export interface AssignmentCheck {
  resourceId: string
  userPubkey: string
  hubId: string
}

export interface AssignmentResolver {
  isAssigned(check: AssignmentCheck): Promise<boolean>
  listAssignedIds(userPubkey: string, hubId: string): Promise<string[]>
}

export class ContactsAssignmentResolver implements AssignmentResolver {
  constructor(private db: PostgresJsDatabase) {}

  async isAssigned({ resourceId: contactId, userPubkey, hubId }: AssignmentCheck): Promise<boolean> {
    // Direct personal assignment
    const contact = await this.db.select({ createdBy: contacts.createdBy, assignedTo: contacts.assignedTo })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.hubId, hubId)))
      .limit(1)
    if (contact[0]?.createdBy === userPubkey) return true
    if (contact[0]?.assignedTo === userPubkey) return true

    // Linked via call handling
    const callLink = await this.db.execute(sql`
      SELECT 1 FROM contact_call_links ccl
      JOIN call_legs cl ON cl.call_id = ccl.call_id
      WHERE ccl.contact_id = ${contactId} AND cl.user_pubkey = ${userPubkey}
      LIMIT 1
    `)
    if (callLink.rows.length > 0) return true

    return false
  }

  async listAssignedIds(userPubkey: string, hubId: string): Promise<string[]> {
    const results = await this.db.execute(sql`
      SELECT DISTINCT c.id FROM contacts c
      WHERE c.hub_id = ${hubId} AND c.deleted_at IS NULL
      AND (
        c.created_by = ${userPubkey}
        OR c.assigned_to = ${userPubkey}
        OR c.id IN (
          SELECT ccl.contact_id FROM contact_call_links ccl
          JOIN call_legs cl ON cl.call_id = ccl.call_id
          WHERE cl.user_pubkey = ${userPubkey}
        )
      )
    `)
    return results.rows.map((r) => r.id as string)
  }
}
```

- [ ] **Step 2: Write tests for the assignment resolver**

Create `src/server/lib/assignment-resolver.test.ts` with integration tests covering:
- Direct assignment via `createdBy`
- Direct assignment via `assignedTo`
- Assignment via call link
- Non-assigned returns false
- `listAssignedIds` returns correct set

- [ ] **Step 3: Add scope enforcement to contacts routes**

In `src/server/routes/contacts.ts`, add scope-based filtering to `GET /api/contacts`:

```typescript
// Determine scope level from permissions
function getContactScope(permissions: string[]): 'own' | 'assigned' | 'all' | null {
  if (permissionGranted(permissions, 'contacts:read-all')) return 'all'
  if (permissionGranted(permissions, 'contacts:read-assigned')) return 'assigned'
  if (permissionGranted(permissions, 'contacts:read-own')) return 'own'
  return null
}
```

For `GET /api/contacts`, filter by scope before returning results.
For `PATCH /api/contacts/:id` and `DELETE /api/contacts/:id`, verify scope before allowing the operation.

- [ ] **Step 4: Add wildcard types from spec Section 7**

Add to `src/shared/permissions.ts`:
```typescript
export type PermissionDomain = Permission extends `${infer D}:${string}` ? D : never
export type WildcardPermission = `${PermissionDomain}:*` | '*'
export type PermissionOrWildcard = Permission | WildcardPermission
```

These ensure roles can type-safely reference wildcards while route guards use concrete `Permission` values.

- [ ] **Step 5: Document resolver semantics for other domains**

The contacts resolver is the only one with active scope enforcement now. Add a JSDoc comment in `assignment-resolver.ts` documenting the planned resolver semantics for the other 5 domains (from spec Section 3):

```typescript
/**
 * Domain-specific "assigned" definitions (implement resolvers as scope enforcement is added):
 * - notes: authorPubkey = user OR note linked to a call the user handled
 * - conversations: assignedTo = user
 * - reports: assignedTo = user OR submittedBy = user
 * - files: file attached to a resource the user is assigned to
 * - shifts: user is listed in the shift's userPubkeys array
 */
```

These resolvers will be implemented when their respective routes add scope enforcement.

- [ ] **Step 6: Update contacts service to read/write assignedTo**

In `src/server/services/contacts.ts`:
- Accept `assignedTo` in `createContact()` and `updateContact()` methods
- Include `assignedTo` in `listContacts()` response
- Add `assignedTo` query filter to list endpoint

In `src/server/routes/contacts.ts`:
- Accept `assignedTo` in POST and PATCH bodies
- Add `assignedTo` filter parameter to GET

- [ ] **Step 7: Run tests**

```bash
bun test src/server/lib/assignment-resolver.test.ts
bun run test:api
```

- [ ] **Step 8: Commit**

```bash
git add src/server/lib/assignment-resolver.ts src/server/lib/assignment-resolver.test.ts src/server/routes/contacts.ts src/server/services/contacts.ts src/server/db/schema/contacts.ts src/shared/permissions.ts
git commit -m "feat: add assignment resolver, scope enforcement, wildcard types, and assignedTo field"
```

---

### Task 5: Role Editor UI — Metadata-Driven Rendering

**Files:**
- Modify: The role editor component (find via `grep -rn "role.*editor\|RoleEditor\|role.*form" src/client/`)
- Modify: Associated settings route

- [ ] **Step 1: Identify the role editor component**

```bash
grep -rn "permissions.*checkbox\|role.*edit\|RoleForm\|manage-roles" src/client/ --include="*.tsx" -l
```

Read the existing role editor to understand current rendering approach.

- [ ] **Step 2: Refactor to use getPermissionsByDomain()**

Import `getPermissionsByDomain()` and `PERMISSION_GROUP_LABELS`. Replace any hardcoded permission grouping with the metadata-driven approach:

```tsx
import { getPermissionsByDomain, PERMISSION_GROUP_LABELS, type PermissionMeta } from '@shared/permissions'

function RolePermissionEditor({ permissions, onChange }: Props) {
  const groups = getPermissionsByDomain()

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([domain, perms]) => (
        <SettingsSection key={domain} title={PERMISSION_GROUP_LABELS[domain] ?? domain}>
          <ScopeGroup
            permissions={perms.filter((p) => p.meta.subgroup === 'scope')}
            selected={permissions}
            onChange={onChange}
          />
          <TierGroup
            permissions={perms.filter((p) => p.meta.subgroup === 'tiers')}
            selected={permissions}
            onChange={onChange}
          />
          <ActionGroup
            permissions={perms.filter((p) => p.meta.subgroup === 'actions')}
            selected={permissions}
            onChange={onChange}
          />
        </SettingsSection>
      ))}
    </div>
  )
}
```

- Scope permissions render as radio buttons (mutually exclusive per action prefix)
- Tier permissions render as checkboxes (additive)
- Action permissions render as checkboxes (additive)

- [ ] **Step 3: Write E2E test for role editor**

Add to `tests/ui/roles.spec.ts`:
- Verify scope radio buttons are mutually exclusive
- Verify tier checkboxes are additive
- Verify action checkboxes are additive
- Verify creating a custom role with specific permissions

- [ ] **Step 4: Run tests**

```bash
bun run typecheck && bun run build
bun run test:e2e -- tests/ui/roles.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/client/ tests/ui/roles.spec.ts
git commit -m "feat: metadata-driven role editor with scope/tier/action groups"
```

---

### Task 6: Test Coverage Across All Three Suites

**Files:**
- Modify: `src/shared/permissions.test.ts` (unit tests — extended)
- Modify: `tests/api/contacts-permissions.spec.ts` (API tests — scope enforcement)
- Create: `tests/api/pbac-scope.spec.ts` (API tests — scope hierarchy)
- Modify: `tests/ui/roles.spec.ts` (UI E2E — role editor)

- [ ] **Step 1: Unit tests (bun:test)**

Verify these are covered in `src/shared/permissions.test.ts`:
- Typed catalog structure validation (every permission has label/group/subgroup)
- Every group has a PERMISSION_GROUP_LABELS entry
- Scope naming convention (all scope permissions end with `-own`/`-assigned`/`-all`)
- Scope hierarchy: `-all` subsumes `-assigned` subsumes `-own`
- Scope hierarchy cross-domain isolation
- Wildcards still work with scope hierarchy
- Non-scoped permissions unaffected
- `getPermissionsByDomain()` returns typed metadata
- Case Manager role has correct permissions
- Default role permission completeness

Run: `bun test src/shared/permissions.test.ts`

- [ ] **Step 2: API tests (Playwright, no browser)**

Create `tests/api/pbac-scope.spec.ts`:
- User with `contacts:read-own` can only fetch contacts they created
- User with `contacts:read-assigned` can fetch contacts assigned to them (via `assignedTo`)
- User with `contacts:read-all` can fetch all contacts in hub
- User with `contacts:update-own` can only PATCH contacts they created
- User with `contacts:update-own` gets 403 on PATCH for others' contacts
- Scope subsumption: user with `contacts:read-all` can access the `contacts:read-own` check
- Case Manager with `contacts:read-assigned` + `contacts:envelope-full` sees full PII for assigned contacts
- Volunteer with `contacts:read-own` + `contacts:envelope-summary` sees only display names for own contacts

Update `tests/api/contacts-permissions.spec.ts`:
- Replace all `contacts:read-summary` → `contacts:envelope-summary`
- Replace all `contacts:read-pii` → `contacts:envelope-full`
- Add scope + tier combination tests

Run: `bunx playwright test tests/api/pbac-scope.spec.ts tests/api/contacts-permissions.spec.ts`

- [ ] **Step 3: UI E2E tests (Playwright, Chromium)**

Update `tests/ui/roles.spec.ts`:
- Scope radio buttons are mutually exclusive (select `-all`, verify `-own` and `-assigned` deselected)
- Tier checkboxes are additive (can select both `envelope-summary` and `envelope-full`)
- Action checkboxes are independent
- Create custom role with specific scope/tier/action combination
- Verify Case Manager role appears in role list with correct description
- Permission groups render with correct PERMISSION_GROUP_LABELS

Run: `bunx playwright test tests/ui/roles.spec.ts`

- [ ] **Step 4: Full test suite verification**

```bash
bun run typecheck && bun run build && bun run lint
bun run test:unit
bun run test:api
bun run test:e2e
```

All must pass.

- [ ] **Step 5: Verify no old permission names remain**

```bash
grep -rn "contacts:read-summary\|contacts:read-pii" src/ tests/ --include="*.ts" --include="*.tsx"
```

Expected: Zero hits.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test: comprehensive PBAC test coverage across unit, API, and UI suites"
```
