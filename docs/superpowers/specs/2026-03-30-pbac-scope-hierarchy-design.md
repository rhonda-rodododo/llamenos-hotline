# PBAC Scope Hierarchy & Typed Permission Catalog — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Scope:** Upgrade the permission system with typed metadata, hierarchical scope resolution, normalized domain permissions, an extensible assignment resolver, a Case Manager default role, and a metadata-driven role editor UI.
**Depends on:** Volunteer → User rename spec (2026-03-29)

---

## Rationale

The current permission system is a flat `Record<string, string>` catalog with basic exact-match + wildcard resolution. This works but has gaps:

1. **No scope hierarchy** — having `notes:read-all` doesn't automatically grant `notes:read-own`. Roles must list every level explicitly, which is error-prone and verbose.
2. **No typed metadata** — the role editor UI can't auto-render grouped permissions with appropriate input types (radio for scope, checkbox for actions). Grouping is hardcoded.
3. **Inconsistent scope naming** — some domains use `-own`/`-assigned`/`-all`, others use `-own`/implicit-all, others have no scope at all.
4. **No Case Manager role** — there's a gap between Volunteer (sees own data) and Hub Admin (sees everything) that jail support, mass defense, and ICE rapid response workflows need filled.
5. **Contact permissions conflate scope and tier** — `contacts:read-summary` mixes "what data" (summary tier) with "can read" (scope). These are orthogonal: scope = whose data, tier = what fields you can decrypt.

The threat model demands fine-grained permissions: at Standing Rock scale (800+ cases, multiple jail support / legal / mass defense teams), different roles need precisely scoped access to contacts, notes, conversations, and reports.

---

## 1. Typed Permission Catalog

### Structure

Replace string values with typed metadata objects:

