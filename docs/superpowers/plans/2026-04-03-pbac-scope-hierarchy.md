# PBAC Scope Hierarchy & Typed Permission Catalog Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Implement hierarchical permission scoping (`:all` ⊃ `:assigned` ⊃ `:own`), typed permission metadata for the role editor UI, and the Case Manager default role.

**Architecture:** Extends the existing PBAC system (Epic 60) with scope hierarchy resolution, a typed permission catalog with metadata, and pluggable AssignmentResolver interface.

**Depends on:** Volunteer → User rename (Task 1 plan above)

---

### Task 1: Permission Catalog with Metadata

**Files:**
- Modify: `src/shared/permissions.ts`

- [ ] Add `PermissionMeta` interface:
```typescript
interface PermissionMeta {
  id: string           // 'contacts:read-all'
  label: string        // 'Read all contacts'
  group: string        // 'Contacts'
  subgroup?: string    // 'Read Access'
  scope?: 'own' | 'assigned' | 'all'  // for scope-aware permissions
  tier?: string        // for contact permissions: 'envelope-summary' | 'envelope-full'
}
```
- [ ] Create `PERMISSION_CATALOG: PermissionMeta[]` with all permissions and metadata
- [ ] Export catalog for use by role editor UI
- [ ] `bun run typecheck`

### Task 2: Scope Hierarchy Resolution

**Files:**
- Modify: `src/shared/permissions.ts`

- [ ] Implement scope hierarchy in `permissionGranted()`:
  - Having `contacts:read-all` automatically grants `contacts:read-assigned` and `contacts:read-own`
  - Having `contacts:read-assigned` automatically grants `contacts:read-own`
  - Scope hierarchy: `all` ⊃ `assigned` ⊃ `own`
- [ ] Add helper: `getScopeLevel(permission: string): 'own' | 'assigned' | 'all' | null`
- [ ] Update `resolvePermissions()` to handle hierarchical expansion
- [ ] Write unit tests for scope hierarchy
- [ ] `bun run typecheck && bun test src/shared/permissions.test.ts`

### Task 3: Permission String Renames

**Files:**
- Modify: `src/shared/permissions.ts`, all routes/components that check renamed permissions

- [ ] Rename contact permissions:
  - `contacts:read-summary` → `contacts:envelope-summary`
  - `contacts:read-pii` → `contacts:envelope-full`
- [ ] Add new scope permissions:
  - `contacts:read-own`, `contacts:read-assigned`, `contacts:read-all`
  - `contacts:update-own`, `contacts:update-assigned`, `contacts:update-all`
  - `notes:update-assigned`, `notes:update-all`
- [ ] Update all check callsites (grep + replace)
- [ ] DB migration to rename stored permission strings in roles table
- [ ] `bun run typecheck`

### Task 4: AssignmentResolver Interface

**Files:**
- Create: `src/server/lib/assignment-resolver.ts`

- [ ] Define interface:
```typescript
interface AssignmentResolver {
  isAssignedTo(resourceId: string, userPubkey: string): Promise<boolean>
}
```
- [ ] Implement `ContactAssignmentResolver` — checks `contacts.assignedTo`
- [ ] Implement `ConversationAssignmentResolver` — checks `conversations.assignedTo`
- [ ] Wire into permission middleware for scope-aware checks
- [ ] `bun run typecheck`

### Task 5: Case Manager Default Role

**Files:**
- Modify: `src/shared/permissions.ts` (DEFAULT_ROLES)
- Modify: DB seed/migration

- [ ] Add Case Manager role with permissions:
  - `contacts:read-assigned`, `contacts:update-assigned`
  - `contacts:envelope-full`
  - `notes:read-assigned`, `notes:update-assigned`
  - `contacts:triage` (for intake queue)
  - `conversations:read-assigned`, `conversations:reply`
- [ ] Add to DEFAULT_ROLES array
- [ ] Add to DB migration (seed in roles table)
- [ ] `bun run typecheck`

### Task 6: Role Editor UI (Metadata-Driven)

**Files:**
- Modify: `src/client/components/admin-settings/roles-section.tsx`

- [ ] Replace hardcoded permission grouping with catalog-driven rendering
- [ ] Group permissions by `meta.group` and `meta.subgroup`
- [ ] Show scope toggles (own/assigned/all) for scope-aware permissions
- [ ] `bun run typecheck && bun run build`

### Task 7: Tests & Verification

- [ ] Update all permission-related tests
- [ ] Run full suite: `bun run test:unit && bun run test:api`
- [ ] Grep for old permission strings: `grep -rn 'read-summary\|read-pii' src/`
- [ ] Verify no hardcoded permission grouping remains in UI
- [ ] `bun run typecheck && bun run build && bun run test:unit`
- [ ] Commit
