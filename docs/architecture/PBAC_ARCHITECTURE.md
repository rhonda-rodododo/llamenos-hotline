# Permission-Based Access Control (PBAC) Architecture

## Overview

Llamenos uses a Permission-Based Access Control (PBAC) system instead of fixed
roles. Organizations start with a set of default roles (Super Admin, Hub Admin,
Case Manager, Reviewer, Volunteer, Voicemail Reviewer, Reporter) but can create
unlimited custom roles with any combination of permissions.

Key properties:

- **Permissions are colon-separated strings** (`domain:action`), e.g.
  `contacts:create`, `notes:read-all`, `settings:manage-spam`.
- **Roles are named bundles of permissions.** A user may hold multiple roles
  -- the effective permission set is the union of all assigned roles.
- **Wildcards** simplify broad grants: `*` grants everything;
  `domain:*` grants all permissions within a domain.
- **Scope hierarchy** within a domain: `-all` subsumes `-assigned` subsumes
  `-own`. Granting `notes:read-all` implicitly satisfies a check for
  `notes:read-own`.
- **Hub scoping**: Permissions resolve per-hub. A user can be a Hub Admin in
  one hub and a Volunteer in another. Super Admin (`*`) bypasses hub checks.
- **Role and permission names are hub-key encrypted** in the database --
  the server stores ciphertext for role names and descriptions.

```
 Caller (GSM)          Volunteer              Admin             Super Admin
      |                    |                    |                    |
  (no access)     calls:answer             settings:*               *
                  notes:create             users:*            (all permissions
                  notes:read-own           shifts:*             across all hubs)
                  ...                      audit:read
                                           ...
```

## Permission Catalog

Permissions are defined in `src/shared/permissions.ts` in `PERMISSION_CATALOG`.
Each permission belongs to a **group** and a **subgroup** (scope, actions, or
tiers).

### Contact Directory

Contacts use a three-dimensional authorization model:

1. **Scope** -- whose contacts the user can access
2. **Tier** -- what depth of fields (summary vs full PII)
3. **Actions** -- what operations are allowed

A full auth check composes all three dimensions. For example, "can this user
edit this contact's PII?" requires scope (`update-own`/`assigned`/`all`) +
tier (`envelope-full`) + action (`update-pii`).

| Permission | Subgroup | Description |
|---|---|---|
| `contacts:read-own` | scope | View contacts they created or handled |
| `contacts:read-assigned` | scope | View contacts assigned to them |
| `contacts:read-all` | scope | View all contacts in this hub |
| `contacts:update-own` | scope | Edit contacts they created |
| `contacts:update-assigned` | scope | Edit contacts assigned to them |
| `contacts:update-all` | scope | Edit any contact |
| `contacts:envelope-summary` | tiers | Access display name, tags, risk level, notes |
| `contacts:envelope-full` | tiers | Access full details (legal name, phone, address, channels) |
| `contacts:create` | actions | Create new contacts and relationships |
| `contacts:update-summary` | actions | Edit contact summary fields (display name, notes, tags) |
| `contacts:update-pii` | actions | Edit contact PII fields (legal name, phone, address) |
| `contacts:delete` | actions | Delete contacts |
| `contacts:link` | actions | Link/unlink calls and conversations to contacts |
| `contacts:triage` | actions | Review and merge intake submissions into contact records |

### Tags

| Permission | Subgroup | Description |
|---|---|---|
| `tags:create` | actions | Create new tags |

### Notes

| Permission | Subgroup | Description |
|---|---|---|
| `notes:read-own` | scope | Read own notes |
| `notes:read-assigned` | scope | Read notes from assigned users |
| `notes:read-all` | scope | Read all notes |
| `notes:update-own` | scope | Update own notes |
| `notes:update-assigned` | scope | Update notes from assigned users |
| `notes:update-all` | scope | Update any note |
| `notes:create` | actions | Create call notes |
| `notes:reply` | actions | Reply to notes |

### Calls