```typescript
interface PermissionMeta {
  label: string
  group: string
  subgroup: 'scope' | 'actions' | 'tiers'
}

export const PERMISSION_CATALOG = {
  // --- Contacts: Scope ---
  'contacts:read-own': {
    label: 'View contacts they created or handled',
    group: 'contacts',
    subgroup: 'scope',
  },
  'contacts:read-assigned': {
    label: 'View contacts assigned to them',
    group: 'contacts',
    subgroup: 'scope',
  },
  'contacts:read-all': {
    label: 'View all contacts in this hub',
    group: 'contacts',
    subgroup: 'scope',
  },
  'contacts:update-own': {
    label: 'Edit contacts they created',
    group: 'contacts',
    subgroup: 'scope',
  },
  'contacts:update-assigned': {
    label: 'Edit contacts assigned to them',
    group: 'contacts',
    subgroup: 'scope',
  },
  'contacts:update-all': {
    label: 'Edit any contact',
    group: 'contacts',
    subgroup: 'scope',
  },

  // --- Contacts: Tiers ---
  'contacts:envelope-summary': {
    label: 'Access display name, tags, risk level, notes',
    group: 'contacts',
    subgroup: 'tiers',
  },
  'contacts:envelope-full': {
    label: 'Access full details (legal name, phone, address, channels)',
    group: 'contacts',
    subgroup: 'tiers',
  },

  // --- Contacts: Actions ---
  'contacts:create': {
    label: 'Create new contacts and relationships',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:update-summary': {
    label: 'Edit contact summary fields (display name, notes, tags)',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:update-pii': {
    label: 'Edit contact PII fields (legal name, phone, address)',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:delete': {
    label: 'Delete contacts',
    group: 'contacts',
    subgroup: 'actions',
  },
  'contacts:link': {
    label: 'Link/unlink calls and conversations to contacts',
    group: 'contacts',
    subgroup: 'actions',
  },

  // --- Notes: Scope ---
  'notes:read-own': {
    label: 'Read own notes',
    group: 'notes',
    subgroup: 'scope',
  },
  'notes:read-assigned': {
    label: 'Read notes from assigned users',
    group: 'notes',
    subgroup: 'scope',
  },
  'notes:read-all': {
    label: 'Read all notes',
    group: 'notes',
    subgroup: 'scope',
  },
  'notes:update-own': {
    label: 'Update own notes',
    group: 'notes',
    subgroup: 'scope',
  },
  'notes:update-assigned': {
    label: 'Update notes from assigned users',
    group: 'notes',
    subgroup: 'scope',
  },
  'notes:update-all': {
    label: 'Update any note',
    group: 'notes',
    subgroup: 'scope',
  },

  // --- Notes: Actions ---
  'notes:create': {
    label: 'Create call notes',
    group: 'notes',
    subgroup: 'actions',
  },
  'notes:reply': {
    label: 'Reply to notes',
    group: 'notes',
    subgroup: 'actions',
  },

  // --- Calls: Actions ---
  'calls:answer': {
    label: 'Answer incoming calls',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-active': {
    label: 'See active calls (caller info redacted)',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-active-full': {
    label: 'See active calls with full caller info',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-history': {
    label: 'View call history',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-presence': {
    label: 'View user presence',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:read-recording': {
    label: 'Listen to call recordings',
    group: 'calls',
    subgroup: 'actions',
  },
  'calls:debug': {
    label: 'Debug call state',
    group: 'calls',
    subgroup: 'actions',
  },

  // --- Reports: Scope ---
  'reports:read-own': {
    label: 'Read own reports',
    group: 'reports',
    subgroup: 'scope',
  },
  'reports:read-assigned': {
    label: 'Read assigned reports',
    group: 'reports',
    subgroup: 'scope',
  },
  'reports:read-all': {
    label: 'Read all reports',
    group: 'reports',
    subgroup: 'scope',
  },

  // --- Reports: Actions ---
  'reports:create': {
    label: 'Submit reports',
    group: 'reports',
    subgroup: 'actions',
  },
  'reports:assign': {
    label: 'Assign reports to reviewers',
    group: 'reports',
    subgroup: 'actions',
  },
  'reports:update': {
    label: 'Update report status',
    group: 'reports',
    subgroup: 'actions',
  },
  'reports:send-message-own': {
    label: 'Send messages in own reports',
    group: 'reports',
    subgroup: 'actions',
  },
  'reports:send-message': {
    label: 'Send messages in any report',
    group: 'reports',
    subgroup: 'actions',
  },

  // --- Conversations: Scope ---
  'conversations:read-own': {
    label: 'Read conversations they initiated',
    group: 'conversations',
    subgroup: 'scope',
  },
  'conversations:read-assigned': {
    label: 'Read assigned and waiting conversations',
    group: 'conversations',
    subgroup: 'scope',
  },
  'conversations:read-all': {
    label: 'Read all conversations',
    group: 'conversations',
    subgroup: 'scope',
  },

  // --- Conversations: Actions ---
  'conversations:claim': {
    label: 'Claim a waiting conversation',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-sms': {
    label: 'Claim SMS conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-whatsapp': {
    label: 'Claim WhatsApp conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-signal': {
    label: 'Claim Signal conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-rcs': {
    label: 'Claim RCS conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-web': {
    label: 'Claim web conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:claim-any': {
    label: 'Claim any channel (bypass restrictions)',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:send': {
    label: 'Send messages in assigned conversations',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:send-any': {
    label: 'Send messages in any conversation',
    group: 'conversations',
    subgroup: 'actions',
  },
  'conversations:update': {
    label: 'Reassign/close/reopen conversations',
    group: 'conversations',
    subgroup: 'actions',
  },

  // --- Users: Actions ---
  'users:read': {
    label: 'List/view user profiles',
    group: 'users',
    subgroup: 'actions',
  },
  'users:create': {
    label: 'Create new users',
    group: 'users',
    subgroup: 'actions',
  },
  'users:update': {
    label: 'Update user profiles',
    group: 'users',
    subgroup: 'actions',
  },
  'users:delete': {
    label: 'Deactivate/delete users',
    group: 'users',
    subgroup: 'actions',
  },
  'users:manage-roles': {
    label: 'Assign/change user roles',
    group: 'users',
    subgroup: 'actions',
  },

  // --- Shifts: Scope ---
  'shifts:read-own': {
    label: 'Check own shift status',
    group: 'shifts',
    subgroup: 'scope',
  },
  'shifts:read-assigned': {
    label: 'View shifts they are scheduled on',
    group: 'shifts',
    subgroup: 'scope',
  },
  'shifts:read-all': {
    label: 'View all shifts',
    group: 'shifts',
    subgroup: 'scope',
  },

  // --- Shifts: Actions ---
  'shifts:create': {
    label: 'Create shifts',
    group: 'shifts',
    subgroup: 'actions',
  },
  'shifts:update': {
    label: 'Modify shifts',
    group: 'shifts',
    subgroup: 'actions',
  },
  'shifts:delete': {
    label: 'Delete shifts',
    group: 'shifts',
    subgroup: 'actions',
  },
  'shifts:manage-fallback': {
    label: 'Manage fallback ring group',
    group: 'shifts',
    subgroup: 'actions',
  },

  // --- Files: Scope ---
  'files:download-own': {
    label: 'Download own/authorized files',
    group: 'files',
    subgroup: 'scope',
  },
  'files:download-assigned': {
    label: 'Download files from assigned resources',
    group: 'files',
    subgroup: 'scope',
  },
  'files:download-all': {
    label: 'Download any file',
    group: 'files',
    subgroup: 'scope',
  },

  // --- Files: Actions ---
  'files:upload': {
    label: 'Upload files',
    group: 'files',
    subgroup: 'actions',
  },
  'files:share': {
    label: 'Re-encrypt/share files with others',
    group: 'files',
    subgroup: 'actions',
  },

  // --- Bans: Actions ---
  'bans:report': {
    label: 'Report/flag a number',
    group: 'bans',
    subgroup: 'actions',
  },
  'bans:read': {
    label: 'View ban list',
    group: 'bans',
    subgroup: 'actions',
  },
  'bans:create': {
    label: 'Ban numbers',
    group: 'bans',
    subgroup: 'actions',
  },
  'bans:bulk-create': {
    label: 'Bulk ban import',
    group: 'bans',
    subgroup: 'actions',
  },
  'bans:delete': {
    label: 'Remove bans',
    group: 'bans',
    subgroup: 'actions',
  },

  // --- Invites: Actions ---
  'invites:read': {
    label: 'View pending invites',
    group: 'invites',
    subgroup: 'actions',
  },
  'invites:create': {
    label: 'Create invite codes',
    group: 'invites',
    subgroup: 'actions',
  },
  'invites:revoke': {
    label: 'Revoke invite codes',
    group: 'invites',
    subgroup: 'actions',
  },

  // --- Settings: Actions ---
  'settings:read': {
    label: 'View settings',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage': {
    label: 'Modify all settings',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-telephony': {
    label: 'Modify telephony provider',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-messaging': {
    label: 'Modify messaging channels',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-spam': {
    label: 'Modify spam settings',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-ivr': {
    label: 'Modify IVR/language settings',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-fields': {
    label: 'Modify custom fields',
    group: 'settings',
    subgroup: 'actions',
  },
  'settings:manage-transcription': {
    label: 'Modify transcription settings',
    group: 'settings',
    subgroup: 'actions',
  },

  // --- Audit: Actions ---
  'audit:read': {
    label: 'View audit log',
    group: 'audit',
    subgroup: 'actions',
  },

  // --- Blasts: Actions ---
  'blasts:read': {
    label: 'View blast history',
    group: 'blasts',
    subgroup: 'actions',
  },
  'blasts:send': {
    label: 'Send blasts',
    group: 'blasts',
    subgroup: 'actions',
  },
  'blasts:manage': {
    label: 'Manage subscriber lists and templates',
    group: 'blasts',
    subgroup: 'actions',
  },
  'blasts:schedule': {
    label: 'Schedule future blasts',
    group: 'blasts',
    subgroup: 'actions',
  },

  // --- Voicemail: Actions ---
  'voicemail:listen': {
    label: 'Play/decrypt voicemail audio',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:read': {
    label: 'View voicemail metadata in call history',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:notify': {
    label: 'Receive notifications for new voicemails',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:delete': {
    label: 'Delete voicemail audio and transcript',
    group: 'voicemail',
    subgroup: 'actions',
  },
  'voicemail:manage': {
    label: 'Configure voicemail settings',
    group: 'voicemail',
    subgroup: 'actions',
  },

  // --- GDPR: Actions ---
  'gdpr:consent': {
    label: 'Record and check own data processing consent',
    group: 'gdpr',
    subgroup: 'actions',
  },
  'gdpr:export': {
    label: 'Export own data (GDPR data portability)',
    group: 'gdpr',
    subgroup: 'actions',
  },
  'gdpr:erase-self': {
    label: 'Request erasure of own account',
    group: 'gdpr',
    subgroup: 'actions',
  },
  'gdpr:admin': {
    label: 'Admin-level GDPR operations (export/erase any user)',
    group: 'gdpr',
    subgroup: 'actions',
  },

  // --- System: Actions ---
  'system:manage-roles': {
    label: 'Create/edit/delete custom roles',
    group: 'system',
    subgroup: 'actions',
  },
  'system:manage-hubs': {
    label: 'Create/manage hubs',
    group: 'system',
    subgroup: 'actions',
  },
  'system:manage-instance': {
    label: 'Instance-level settings',
    group: 'system',
    subgroup: 'actions',
  },
} as const satisfies Record<string, PermissionMeta>

export type Permission = keyof typeof PERMISSION_CATALOG
```

