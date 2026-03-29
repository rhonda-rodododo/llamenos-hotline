> **Status: DRAFT — Needs Review.** Verify against codebase, check third-party docs, and review with user before writing implementation plan. May need revision after other specs land.

# User Identity & PBAC Redesign — Design Spec

**Goal:** Rename `volunteer` → `user` as the identity concept, upgrade the permission system with strongly-typed hierarchical scoping, and make the role editor admin-friendly — establishing the foundation for contact directory enhancements, case management workflows, and future role expansion.

**Prerequisite for:** All contact directory v2 specs (tag management, bulk operations, contact profile actions, call-to-contact workflow, post-call data entry, import/export).

---

## 1. Identity Rename: volunteer → user

"Volunteer" implies a specific role. "User" is the identity concept — anyone who authenticates and has roles. The word "volunteer" becomes just a default role name.

### Database

| Current | New | Migration |
|---------|-----|-----------|
| `volunteers` table | `users` | `ALTER TABLE volunteers RENAME TO users` |
| `call_legs.volunteerPubkey` | `call_legs.userPubkey` | Column rename |
| `active_calls.assignedPubkey` | (no change — already generic) | — |
| `shift_schedules.volunteerPubkeys` | `shift_schedules.userPubkeys` | Column rename (JSONB, no data change) |
| `ring_groups.volunteerPubkeys` | `ring_groups.userPubkeys` | Column rename |
| `fallback_group.volunteerPubkeys` | `fallback_group.userPubkeys` | Column rename |
| `webauthn_settings.requireForVolunteers` | `webauthn_settings.requireForUsers` | Column rename |

All column renames are `ALTER TABLE ... RENAME COLUMN` — no data migration needed.

### Server

| Current | New |
|---------|-----|
| `src/server/routes/volunteers.ts` | `src/server/routes/users.ts` |
| `src/server/lib/volunteer-projector.ts` | `src/server/lib/user-projector.ts` |
| `/api/volunteers` endpoints | `/api/users` endpoints |
| `IdentityService.getVolunteer()` | `IdentityService.getUser()` |
| `IdentityService.listVolunteers()` | `IdentityService.listUsers()` |
| `IdentityService.createVolunteer()` | `IdentityService.createUser()` |
| All `volunteerPubkey` references in services | `userPubkey` |

### Client

| Current | New |
|---------|-----|
| `src/client/routes/volunteers.tsx` | `src/client/routes/users.tsx` |
| `src/client/routes/volunteers_.$pubkey.tsx` | `src/client/routes/users.$pubkey.tsx` |
| `src/client/components/volunteer-multi-select.tsx` | `src/client/components/user-multi-select.tsx` |
| `src/client/components/dashboard/volunteer-stats-table.tsx` | `src/client/components/dashboard/user-stats-table.tsx` |
| `/volunteers` nav link | `/users` nav link |
| All `volunteer` i18n keys across 13 locales | `user`/`users` keys |

### What stays

- `role-volunteer` keeps its ID and name — "Volunteer" is a valid role, just not the identity concept
- The concept of "on break", "shift assignment", "call preference" stays on the `users` table — these are user attributes, not volunteer-specific

---

## 2. Strongly-Typed Permission System

### Permission catalog as single source of truth

```typescript
export const PERMISSION_CATALOG = {
  'users:read': {
    label: 'View user profiles',
    group: 'users',
    subgroup: 'actions',
  },
  'contacts:read-own': {
    label: 'View contacts they created or handled',
    group: 'contacts',
    subgroup: 'scope',
  },
  // ...
} as const satisfies Record<string, PermissionMeta>

interface PermissionMeta {
  label: string
  group: string
  subgroup: 'scope' | 'actions' | 'tiers'
}

export type Permission = keyof typeof PERMISSION_CATALOG
```

### Type enforcement at all call sites