| Permission | Subgroup | Description |
|---|---|---|
| `calls:answer` | actions | Answer incoming calls |
| `calls:read-active` | actions | See active calls (caller info redacted) |
| `calls:read-active-full` | actions | See active calls with full caller info |
| `calls:read-history` | actions | View call history |
| `calls:read-presence` | actions | View user presence |
| `calls:read-recording` | actions | Listen to call recordings |
| `calls:debug` | actions | Debug call state |

### Reports

| Permission | Subgroup | Description |
|---|---|---|
| `reports:read-own` | scope | Read own reports |
| `reports:read-assigned` | scope | Read assigned reports |
| `reports:read-all` | scope | Read all reports |
| `reports:create` | actions | Submit reports |
| `reports:assign` | actions | Assign reports to reviewers |
| `reports:update` | actions | Update report status |
| `reports:send-message-own` | actions | Send messages in own reports |
| `reports:send-message` | actions | Send messages in any report |

### Conversations

| Permission | Subgroup | Description |
|---|---|---|
| `conversations:read-own` | scope | Read conversations they initiated |
| `conversations:read-assigned` | scope | Read assigned and waiting conversations |
| `conversations:read-all` | scope | Read all conversations |
| `conversations:claim` | actions | Claim a waiting conversation |
| `conversations:claim-sms` | actions | Claim SMS conversations |
| `conversations:claim-whatsapp` | actions | Claim WhatsApp conversations |
| `conversations:claim-signal` | actions | Claim Signal conversations |
| `conversations:claim-rcs` | actions | Claim RCS conversations |
| `conversations:claim-web` | actions | Claim web conversations |
| `conversations:claim-any` | actions | Claim any channel (bypass restrictions) |
| `conversations:send` | actions | Send messages in assigned conversations |
| `conversations:send-any` | actions | Send messages in any conversation |
| `conversations:update` | actions | Reassign/close/reopen conversations |

### User Management

| Permission | Subgroup | Description |
|---|---|---|
| `users:read` | actions | List/view user profiles |
| `users:create` | actions | Create new users |
| `users:update` | actions | Update user profiles |
| `users:delete` | actions | Deactivate/delete users |
| `users:manage-roles` | actions | Assign/change user roles |

### Shifts

| Permission | Subgroup | Description |
|---|---|---|
| `shifts:read-own` | scope | Check own shift status |
| `shifts:read-assigned` | scope | View shifts they are scheduled on |
| `shifts:read-all` | scope | View all shifts |
| `shifts:create` | actions | Create shifts |
| `shifts:update` | actions | Modify shifts |
| `shifts:delete` | actions | Delete shifts |
| `shifts:manage-fallback` | actions | Manage fallback ring group |

### Files

| Permission | Subgroup | Description |
|---|---|---|
| `files:download-own` | scope | Download own/authorized files |
| `files:download-assigned` | scope | Download files from assigned resources |
| `files:download-all` | scope | Download any file |
| `files:upload` | actions | Upload files |
| `files:share` | actions | Re-encrypt/share files with others |

### Ban List

| Permission | Subgroup | Description |
|---|---|---|
| `bans:report` | actions | Report/flag a number |
| `bans:read` | actions | View ban list |
| `bans:create` | actions | Ban numbers |
| `bans:bulk-create` | actions | Bulk ban import |
| `bans:delete` | actions | Remove bans |

### Invites

| Permission | Subgroup | Description |
|---|---|---|
| `invites:read` | actions | View pending invites |
| `invites:create` | actions | Create invite codes |
| `invites:revoke` | actions | Revoke invite codes |

### Settings

| Permission | Subgroup | Description |
|---|---|---|
| `settings:read` | actions | View settings |
| `settings:manage` | actions | Modify all settings |
| `settings:manage-telephony` | actions | Modify telephony provider |
| `settings:manage-messaging` | actions | Modify messaging channels |
| `settings:manage-spam` | actions | Modify spam settings |
| `settings:manage-ivr` | actions | Modify IVR/language settings |
| `settings:manage-fields` | actions | Modify custom fields |
| `settings:manage-transcription` | actions | Modify transcription settings |

### Audit Log

| Permission | Subgroup | Description |
|---|---|---|
| `audit:read` | actions | View audit log |

### Blasts