### Group labels

```typescript
export const PERMISSION_GROUP_LABELS: Record<string, string> = {
  contacts: 'Contact Directory',
  notes: 'Notes',
  calls: 'Calls',
  reports: 'Reports',
  conversations: 'Conversations',
  users: 'User Management',
  shifts: 'Shifts',
  files: 'Files',
  bans: 'Ban List',
  invites: 'Invites',
  settings: 'Settings',
  audit: 'Audit Log',
  blasts: 'Blasts',
  voicemail: 'Voicemail',
  gdpr: 'GDPR / Privacy',
  system: 'System',
}
```

### Contacts: three orthogonal dimensions

The contacts domain uniquely has three permission dimensions that compose:

1. **Scope** (whose contacts): `contacts:read-own` / `-assigned` / `-all`, `contacts:update-own` / `-assigned` / `-all`
2. **Tier** (what fields to decrypt): `contacts:envelope-summary`, `contacts:envelope-full`
3. **Actions** (what operations): `contacts:create`, `contacts:update-summary`, `contacts:update-pii`, `contacts:delete`, `contacts:link`

A full authorization check composes these. For example, "can this user edit this contact's PII?" requires:
- **Scope**: `contacts:update-own` (and the contact is theirs), or `contacts:update-assigned`, or `contacts:update-all`
- **Tier**: `contacts:envelope-full` (must be able to decrypt PII to edit it)
- **Action**: `contacts:update-pii` (the specific field-tier edit action)

