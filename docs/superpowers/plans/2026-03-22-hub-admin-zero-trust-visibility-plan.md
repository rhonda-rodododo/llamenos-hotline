# Hub Admin Zero-Trust Super-Admin Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `allowSuperAdminAccess` toggle per hub. Default OFF. Hub admin controls whether super admin's pubkey is included in hub key envelopes (E2EE boundary). Super admin cannot self-grant.

**Spec:** `docs/superpowers/specs/2026-03-22-hub-admin-zero-trust-visibility-design.md`

**Assumes:** Drizzle migration complete. Hub key envelopes exist in `hub_key_envelopes` table.

---

## Phase 1: Database Schema

- [ ] Verify `hub_key_envelopes` table exists in Drizzle schema (`src/server/db/schema/`)
  - If not: create it with columns: `hubId`, `pubkey`, `wrappedKey`, `ephemeralPk`, `createdAt`
  - Primary key: `(hubId, pubkey)`
- [ ] Add `allowSuperAdminAccess` column to hub settings in `src/server/db/schema/settings.ts`:
  ```typescript
  allowSuperAdminAccess: boolean('allow_super_admin_access').notNull().default(false)
  ```
  - Add to hub settings Zod schema: `allowSuperAdminAccess: z.boolean().default(false)`
- [ ] Run `bunx drizzle-kit generate` to create migration
- [ ] `bun run typecheck` — must pass

---

## Phase 2: IdentityService — Super Admin Pubkey Lookup

- [ ] Add `getSuperAdminPubkeys(): Promise<string[]>` to `IdentityService`:
  - Queries volunteers who have a role with `system:manage-instance` permission
  - Returns array of pubkeys
  - Results cached per-request (not across requests — permissions can change)
- [ ] Add Zod-typed helper to check if a pubkey is a super admin:
  ```typescript
  async isSuperAdmin(pubkey: string): Promise<boolean>
  ```

---

## Phase 3: Hub Key Rotation Service

- [ ] Add `rotateHubKey(hubId: string, includeSuperAdmin: boolean): Promise<void>` to `SettingsService` or new `HubKeyService`:
  - **Client-dependent operation**: generating new hub key and wrapping it requires the operation to happen server-side where we have the ECIES wrapping capability
  - Generate new random hub key: `crypto.getRandomValues(new Uint8Array(32))`
  - Get all hub members (pubkeys) from `hub_key_envelopes` for current hub (or from hub membership table)
  - If `includeSuperAdmin`: append super admin pubkeys (from `IdentityService.getSuperAdminPubkeys()`)
  - For each recipient pubkey, compute ECIES envelope:
    ```typescript
    const { wrappedKey, ephemeralPubkey } = eciesEncrypt(newHubKey, recipientPubkey, LABEL_HUB_KEY_WRAP)
    ```
  - In a single transaction:
    - Delete all existing envelopes for this hub: `DELETE FROM hub_key_envelopes WHERE hub_id = ?`
    - Insert new envelopes for all recipients
    - Update hub_settings: `allow_super_admin_access = includeSuperAdmin`
  - Publish Nostr event `{ type: 'hub:key-rotated' }` (encrypted with NEW hub key)
  - Audit log: `{ event: includeSuperAdmin ? 'superAdminAccessEnabled' : 'superAdminAccessRevoked', hubId, actor }`

---

## Phase 4: API Route

- [ ] In `src/server/routes/hubs.ts` (or settings), add/update `PATCH /api/hubs/:hubId/settings`:
  ```typescript
  hubs.patch('/:hubId/settings', async (c) => {
    const { hubId } = c.req.param()
    const body = HubSettingsUpdateSchema.parse(await c.req.json())
    const callerPubkey = c.get('auth').pubkey
    const isSuperAdmin = await services.identity.isSuperAdmin(callerPubkey)

    // Explicitly forbid super admin from granting themselves access
    if (isSuperAdmin && 'allowSuperAdminAccess' in body) {
      return c.json({ error: 'Super admin cannot modify their own hub access' }, 403)
    }

    // Must be hub admin
    requireHubPermission(c, hubId, 'settings:manage')

    if ('allowSuperAdminAccess' in body) {
      await services.settings.rotateHubKey(hubId, body.allowSuperAdminAccess)
    }
    // Handle other setting updates...
    return c.body(null, 204)
  })
  ```
- [ ] Add `HubSettingsUpdateSchema` Zod schema: `z.object({ allowSuperAdminAccess: z.boolean().optional(), ... })`