| Permission | Subgroup | Description |
|---|---|---|
| `blasts:read` | actions | View blast history |
| `blasts:send` | actions | Send blasts |
| `blasts:manage` | actions | Manage subscriber lists and templates |
| `blasts:schedule` | actions | Schedule future blasts |

### Voicemail

| Permission | Subgroup | Description |
|---|---|---|
| `voicemail:listen` | actions | Play/decrypt voicemail audio |
| `voicemail:read` | actions | View voicemail metadata in call history |
| `voicemail:notify` | actions | Receive notifications for new voicemails |
| `voicemail:delete` | actions | Delete voicemail audio and transcript |
| `voicemail:manage` | actions | Configure voicemail settings |

### GDPR / Privacy

| Permission | Subgroup | Description |
|---|---|---|
| `gdpr:consent` | actions | Record and check own data processing consent |
| `gdpr:export` | actions | Export own data (GDPR data portability) |
| `gdpr:erase-self` | actions | Request erasure of own account |
| `gdpr:admin` | actions | Admin-level GDPR operations (export/erase any user) |

### System

| Permission | Subgroup | Description |
|---|---|---|
| `system:manage-roles` | actions | Create/edit/delete custom roles |
| `system:manage-hubs` | actions | Create/manage hubs |
| `system:manage-instance` | actions | Instance-level settings |

## Default Roles

Seven default roles ship with every instance. Only Super Admin is a system role
(cannot be modified). All others can be customized or deleted.

| Role | System? | Key Permissions | Purpose |
|---|---|---|---|
| **Super Admin** | Yes | `*` (global wildcard) | Full system access across all hubs |
| **Hub Admin** | No | `users:*`, `shifts:*`, `settings:*`, `contacts:*`, `calls:*`, `conversations:*`, `reports:*`, `blasts:*`, `files:*`, `voicemail:*`, `bans:*`, `invites:*`, `audit:read` | Full control within assigned hub(s) |
| **Case Manager** | No | `contacts:read-assigned`, `contacts:update-assigned`, `contacts:envelope-full`, `contacts:create`, `contacts:link`, `contacts:triage`, `notes:read-all`, `tags:create`, and more | Triages intake, manages contact records |
| **Reviewer** | No | `notes:read-assigned`, `notes:reply`, `reports:read-assigned`, `reports:assign`, `reports:update`, `conversations:read-assigned`, `conversations:send` | Reviews notes and reports from assigned users |
| **Volunteer** | No | `calls:answer`, `notes:create`, `notes:read-own`, `conversations:claim`, `conversations:send`, channel-specific claim perms, `contacts:create`, `contacts:read-own` | Answers calls, writes notes, handles conversations |
| **Voicemail Reviewer** | No | `voicemail:listen`, `voicemail:read`, `voicemail:notify`, `notes:read-all`, `contacts:read-assigned`, `calls:read-history` | Triages voicemails |
| **Reporter** | No | `reports:create`, `reports:read-own`, `reports:send-message-own`, `files:upload`, `files:download-own` | Submits and tracks reports |

## Scoping Hierarchy

```
  Instance (Super Admin scope)
  |
  +-- Hub A                          Hub B
      |                               |
      +-- Team "Intake"               +-- Team "Night Shift"
      |   (scoped assignments)        |
      +-- Team "Follow-Up"            +-- Team "Legal"
      |
      +-- Individual users
          (direct role assignments)
```

### Three Levels of Scope

1. **Global roles** (`users.roles` column): Apply across all hubs. The Super
   Admin role is always global. These are resolved first.

2. **Hub roles** (`users.hubRoles` column, `[{ hubId, roleIds }]`): Apply
   within a specific hub. A user can hold different roles in different hubs.
   Resolved second -- merged with global permissions via set union.

3. **Team membership** (`hubMembers` table with `teamId`): Organizational
   grouping within a hub. Teams currently scope visibility (e.g., contacts
   assigned to a team) rather than adding extra permissions.

### Scope Resolution

Permission resolution combines global and hub-specific roles:

```
resolveHubPermissions(globalRoles, hubRoles, allRoleDefs, hubId)
  = union(
      resolvePermissions(globalRoles, allRoleDefs),
      resolvePermissions(hubRoles[hubId].roleIds, allRoleDefs)
    )
```

