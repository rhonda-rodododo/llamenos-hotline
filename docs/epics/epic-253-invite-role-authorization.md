# Epic 253: Invite Role Authorization Validation

**Priority**: P0 — Security
**Severity**: HIGH
**Category**: Authorization / Privilege Escalation
**Status**: Pending

## Problem

When creating an invite (`POST /api/invites`), the `roleIds` array from the request body is stored verbatim with zero validation against the creator's own permissions. The route only requires `invites:create` permission (line 59 of `apps/worker/routes/invites.ts`).

The `role-hub-admin` role has `invites:*` (granting `invites:create`) but does NOT have `*` (super-admin). A hub-admin can craft `POST /api/invites` with `roleIds: ["role-super-admin"]`, and when redeemed, the new account gets `permissions: ['*']` — full privilege escalation.

## Affected Files

- `apps/worker/routes/invites.ts:59-71` — Route handler passes roleIds unchecked
- `apps/worker/durable-objects/identity-do.ts:335-349` — `createInvite()` stores roleIds without validation
- `apps/worker/durable-objects/identity-do.ts:372-391` — `redeemInvite()` applies roleIds verbatim

## Solution

### Approach: Validate roleIds against creator's permissions at the route level

The route handler already has access to `c.get('permissions')` (set by the auth middleware). Validate that every roleId in the invite grants only permissions the creator already holds.

### Implementation

**`apps/worker/routes/invites.ts`** — Add validation before forwarding to DO:

```typescript
invites.post('/', requirePermission('invites:create'), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json() as { name: string; phone: string; roleIds: string[] }

  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format' }, 400)
  }

  // Validate that the creator can grant all requested roles
  const creatorPermissions = c.get('permissions') as string[]
  const allRoles = c.get('allRoles') as Role[]

  if (body.roleIds && body.roleIds.length > 0) {
    // Super-admin can grant any role
    if (!permissionGranted(creatorPermissions, '*')) {
      for (const roleId of body.roleIds) {
        const role = allRoles.find(r => r.id === roleId)
        if (!role) {
          return c.json({ error: `Unknown role: ${roleId}` }, 400)
        }
        // Check every permission in the target role is held by the creator
        for (const perm of role.permissions) {
          if (!permissionGranted(creatorPermissions, perm)) {
            return c.json({
              error: `Cannot grant role '${role.name}' — you lack permission '${perm}'`
            }, 403)
          }
        }
      }
    }
  }

  const res = await dos.identity.fetch(new Request('http://do/invites', {
    method: 'POST',
    body: JSON.stringify({ ...body, createdBy: pubkey }),
  }))
  if (res.ok) await audit(dos.records, 'inviteCreated', pubkey, { name: body.name })
  return res
})
```

### Dependencies

The auth middleware must populate `allRoles` on the context. Check if this is already done — if not, add role definitions to the auth middleware context.

Currently, the `permission-guard.ts` middleware resolves permissions from roleIds. We need the role definitions available. The `auth` middleware fetches the volunteer (which has `roles: string[]`), and `permission-guard` uses `resolvePermissions()` with `DEFAULT_ROLES` plus any custom roles from SettingsDO.

**Check**: Does `c.get('allRoles')` already exist? If not, the permission-guard middleware should set it. The `resolvePermissions` call in `permission-guard.ts` already loads the role definitions — just need to `c.set('allRoles', roles)`.

### Imports needed

```typescript
import { permissionGranted } from '@shared/permissions'
import type { Role } from '@shared/permissions'
```

## Testing

- Unit test: hub-admin attempts to create invite with `role-super-admin` → 403
- Unit test: hub-admin creates invite with `role-volunteer` → 200 (valid — all volunteer permissions are subset of hub-admin)
- Unit test: super-admin creates invite with `role-super-admin` → 200 (super-admin can grant anything)
- E2E: Attempt privilege escalation through invite flow → blocked
