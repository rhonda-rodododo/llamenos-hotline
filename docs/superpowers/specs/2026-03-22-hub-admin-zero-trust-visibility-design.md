# Hub Admin Zero-Trust Super-Admin Visibility Control — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Each hub admin should be able to independently control whether the platform's super admin (or global instance admin) can decrypt and read their hub's sensitive data. This is a **zero-trust, zero-knowledge** feature enforced at the cryptographic boundary — not an API permission check.

Default: **super admin cannot see hub data** (`allowSuperAdminAccess: false`). Hub admin must explicitly grant access.

This feature was designed in v2 but not yet implemented. This spec covers the v1 implementation.

---

## Security Model

### Why API-level checks are insufficient

Any access control that says "check if user has `cross-hub:read` permission" can be bypassed by:
- A compromised super admin account
- A bug in the permission check
- A misconfigured role

**The only reliable boundary is cryptographic.**

### How it works

Hub data (notes, conversations, reports, Nostr events) is encrypted using the **hub key** — a random 32-byte value, ECIES-wrapped per member.

```
Hub Key (32 bytes random)
   ├── wrapped for Volunteer A (their nsec)
   ├── wrapped for Volunteer B (their nsec)
   ├── wrapped for Hub Admin (their nsec)
   └── wrapped for Super Admin (their nsec) ← ONLY if allowSuperAdminAccess = true
```

If the super admin's pubkey is not in the hub key envelope table, they literally cannot decrypt any hub data. No API guard needed.

### What the super admin can ALWAYS see (metadata, not content)

Even without hub key access, the super admin can see:
- Hub name, phone number, status, creation date
- Member list (pubkeys, role names — not PII)
- Hub audit log (event types and timestamps, not payloads if encrypted)
- Billing-relevant aggregate statistics (call counts, message counts)

Everything containing PII or crisis-response content is encrypted and inaccessible without the hub key.

---

## Hub Key Lifecycle

### Current state (no change needed)
Hub keys already work via ECIES envelopes in the `hub_key_envelopes` table (or equivalent storage). The `allowSuperAdminAccess` toggle simply controls whether the super admin's pubkey is added to the envelopes.

### On toggle ON (hub admin grants access)
1. Hub admin enables the toggle in settings
2. System generates new hub key K2 (rotation)
3. K2 is ECIES-wrapped for: all current hub members + super admin pubkey
4. New events use K2; existing events remain with old key (not retroactively re-encrypted for performance — see note below)
5. Super admin receives K2 envelope → can decrypt future events
6. Audit log records: `event: "superAdminAccessEnabled", actor: hubAdminPubkey, hubId`

**Re-encryption of historical events:** Retroactively re-encrypting all past encrypted notes and events would require the hub key to be unwrapped client-side by an admin, all events to be re-encrypted, and the result uploaded. This is expensive and complex. For the initial implementation, only future events are accessible to the newly-added super admin. This is an acceptable trade-off documented explicitly in the settings UI.

### On toggle OFF (hub admin revokes access)
1. Hub admin disables the toggle
2. System generates new hub key K3 (rotation)
3. K3 is wrapped for current hub members **excluding** super admin pubkey
4. Old K2 envelopes for super admin are deleted from `hub_key_envelopes`
5. Super admin can no longer unwrap any hub key → loses access to new events
6. Events encrypted with K1/K2 (before revocation) remain inaccessible to super admin going forward (they never had K3)
7. Audit log records: `event: "superAdminAccessRevoked", actor: hubAdminPubkey, hubId`

### Super admin cannot re-add themselves
This is enforced at the API layer (not the crypto layer):
- `PATCH /api/hubs/:hubId/settings` with `allowSuperAdminAccess: true`
- Permission check: the requesting user must be a **hub admin** (not global super admin)
- If the caller has `system:manage-instance` but is NOT a hub member, request is rejected with 403

---

## Data Model

### New column on hub settings

```sql
ALTER TABLE hub_settings ADD COLUMN allow_super_admin_access BOOLEAN NOT NULL DEFAULT FALSE;
```

Or in Drizzle:
```typescript
allowSuperAdminAccess: boolean('allow_super_admin_access').notNull().default(false)
```

### Hub key envelopes table (should already exist)
The `hub_key_envelopes` table stores ECIES-wrapped hub keys per member. On key rotation, old envelopes are deleted and new ones inserted.

```sql
hub_key_envelopes (
  hub_id       VARCHAR(64) NOT NULL,
  pubkey       VARCHAR(64) NOT NULL,  -- recipient's public key
  wrapped_key  TEXT NOT NULL,         -- base64 ECIES envelope
  ephemeral_pk TEXT NOT NULL,         -- ephemeral pubkey for ECDH
  created_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (hub_id, pubkey)
)
```