### Hub key envelope endpoint
- [ ] Add `GET /api/hubs/:hubId/key-envelope` — returns the current hub key envelope for the requesting user:
  ```
  GET /api/hubs/:hubId/key-envelope
  Response: { wrappedKey: string, ephemeralPk: string } | { error: 'not_a_member' }
  ```
  - Returns the envelope row where `pubkey = callerPubkey`
  - Used by client when hub key rotation event received

---

## Phase 5: Client — Hub Key Manager Update

- [ ] Update `src/client/lib/hub-key-manager.ts`:
  - Add handler for Nostr event type `hub:key-rotated`
  - On receiving this event: call `GET /api/hubs/:hubId/key-envelope`
  - If response has envelope: unwrap with own nsec, update cached hub key
  - If `error: 'not_a_member'`: clear hub key cache for this hub (access revoked)

### Client API
- [ ] Add `getHubKeyEnvelope(hubId: string)` to `src/client/lib/api.ts`

---

## Phase 6: Admin Settings UI

- [ ] Add "Access Control" section to hub settings page (`src/client/routes/admin/hubs.tsx` or hub detail view):
  - Heading: "Platform Administrator Access"
  - Toggle: "Allow platform administrator to view this hub's data"
  - Description (always visible): "When disabled, the platform administrator cannot decrypt call notes, conversations, or reports. This is enforced through encryption — not a permissions check. Only future data is affected when enabling; retroactive access is not granted."
  - Toggle state reflects `allowSuperAdminAccess` from hub settings API
  - **Confirmation dialogs:**
    - Enable: "This grants the platform administrator access to new records in this hub. They will NOT gain access to historical records. Continue?"
    - Disable: "This revokes the platform administrator's access to this hub. They will lose access to future records immediately. Continue?"
  - Loading state during key rotation (may take 1–3 seconds for ECIES wrapping)

### Super admin view
- [ ] On super admin hub management page (`/admin/hubs`), add "Access" column to hub table:
  - ✅ "Enabled" (admin can read this hub)
  - 🔒 "Restricted" (admin cannot read this hub)
  - No toggle shown (super admin cannot change this)

---

## Phase 7: i18n

- [ ] Add to all 13 locale files:
  - `admin.hubs.accessControl.title`
  - `admin.hubs.accessControl.allowSuperAdmin`
  - `admin.hubs.accessControl.description`
  - `admin.hubs.accessControl.enableConfirm`
  - `admin.hubs.accessControl.disableConfirm`
  - `admin.hubs.accessControl.enabled` / `restricted`

---

## Phase 8: E2E Tests

- [ ] Create `tests/hub-access-control.spec.ts`:

### Test 8.1: Default is restricted
```
Given: New hub created
When: Admin views hub settings
Then: allowSuperAdminAccess = false
Then: Super admin hub list shows hub as "Restricted"
```

### Test 8.2: Hub admin enables super admin access
```
Given: Hub admin logged in
When: Toggle super admin access ON + confirm dialog
Then: Hub settings updated (allowSuperAdminAccess = true)
Then: Key rotation event published (verify via relay test helper)
Then: Super admin's hub list shows hub as "Enabled"
```

### Test 8.3: Hub admin disables super admin access
```
Given: allowSuperAdminAccess = true
When: Toggle OFF + confirm
Then: Key rotation occurs
Then: Super admin hub list shows "Restricted" again
```

### Test 8.4: Super admin cannot self-grant
```
Given: Logged in as super admin
When: PATCH /api/hubs/:hubId/settings { allowSuperAdminAccess: true }
Then: 403 response
Then: Setting remains unchanged
```

### Test 8.5: Key rotation excludes revoked super admin from new events
```
(E2EE level test — see e2ee-verification-tests-plan.md for encryption testing approach)
Given: Super admin had access (enabled), now disabled
When: Simulate new call note created after revocation
When: Super admin attempts to decrypt note
Then: Decryption fails (no envelope for their pubkey in note)
```

---

## Completion Checklist

- [ ] `hub_key_envelopes` table exists with correct schema
- [ ] `allowSuperAdminAccess` column added to hub settings, default `false`
- [ ] `getSuperAdminPubkeys()` returns correct pubkeys
- [ ] `rotateHubKey()` correctly wraps/unwraps for members + conditional super admin
- [ ] `PATCH /api/hubs/:hubId/settings` rejects super admin self-grant with 403
- [ ] Client hub key manager handles `hub:key-rotated` event
- [ ] Admin UI toggle with confirmation dialogs
- [ ] Super admin hub list shows access status
- [ ] Audit log entries for enable/disable events
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass: test 8.1–8.4