All three must be satisfied. This gives admins precise control: a Case Manager might have `contacts:update-assigned` + `contacts:envelope-full` + `contacts:update-pii` (can edit PII on assigned contacts) while a Volunteer has `contacts:update-own` + `contacts:envelope-summary` + `contacts:update-summary` (can edit display names on contacts they created).

---

## 2. Scope Hierarchy Resolution

### Hierarchy definition

```typescript
const SCOPE_LEVELS: Record<string, number> = {
  own: 0,
  assigned: 1,
  all: 2,
}
```

A scope with a higher level subsumes all lower levels: `-all` grants `-assigned` and `-own`.

### Updated `permissionGranted()`

```typescript
export function permissionGranted(grantedPermissions: string[], required: string): boolean {
  // Global wildcard
  if (grantedPermissions.includes('*')) return true
  // Exact match
  if (grantedPermissions.includes(required)) return true
  // Domain wildcard
  const domain = required.split(':')[0]
  if (grantedPermissions.includes(`${domain}:*`)) return true

  // Scope hierarchy — e.g., notes:read-all subsumes notes:read-own
  const scopeMatch = required.match(/^(.+)-(own|assigned|all)$/)
  if (scopeMatch) {
    const [, base, requiredScope] = scopeMatch
    const requiredLevel = SCOPE_LEVELS[requiredScope]
    for (const granted of grantedPermissions) {
      const grantedMatch = granted.match(/^(.+)-(own|assigned|all)$/)
      if (grantedMatch && grantedMatch[1] === base) {
        const grantedLevel = SCOPE_LEVELS[grantedMatch[2]]
        if (grantedLevel >= requiredLevel) return true
      }
    }
  }

  return false
}
```