```typescript
// Route guards — only accept valid Permission values
export function requirePermission(...required: Permission[]): MiddlewareHandler

// Inline checks — required param is typed
export function checkPermission(granted: string[], required: Permission): boolean

// Core resolver — required is typed, granted stays string[] (from DB)
export function permissionGranted(granted: string[], required: Permission): boolean
```

### Wildcard types

```typescript
export type PermissionDomain = Permission extends `${infer D}:${string}` ? D : never
export type WildcardPermission = `${PermissionDomain}:*` | '*'
export type PermissionOrWildcard = Permission | WildcardPermission
```

Roles can contain wildcards. Route guards and application code reference concrete `Permission` values only.

### Adding new permissions

Adding a permission is one line in `PERMISSION_CATALOG`. TypeScript immediately:
- Makes it available as a `Permission` union member
- Provides IDE autocomplete
- Compile-errors any reference to non-existent permissions

---

## 3. Hierarchical Scope Resolution

### Scope hierarchy

`:all` ⊃ `:assigned` ⊃ `:own`

Having `contacts:read-all` automatically grants `contacts:read-assigned` and `contacts:read-own`. No need to list all three in a role.

### Implementation

```typescript
const SCOPE_HIERARCHY: Record<string, string[]> = {
  all: ['assigned', 'own'],
  assigned: ['own'],
  own: [],
}
```

In `permissionGranted`, after checking exact match and wildcards:
1. Extract the scope suffix from the required permission (e.g., `contacts:read-own` → scope `own`)
2. For each granted permission in the same domain+action, check if its scope subsumes the required scope
3. `contacts:read-all` has scope `all`, which subsumes `own` → granted

### Scope vs tier permissions

**Scope** controls *whose* data you access:
- `contacts:read-own` — contacts you created or are linked to
- `contacts:read-assigned` — contacts explicitly assigned to you (caseload), OR linked to calls/conversations you handled. The service layer defines "assigned" for the contacts domain as: `createdBy = currentUser OR contact linked to a call/conversation where currentUser was the handler OR explicitly assigned via a future assignment mechanism`.
- `contacts:read-all` — all contacts in the hub