The scope hierarchy for read/update permissions (`-own`, `-assigned`, `-all`)
is resolved automatically:

```
  -all  (level 2)  -- subsumes all below
    |
  -assigned  (level 1)  -- subsumes -own
    |
  -own  (level 0)  -- most restrictive
```

If a user has `notes:read-all`, a check for `notes:read-own` succeeds.

## Server Enforcement

**The server is the single authority for access control.** All enforcement
happens in the Hono middleware and route handlers.

### Auth Middleware Pipeline

```
  Request
    |
    v
  auth middleware (src/server/middleware/auth.ts)
    |-- Authenticates the request (JWT / Nostr signature)
    |-- Loads all role definitions from SettingsService
    |-- Resolves effective permissions: resolvePermissions(user.roles, allRoles)
    |-- Sets on Hono context: c.set('permissions', [...])
    |
    v
  requirePermission(...) middleware (src/server/middleware/permission-guard.ts)
    |-- Reads c.get('permissions')
    |-- For each required permission: calls permissionGranted()
    |-- Returns 403 { error: 'Forbidden', required: '<perm>' } on failure
    |
    v
  Route handler
    |-- May do additional inline checks via checkPermission() or
    |   c.get('permissions') for conditional logic (e.g., filtering
    |   results by scope, redacting fields based on tier)
```

### Usage Patterns

**Route-level guard** (most common):

```typescript
app.get('/api/audit', requirePermission('audit:read'), handler)
app.post('/api/shifts', requirePermission('shifts:create'), handler)
// Multiple permissions (ALL required):
app.get('/api/settings/spam',
  requirePermission('settings:read', 'settings:manage-spam'), handler)
```

**Inline handler check** (for conditional logic within a route):

```typescript
const permissions = c.get('permissions')
if (checkPermission(permissions, 'calls:read-active-full')) {
  // Include full caller info
} else if (checkPermission(permissions, 'calls:read-active')) {
  // Include redacted caller info
}
```

**Scope filtering** (common in list endpoints):

```typescript
const permissions = c.get('permissions')
if (checkPermission(permissions, 'notes:read-all')) {
  // Return all notes
} else if (checkPermission(permissions, 'notes:read-assigned')) {
  // Return notes from assigned users only
} else if (checkPermission(permissions, 'notes:read-own')) {
  // Return only the requesting user's notes
}
```

## Client Enforcement

**Client-side permission checks are a UX convenience -- the server is the
authority.** The client uses permissions to show/hide UI elements and avoid
unnecessary API calls that would be rejected.

### useAuth Hook

The `useAuth()` hook (from `src/client/lib/auth.tsx`) exposes:

- `permissions: string[]` -- the current user's resolved permission list
  (returned by `/api/me`)
- `hasPermission(permission: string): boolean` -- calls `permissionGranted()`
  from the shared permissions module
- `isAdmin: boolean` -- shorthand for `hasPermission('settings:manage')`

### Usage in Components

```tsx
function CallsPage() {
  const { isAdmin, hasPermission } = useAuth()
  const canListen = hasPermission('voicemail:listen')
  const canCreateContacts = hasPermission('contacts:create')

  return (
    <>
      {hasPermission('blasts:read') && <BlastsTab />}
      {canCreateContacts && <CreateContactButton />}
      <VoicemailList canListen={canListen} />
    </>
  )
}
```

### Navigation Gating

The root layout (`src/client/routes/__root.tsx`) uses `hasPermission()` to
conditionally render sidebar links:

- Reporters who lack `calls:answer` see only the reports view
- Blast management links appear only for users with `blasts:read`
- Admin settings are gated behind `isAdmin`

### Role Management UI

The roles section (`src/client/components/admin-settings/roles-section.tsx`)
provides a permission editor. Permissions are grouped by domain with
scope-aware radio buttons (own/assigned/all) and action checkboxes. The
`PERMISSION_CATALOG` and `PERMISSION_GROUP_LABELS` from the shared module
drive the UI -- adding a new permission automatically surfaces it in the
role editor.

## E2EE Interaction