This is backwards-compatible: all existing permission checks continue to work. The hierarchy adds automatic subsumption on top of the existing exact-match + wildcard logic.

---

## 3. Extensible Assignment Resolver

The `-assigned` scope requires a domain-specific definition of "assigned to this user." This is implemented as pluggable resolvers that the service layer uses when filtering data.

### Interface

```typescript
interface AssignmentCheck {
  resourceId: string
  userPubkey: string
  hubId: string
}

interface AssignmentResolver {
  isAssigned(check: AssignmentCheck): Promise<boolean>
  listAssignedIds(userPubkey: string, hubId: string): Promise<string[]>
}
```

### Default resolvers

Each domain defines what "assigned" means:

| Domain | "Assigned" means |
|--------|-----------------|
| **contacts** | `createdBy = user` OR contact linked to a call/conversation the user handled OR explicit `assignedTo` field on the contact |
| **notes** | `authorPubkey = user` OR note linked to a call the user handled |
| **conversations** | `assignedTo = user` |
| **reports** | `assignedTo = user` OR `submittedBy = user` |
| **files** | File attached to a resource the user is assigned to |
| **shifts** | User is listed in the shift's `userPubkeys` array |

### Extension point for teams

A future Teams spec will wrap these resolvers to add team membership:

```typescript
// Future — not part of this spec
class TeamAwareResolver implements AssignmentResolver {
  async isAssigned(check: AssignmentCheck): Promise<boolean> {
    // Check direct assignment first
    if (await this.directResolver.isAssigned(check)) return true
    // Then check team membership
    return this.teamResolver.isTeamAssigned(check)
  }
}
```

The permission model doesn't need to change when teams are added — only the resolver implementations.

### Database: contacts `assignedTo` field

Add an `assignedTo` column to the `contacts` table for explicit case manager assignment:

```typescript
assignedTo: text('assigned_to')  // pubkey of assigned case manager (nullable)
```

This is the primary mechanism for Hub Admins to assign contacts to Case Managers. The assignment resolver uses this field alongside implicit assignment (via call/conversation handling).

---

## 4. Permission Renames

These existing permissions are renamed to separate scope from tier concepts:

| Old | New | Reason |
|-----|-----|--------|
| `contacts:read-summary` | `contacts:envelope-summary` | "read" implies scope; this is a tier (what data) |
| `contacts:read-pii` | `contacts:envelope-full` | Same — tier, not scope |
| `contacts:update-summary` | Keep as-is | Action on summary-tier fields — not a scope |
| `contacts:update-pii` | Keep as-is | Action on PII-tier fields — not a scope |
| `shifts:read` | `shifts:read-all` | Normalize to explicit scope |

All code referencing the old permission strings updates to the new names.

### SQL migration for stored permissions

```sql
UPDATE roles SET permissions = replace(
  replace(
    replace(permissions::text,
      '"contacts:read-summary"', '"contacts:envelope-summary"'),
    '"contacts:read-pii"', '"contacts:envelope-full"'),
  '"shifts:read"', '"shifts:read-all"'
)::jsonb;
```

---