---

## API Design

### Update hub settings (hub admin only)

```
PATCH /api/hubs/:hubId/settings
{
  allowSuperAdminAccess: boolean
}
```

**Authorization:**
- Caller must be authenticated
- Caller must be a hub admin for `hubId` (have `hubs:manage-keys` or `settings:manage` within that hub)
- Super admin (global `system:manage-instance`) is **explicitly rejected** for this field — they cannot grant themselves access

**On request:**
1. Validate caller is hub admin (not global super admin)
2. Get current `allowSuperAdminAccess` value
3. If value is changing:
   - Get current super admin pubkey(s) from `IdentityService.getSuperAdminPubkeys()`
   - Trigger hub key rotation:
     - Generate new random hub key
     - Get all hub members' pubkeys
     - If `allowSuperAdminAccess = true`: add super admin pubkeys to member list
     - ECIES-wrap new hub key for each recipient
     - Delete old envelopes from `hub_key_envelopes`
     - Insert new envelopes
   - Update `hub_settings.allow_super_admin_access`
   - Publish Nostr event to hub: `{ type: 'hub:key-rotated' }` (encrypted with NEW hub key)
   - All members' clients receive rotation event and re-fetch their envelope
4. If value unchanged: no-op
5. Audit log the change

**Response:** 204 No Content on success

---

## Client-Side Flow

### Hub admin enables super admin access

1. Admin opens hub settings → "Access Control" section
2. Sees toggle: "Allow platform administrator to view this hub's data" (default: OFF)
3. Reads explanation: "When disabled, the platform administrator cannot decrypt or read call notes, conversations, or reports in this hub. This is enforced through cryptography — not a permissions check."
4. Toggles ON
5. **Confirmation dialog**: "This will allow [platform administrator] to see all new call notes, conversations, and reports in this hub. Historical records will NOT be shared retroactively. Are you sure?"
6. Confirms
7. UI calls `PATCH /api/hubs/:hubId/settings { allowSuperAdminAccess: true }`
8. Hub key rotation happens server-side
9. Client refreshes hub key (receives new envelope)
10. Toast: "Super admin access enabled. They can now access new records in this hub."

### Hub admin disables super admin access

1. Toggle OFF
2. **Confirmation dialog**: "This will revoke the platform administrator's ability to decrypt this hub's data. They will lose access to future records immediately."
3. Confirms
4. API call + key rotation
5. Toast: "Super admin access revoked."

### Client receives hub key rotation event
- `useNostrSubscription` hook in hub context receives `hub:key-rotated` event
- Client automatically fetches new hub key envelope: `GET /api/hubs/:hubId/key-envelope`
- `hub-key-manager.ts` unwraps new envelope and caches new hub key
- No user action needed

---

## Super Admin Dashboard Indicator

On the super admin's hub management page, each hub should show:

| Hub | Members | Status | Super Admin Access |
|-----|---------|--------|--------------------|
| Hub A | 3 | Active | ✅ Enabled |
| Hub B | 7 | Active | 🔒 Restricted |

Super admin sees which hubs they can access. They CANNOT click to request access — that would defeat the purpose.

---

## Security Properties

| Property | Enforcement |
|---|---|
| Default deny | `allowSuperAdminAccess: false` by default |
| Cryptographic boundary | Hub key not wrapped for super admin = no decryption possible |
| Per-hub granularity | Each hub decides independently |
| Super admin can't self-grant | API permission check blocks self-granting |
| Revocation takes effect immediately | Key rotation removes old envelope; super admin loses future access |
| Audit trail | All changes logged with actor, timestamp, and before/after value |
| Retroactive access | NOT granted (by design) — only future events accessible after enabling |

---

## Limitations & Accepted Trade-offs

1. **Retroactive re-encryption is not included** — too expensive and complex for v1. Future enhancement.
2. **Super admin knows hub names/member counts** — metadata is not encrypted. Acceptable.
3. **Key rotation window** — there is a brief window between toggle and rotation during which super admin status is unchanged. This window is milliseconds to seconds (server-side operation).
4. **If super admin was already a hub member** (e.g., they bootstrapped the hub), removing them from hub membership is separate from this toggle. The toggle specifically controls the "extra super admin envelope".

---

## Dependencies

- Hub key envelope storage (must already exist or be added in Drizzle migration)
- `IdentityService.getSuperAdminPubkeys()` — returns pubkeys of users with `system:manage-instance` permission
- Hub key rotation ceremony (already designed for member departure in `hub-key-manager.ts`)
- Nostr event publishing: `hub:key-rotated` event type
- Client: `hub-key-manager.ts` already handles hub key rotation on member departure — extend to handle server-initiated rotation