The PBAC system intersects with end-to-end encryption in important ways.
Because the server cannot read encrypted content, access control operates
at two layers:

```
  Server Layer                        Client Layer
  (ciphertext gating)                 (plaintext gating)
  +--------------------------+        +--------------------------+
  | 1. Auth middleware        |        | 1. hasPermission() check |
  | 2. requirePermission()   |        | 2. Hub key available?    |
  | 3. Scope filtering       |  --->  | 3. Decrypt if authorized |
  | 4. Return ciphertext     |        | 4. Render or hide        |
  +--------------------------+        +--------------------------+
```

### How It Works

1. **Server refuses to serve ciphertext to unauthorized users.** Even though
   the server cannot decrypt the data, it enforces permissions before returning
   encrypted payloads. A user without `contacts:read-all` will never receive
   ciphertext for contacts outside their scope.

2. **Client decrypts only after permission check.** The `hasPermission()` hook
   gates UI elements that would trigger decryption. For example, a user without
   `contacts:envelope-full` never sees the PII fields, so the client never
   attempts to decrypt them.

3. **Tier-based field visibility.** Contact data has two encryption tiers:
   - `envelope-summary`: display name, tags, risk level, notes
   - `envelope-full`: legal name, phone, address, channels

   The server returns different field sets based on the user's tier permission.
   The client also checks the tier before calling `decryptHubField()`.

4. **Hub key distribution is permission-independent.** All hub members receive
   the hub key (ECIES-wrapped per member). The hub key enables decrypting
   hub-encrypted metadata (role names, shift names, etc.). PBAC determines
   **which records** a user can access, not whether they hold the key.

5. **Per-note forward secrecy.** Note encryption keys are ECIES-wrapped per
   reader. The set of readers is determined by the note creator and admin
   policy -- not directly by PBAC permissions. However, the server uses PBAC
   to decide which notes to return in list queries.

### Security Boundary

The server cannot enforce decryption access (it does not hold keys), but it
enforces two critical guarantees:

- **Data minimization**: Unauthorized users never receive ciphertext they should
  not have. Even if they somehow obtained the hub key, they would not have the
  ciphertext to decrypt.
- **Defense in depth**: Both server-side permission checks and client-side key
  gating must pass. Compromising only the client (e.g., modifying JS) does not
  bypass server enforcement. Compromising only the server does not yield
  plaintext (the server never has it).

## Database Schema

### Users Table (`users`)

```
pubkey          text    PK
roles           jsonb   Global role IDs (e.g., ["role-super-admin"])
hubRoles        jsonb   Per-hub assignments: [{ hubId, roleIds }]
...
```

### Roles Table (`roles`)

```
id              text    PK (e.g., "role-volunteer" or UUID for custom)
hubId           text    null = global role; otherwise hub-scoped
encryptedName   text    Hub-key encrypted role name
encryptedDescription text  Hub-key encrypted description
permissions     jsonb   Array of permission strings
isDefault       bool    Ships with the system
createdAt       timestamp
```

### Invite Codes Table (`invite_codes`)

```
code            text    PK
roleIds         jsonb   Roles assigned on registration
...
```

When a user registers via an invite code, they inherit the `roleIds` from
the invite. Admins control initial role assignment at invite creation time.

## Key Source Files

| File | Purpose |
|---|---|
| `src/shared/permissions.ts` | Permission catalog, role types, resolution functions, wildcards, scope hierarchy, channel helpers |
| `src/server/middleware/permission-guard.ts` | `requirePermission()` and `checkPermission()` -- server enforcement |
| `src/server/middleware/auth.ts` | Resolves user permissions from roles on every request |
| `src/client/lib/auth.tsx` | `useAuth()` hook with `hasPermission()` for client-side gating |
| `src/client/lib/queries/roles.ts` | React Query hooks for role CRUD with hub-key decryption |
| `src/client/components/admin-settings/roles-section.tsx` | Role editor UI with grouped permission checkboxes |
| `src/server/db/schema/identity.ts` | `users` table with `roles` and `hubRoles` columns |
| `src/server/db/schema/settings.ts` | `roles` table with encrypted name/description and permissions |