## 5. Updated Default Roles

### Case Manager (new)

```typescript
{
  id: 'role-case-manager',
  name: 'Case Manager',
  slug: 'case-manager',
  permissions: [
    // Contacts — assigned contacts, full detail
    'contacts:read-assigned',
    'contacts:update-assigned',
    'contacts:envelope-summary',
    'contacts:envelope-full',
    'contacts:create',
    'contacts:link',
    // Notes — all notes for cross-volunteer context
    'notes:read-all',
    'notes:create',
    'notes:update-own',
    'notes:reply',
    // Conversations — assigned
    'conversations:read-assigned',
    'conversations:send',
    // Reports — assigned
    'reports:read-assigned',
    'reports:update',
    'reports:send-message',
    // Calls — history for context
    'calls:read-history',
    'calls:read-active',
    // Files
    'files:upload',
    'files:download-assigned',
    // Shifts — own schedule
    'shifts:read-own',
    // Voicemail
    'voicemail:read',
    // GDPR
    'gdpr:consent',
    'gdpr:export',
    'gdpr:erase-self',
  ],
  isDefault: true,
  isSystem: false,
  description:
    'Triages intake, manages assigned contact records, coordinates support networks',
}
```

### Updated existing roles

**Hub Admin** — add new contact scope/tier permissions:

```typescript
permissions: [
  'users:*',        // renamed from volunteers:*
  'contacts:*',     // already present — covers all new scope + tier permissions
  'shifts:*',       // shifts:read-all covered by wildcard
  // ... rest unchanged
]
```

**Volunteer** — add explicit scope, rename tier permissions:

```typescript
permissions: [
  // ... existing call/note/conversation permissions ...
  'contacts:create',
  'contacts:read-own',           // NEW — explicit scope
  'contacts:envelope-summary',   // renamed from contacts:read-summary
  // ... rest unchanged
]
```

**Voicemail Reviewer** — rename tier permission:

```typescript
permissions: [
  // ...
  'contacts:read-assigned',      // NEW — was contacts:read-summary (wrong concept)
  'contacts:envelope-summary',   // renamed
  // ...
]
```

**Reporter** — no contact changes (no contact permissions).

**Reviewer** — no contact changes (no contact permissions currently).

---

## 6. Role Editor UI

The role editor renders permissions grouped by `group`, with input types driven by `subgroup`.

### Rendering logic

```typescript
function renderPermissionGroup(group: string, permissions: PermissionMeta[]) {
  const scopes = permissions.filter(p => p.subgroup === 'scope')
  const tiers = permissions.filter(p => p.subgroup === 'tiers')
  const actions = permissions.filter(p => p.subgroup === 'actions')

  return (
    <SettingsSection title={PERMISSION_GROUP_LABELS[group]}>
      {scopes.length > 0 && (
        <ScopeRadioGroup permissions={scopes} />    // Radio — mutually exclusive
      )}
      {tiers.length > 0 && (
        <TierCheckboxGroup permissions={tiers} />    // Checkbox — additive
      )}
      {actions.length > 0 && (
        <ActionCheckboxGroup permissions={actions} /> // Checkbox — additive
      )}
    </SettingsSection>
  )
}
```

### Scope radio groups

For scoped permissions, the editor extracts the action (e.g., `read`, `update`) and groups scope levels as radio options:

**Contacts — Who can they see?**
- ○ Only contacts they created or handled (`contacts:read-own`)
- ○ Contacts assigned to them (`contacts:read-assigned`)
- ○ All contacts in this hub (`contacts:read-all`)

**Contacts — What can they edit?**
- ○ Only contacts they created (`contacts:update-own`)
- ○ Contacts assigned to them (`contacts:update-assigned`)
- ○ Any contact (`contacts:update-all`)

The radio group extracts the action prefix by finding the common `domain:action-` pattern across scope permissions in the same group.

### Tier checkboxes

**Contacts — What details can they access?**
- ☑ Display name, tags, risk level, notes (`contacts:envelope-summary`)
- ☐ Full details — legal name, phone, address, channels (`contacts:envelope-full`)