**Tiers** control *what data* you can decrypt (which envelope group you're a recipient of):
- `contacts:envelope-summary` — Tier 1 envelopes (display name/alias, tags, risk level, notes, languages)
- `contacts:envelope-full` — Tier 2 envelopes (legal name, phone, channels, address, DOB, identifiers, relationships)

These are orthogonal. A volunteer with `contacts:read-own` + `contacts:envelope-summary` sees display names for their own contacts. A case manager with `contacts:read-assigned` + `contacts:envelope-full` sees full PII for their caseload.

### Unscoped permissions

Permissions without `-own`/`-assigned`/`-all` suffixes (like `contacts:create`, `contacts:delete`, `contacts:link`) are unscoped — exact match or wildcard only.

---

## 4. Updated Permission Catalog

### Users domain (renamed from volunteers)

```
users:read                    View user profiles
users:create                  Create new users
users:update                  Update user profiles
users:delete                  Deactivate/delete users
users:manage-roles            Assign/change user roles
```

### Contacts domain (expanded)

```
# Scope (radio — mutually exclusive)
contacts:read-own             View contacts they created or handled
contacts:read-assigned        View contacts assigned to them
contacts:read-all             View all contacts

# Tiers (checkbox — what data)
contacts:envelope-summary     Access summary envelopes (alias, tags, notes)
contacts:envelope-full        Access full envelopes (legal name, phone, channels, identifiers)

# Actions (checkbox — what they can do)
contacts:create               Create new contacts and relationships
contacts:update-own           Edit contacts they created
contacts:update-assigned      Edit contacts assigned to them
contacts:update-all           Edit any contact
contacts:delete               Delete contacts
contacts:link                 Link/unlink calls and conversations to contacts
```

### Other domains (unchanged structure, volunteers → users)

All existing domains (calls, notes, reports, conversations, shifts, bans, invites, settings, audit, blasts, files, voicemail, gdpr, system) keep their current permissions with no structural changes. The `volunteers:*` domain becomes `users:*`.

---

## 5. Custom Field Visibility

The existing `showInVolunteerView` boolean on `customFieldDefinitions` becomes a permission-based visibility control:

```typescript
// Old
showInVolunteerView: boolean

// New
visibleTo: Permission  // e.g., 'contacts:envelope-summary' or 'contacts:envelope-full'
```

Default: `contacts:envelope-summary` (visible to anyone who can see the contact at all).

Admins set this per custom field in the field editor — choosing which tier the field belongs to. The UI shows the human-readable label, not the permission string.

---

## 6. Admin-Friendly Role Editor

The role editor UI presents permissions as **plain English capability statements** grouped by category.

### Input types by subgroup

- **`scope`** → radio buttons (mutually exclusive — pick one level)
- **`tiers`** → checkboxes (additive — summary, full, or both)
- **`actions`** → checkboxes (additive — each capability independent)

### Example: Contacts section in role editor

**Who can they see?**
- ○ Only contacts they created or handled calls for
- ○ Contacts assigned to them (their caseload)
- ○ All contacts in this hub

**What details can they access?**
- ☑ Display name, tags, risk level, notes
- ☐ Full details (legal name, phone, address, channels)

**What can they do?**
- ☑ Create new contacts
- ☐ Edit contacts they can see
- ☐ Delete contacts
- ☐ Link calls/conversations to contacts

The permission strings map 1:1 to these UI choices. The `label` and `subgroup` fields in `PERMISSION_CATALOG` drive the rendering — no hardcoded UI logic per permission.

### Group labels

Each `group` in the catalog gets a human-readable group name:

```typescript
export const PERMISSION_GROUP_LABELS: Record<string, string> = {
  users: 'User Management',
  contacts: 'Contact Directory',
  calls: 'Calls',
  notes: 'Notes',
  // ...
}
```

---

## 7. Updated Default Roles

| Role | Identity | Scope | Tiers | Key Capabilities |
|------|----------|-------|-------|------------------|
| **Super Admin** | system | `*` | all | Everything |
| **Hub Admin** | per-hub | `users:*`, `contacts:*` | all | Full control within hub |
| **Case Manager** (new) | per-hub | `contacts:read-all`, `contacts:update-assigned`, `contacts:envelope-full` | summary + full | Sees all contacts, edits caseload, full detail access |
| **Volunteer** | per-hub | `contacts:read-own`, `contacts:create`, `contacts:envelope-summary` | summary | Creates contacts, sees own, display names only |
| **Reporter** | per-hub | `contacts:read-own`, `contacts:envelope-summary` | summary | Sees contacts referenced in own reports |
| **Voicemail Reviewer** | per-hub | `contacts:read-assigned`, `contacts:envelope-summary` | summary | Reviews contacts linked to voicemails they triage |

The **Case Manager** role is new — fills the gap between volunteer and admin for jail support / ICE rapid response workflows (triages notes into structured contact records, manages support contact networks, coordinates early releases).

---

## 8. Migration Strategy

Since this is pre-production (no live data to migrate):

1. **Database migration**: Single SQL migration with table rename + column renames
2. **Code rename**: Mechanical find-and-replace across ~109 files, then fix compilation errors
3. **Permission catalog**: Replace flat `string` descriptions with `PermissionMeta` objects, add new permissions
4. **Role editor UI**: Update to use grouped rendering with radio/checkbox by subgroup
5. **Tests**: Update all references, add permission hierarchy tests

No backwards compatibility shims. No feature flags. Clean cut.

---

## 9. Scope — What This Spec Does NOT Cover

- Contact-specific features (messaging, bulk ops, import/export) — separate specs
- New route guards for contact scope enforcement — implemented when the contact service is updated
- Custom field tier assignment UI — implemented with the custom field editor update
- Permission audit logging — future work