### Action checkboxes

**Contacts — What can they do?**
- ☑ Create new contacts (`contacts:create`)
- ☐ Delete contacts (`contacts:delete`)
- ☐ Link calls/conversations to contacts (`contacts:link`)

### No hardcoded UI logic

The `label`, `group`, and `subgroup` fields fully drive rendering. Adding a new permission is one line in `PERMISSION_CATALOG` — the role editor automatically picks it up. No UI code changes needed per permission.

---

## 7. Wildcard Types

```typescript
export type PermissionDomain = Permission extends `${infer D}:${string}` ? D : never
export type WildcardPermission = `${PermissionDomain}:*` | '*'
export type PermissionOrWildcard = Permission | WildcardPermission
```

Roles can contain wildcards (`contacts:*`, `*`). Route guards and application code reference concrete `Permission` values only — wildcards are resolved at permission check time, not at call sites.

---

## 8. `getPermissionsByDomain()` Update

The existing helper updates to return typed metadata:

```typescript
export function getPermissionsByDomain(): Record<
  string,
  { key: Permission; meta: PermissionMeta }[]
> {
  const result: Record<string, { key: Permission; meta: PermissionMeta }[]> = {}
  for (const [key, meta] of Object.entries(PERMISSION_CATALOG)) {
    const domain = key.split(':')[0]
    if (!result[domain]) result[domain] = []
    result[domain].push({ key: key as Permission, meta })
  }
  return result
}
```

---

## 9. Migration

Pre-production, clean cut. No backwards compatibility.

### SQL migration

1. Rename permission strings in stored roles (see Section 4)
2. Add `assigned_to` column to `contacts` table
3. Rename `shifts:read` → `shifts:read-all` in stored permissions

### New permissions (not renames — added fresh)

These are new scope tiers that don't exist in the current codebase:
- `contacts:read-own`, `contacts:read-assigned`, `contacts:read-all` (scope)
- `contacts:update-own`, `contacts:update-assigned`, `contacts:update-all` (scope)
- `notes:update-assigned`, `notes:update-all` (scope — only `notes:update-own` exists)
- `conversations:read-own` (scope — only `read-assigned` and `read-all` exist)
- `files:download-assigned` (scope — only `download-own` and `download-all` exist)
- `shifts:read-assigned` (scope — only `read-own` exists, `read` becomes `read-all`)

### Code changes

1. Replace `PERMISSION_CATALOG` values from strings to `PermissionMeta` objects
2. Update all `PERMISSION_CATALOG['some:perm']` references (currently return string, will return object — use `.label` where needed)
3. Add scope hierarchy logic to `permissionGranted()`
4. Add `PERMISSION_GROUP_LABELS`
5. Add `AssignmentResolver` interface and default implementations per domain
6. Rename contact tier permissions in all route guards, service checks, and client permission checks
7. Add new scope permissions to default roles where appropriate
8. Add Case Manager to `DEFAULT_ROLES`
9. Update role editor UI to use metadata-driven rendering
10. Update all tests

### Verification

1. `bun run typecheck` — zero errors
2. `bun run build` — clean build
3. All existing permission tests updated and passing
4. New tests for scope hierarchy resolution
5. New tests for assignment resolver
6. Role editor renders correctly with grouped permissions
7. `grep -r "contacts:read-summary\|contacts:read-pii\|shifts:read[^-]" src/` — zero hits (old names removed)

---

## 10. Scope — What This Spec Does NOT Cover

- **Teams & team-based assignment** — separate spec. The assignment resolver interface is designed to support it.
- **Custom field `visibleTo: Permission`** — deferred to Contact Directory enhancement spec. Will replace `showInUserView` boolean with a permission string.
- **Contact intake triage permission (`contacts:triage`)** — deferred to Post-Call Data Entry spec.
- **Tag creation permission (`tags:create`)** — deferred to Tag Management spec.
- **Permission audit logging** — future work.
