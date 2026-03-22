# Application Hardening — Implementation Plan

**Date:** 2026-03-22
**Spec:** `docs/superpowers/specs/2026-03-22-application-hardening-design.md`
**Status:** Ready to execute

---

## Overview

This plan is the sequenced execution guide for the Application Hardening & Gap Filling workstream. It covers multi-hub architecture corrections, hub lifecycle (delete/archive), cross-hub call reception, and the audit/backport process. Steps are ordered by dependency and risk.

Reference implementation: `~/projects/llamenos` (v2), particularly commits from `4d69de0` through `71a1d42` (multi-hub gap fixes) and `393a716` (hub route security).

---

## Phase 1 — Cross-Hub Call Reception & Notification Subscription Gap

**Priority: P1** — Security and correctness gap. Volunteers currently miss calls from non-active hubs.

### 1.1 Identify the gap in v1

**Files to audit:**

- `src/client/lib/hooks.ts` — `useCalls()` at line 41: subscribes via `useNostrSubscription(currentHubId, ...)`. This is the primary gap: only the active hub's events are received.
- `src/client/lib/nostr/hooks.ts` — `useNostrSubscription()`: accepts a single `hubId`. Must be extended or a new multi-hub variant added.
- `src/client/lib/nostr/relay.ts` — `RelayManager.handleEvent()` at line 275: decrypts with `this.getHubKey()` — a single-key callback. Multi-hub requires a per-hub-key lookup map.
- `src/client/lib/nostr/context.tsx` — `NostrProvider` props: `getHubKey: () => Uint8Array | null` is a single-hub callback. Must become hub-ID-aware for multi-hub decryption.
- `src/client/routes/__root.tsx` — `NostrWrappedLayout` at line 162: `getHubKey` returns `serverEventKeyHex` — a single shared server event key. In v1's Cloudflare DO architecture, the hub key is per-hub (ECIES-wrapped, fetched from `GET /api/hubs/:hubId/key`). The relay decryption must use the correct per-hub key.

**The root architectural split between v1 and v2:**
- In v2, `serverEventKeyHex` from `GET /api/auth/me` is a flat server event key used for all hubs — the relay uses one key.
- In v1, each hub has its own key (stored in SettingsDO per-hub, fetched via `GET /api/hubs/:hubId/key`). The client must maintain a map of `hubId -> Uint8Array` for all hubs the user belongs to, and use the correct one when decrypting events tagged with `['d', hubId]`.

### 1.2 Implementation steps

**Step 1: Extend `RelayManager` to support multi-hub key resolution**

File: `src/client/lib/nostr/relay.ts`

Change `getHubKey: () => Uint8Array | null` to `getHubKey: (hubId: string) => Uint8Array | null` in `RelayManagerOptions` and the class field. Update `handleEvent()` to call `this.getHubKey(hubId)` after extracting the hub ID from the event tags. This allows per-hub decryption.

**Step 2: Thread multi-hub key resolution through `NostrProvider`**

File: `src/client/lib/nostr/context.tsx`

Update `NostrProviderProps.getHubKey` signature to `(hubId: string) => Uint8Array | null`. Update the `RelayManager` instantiation to pass the updated callback.

**Step 3: Build a hub key cache in the auth layer**

File: `src/client/lib/auth.tsx` (or a new `src/client/lib/hub-keys.ts`)

- After login and on hub membership changes, fetch hub key envelopes for **all hubs** the user belongs to (from `GET /api/hubs/:hubId/key` for each hub in `volunteer.hubRoles`).
- Decrypt each envelope using the local key manager (ECIES unwrap).
- Store as `Map<hubId, Uint8Array>` in module-level state (not React state — same pattern as `key-manager.ts`).
- Export `getHubKeyForId(hubId: string): Uint8Array | null`.

**Step 4: Update `NostrWrappedLayout`**

File: `src/client/routes/__root.tsx`

Replace the single `getHubKey` callback with `(hubId: string) => getHubKeyForId(hubId)` from the hub key cache built in Step 3.

**Step 5: Add cross-hub call subscriptions**

File: `src/client/lib/hooks.ts`

`useCalls()` currently calls `useNostrSubscription(currentHubId, CALL_KINDS, ...)` once. The fix:
- Fetch the user's full `hubRoles` list (available from auth context).
- Subscribe to `CALL_KINDS` for **each** hub the user is on shift for — not just the active hub.
- Attach the hub ID to each incoming `call:ring` event so the UI can display which hub the call is for.
- `stopRinging()` must still fire when any hub's call is answered/completed.

Use `useNostrSubscription` once per on-shift hub, driven by a `hubIds: string[]` array. Since hooks cannot be called in a loop, build a new `useMultiHubNostrSubscription(hubIds, kinds, handler)` helper in `src/client/lib/nostr/hooks.ts` that internally manages subscriptions dynamically.

**Step 6: UI — show hub label on incoming calls**

Files: `src/client/components/` (call panel / incoming call banner)

When a call rings from a non-active hub, display the hub name alongside the incoming call indicator. This requires the `call:ring` event content to include the `hubId`, which the `CallRouterDO` already tags events with via `['d', hubId]` in the Nostr event.

### 1.3 Verification

- `bun run typecheck` must pass.
- E2E test: `tests/multi-hub.spec.ts` — add a test that creates two hubs, puts the test volunteer on shift in Hub B, sets active hub to Hub A, simulates a call ring event from Hub B (via the test API), and asserts the incoming call notification fires in the UI.

---

## Phase 2 — Hub Deletion & Archiving (Missing Feature)

**Priority: P1** — Required for operator cleanup AND parallel E2E test isolation.

### 2.1 Current state in v1

- `SettingsDO` has `archiveHub(id)` at line 694 of `src/worker/durable-objects/settings-do.ts`: sets `status: 'archived'` and writes back to storage. Works correctly.
- `src/worker/routes/hubs.ts` has no `DELETE /:hubId` route and no `/archive` route exposed.
- There is no cascade delete logic anywhere in v1 (v2 reference: `apps/worker/services/settings.ts` lines 1522–1646 shows the full cascade pattern for PostgreSQL).
- No UI for archive or delete actions exists.

### 2.2 Server: add archive and delete API endpoints

**File: `src/worker/routes/hubs.ts`**

Add after the existing PATCH route:

```
POST /:hubId/archive  (requirePermission('system:manage-hubs'))
DELETE /:hubId        (requirePermission('system:manage-hubs'))
```

**Archive endpoint** (`POST /:hubId/archive`):
- Calls `dos.settings.fetch(new Request('http://do/settings/hub/:id', { method: 'DELETE' }))` — which maps to the existing `archiveHub()` method in SettingsDO (already registered at `router.delete('/settings/hub/:id', ...)`).
- Safety gate: before archiving, check `dos.callRouter` for active calls on this hub. If any exist, return 409 with `"Cannot archive hub with active call in progress"`.
- Returns `{ ok: true }`.

**Delete endpoint** (`DELETE /:hubId`):
- This is a cascade operation across multiple DOs. Because v1 uses Durable Objects (not PostgreSQL), the cascade must be orchestrated at the route level across the six DOs.
- Safety gate: same active-call check as archive.
- Cascade sequence (order matters — delete children before parents):

  1. **ShiftManagerDO**: send `DELETE /shifts/hub/:hubId/all` — end all active shifts and delete shift records for this hub.
  2. **CallRouterDO**: send `DELETE /calls/hub/:hubId` — tombstone all call records (mark as `hubDeleted: true`, preserve for audit, but remove from active routing).
  3. **RecordsDO**: send `DELETE /records/hub/:hubId` — delete all notes, call records, attached file metadata for this hub.
  4. **ConversationDO**: send `DELETE /conversations/hub/:hubId` — delete all conversation threads and messages.
  5. **IdentityDO**: send `DELETE /identity/hub-roles/:hubId` — remove hub from all volunteers' `hubRoles` arrays. Volunteers who have no remaining hub memberships are left intact (they can be re-assigned or self-delete).
  6. **SettingsDO**: send `DELETE /settings/hub/:hubId/full` (new route needed — distinguish from soft-delete archive) — deletes hub settings, telephony config, custom fields, hub key envelopes, and finally the hub record itself.

**New SettingsDO handler: `deleteHubFull(id)`**

File: `src/worker/durable-objects/settings-do.ts`

Register: `this.router.delete('/settings/hub/:id/full', (_req, { id }) => this.deleteHubFull(id))`

```typescript
private async deleteHubFull(id: string): Promise<Response> {
  const hubs = await this.ctx.storage.get<Hub[]>('hubs') || []
  const idx = hubs.findIndex(h => h.id === id)
  if (idx === -1) return Response.json({ error: 'Not found' }, { status: 404 })

  // Delete all hub-scoped storage keys
  await this.ctx.storage.delete(`hub:${id}:settings`)
  await this.ctx.storage.delete(`hub:${id}:telephony-provider`)
  await this.ctx.storage.delete(`hub:${id}:custom-fields`)
  await this.ctx.storage.delete(`hub:${id}:key-envelopes`)
  // Any other hub:${id}:* keys — enumerate via list() with prefix
  const allKeys = await this.ctx.storage.list({ prefix: `hub:${id}:` })
  await this.ctx.storage.delete(...Array.from(allKeys.keys()))

  // Remove hub from list
  hubs.splice(idx, 1)
  await this.ctx.storage.put('hubs', hubs)

  return Response.json({ ok: true })
}
```

**New handlers needed in other DOs:**

- `ShiftManagerDO`: add `DELETE /shifts/hub/:hubId/all` — delete all shift records where `hubId` matches.
- `RecordsDO`: add `DELETE /records/hub/:hubId` — delete all notes and call records for hub.
- `ConversationDO`: add `DELETE /conversations/hub/:hubId` — delete all conversations for hub.
- `IdentityDO`: add `DELETE /identity/hub-roles/:hubId` — strip hub from all user's `hubRoles`.
- `CallRouterDO`: add `DELETE /calls/hub/:hubId` — tombstone active and historical call records.

All of these follow the same pattern: fetch the relevant storage keys, filter/delete the hub-specific ones, write back.

### 2.3 Active-call safety gate

The safety check must be implemented in `src/worker/durable-objects/call-router.ts`. Add a new handler:

```
GET /calls/hub/:hubId/active-count
```

Returns `{ count: number }`. The route handler checks this before proceeding with archive or delete. If count > 0, return HTTP 409.

### 2.4 UI: hub management actions

**File: `src/client/routes/admin/hubs.tsx`** (or wherever hub management lives — check existing routes)

Add to the hub detail/management page:
- **Archive button**: opens confirmation dialog. On confirm, calls `POST /api/hubs/:hubId/archive`. On success, navigate back to hub list. Shows error if active call is in progress.
- **Delete button**: opens a stricter confirmation dialog (requires typing the hub name). On confirm, calls `DELETE /api/hubs/:hubId`. Warns that all data will be permanently destroyed.

Both actions require `system:manage-hubs` permission (hide from non-super-admins via `hasPermission` check).

After deletion, if the deleted hub was the active hub, the hub switcher must automatically select another available hub (or show an empty state if none remain).

### 2.5 E2E test hub lifecycle helper

**File: `tests/helpers.ts`**

Add exported helpers:

```typescript
export async function createTestHub(
  page: Page,
  name: string,
): Promise<string> // returns hubId

export async function deleteTestHub(
  page: Page,
  hubId: string,
): Promise<void>
```

`createTestHub` makes an authed `POST /api/hubs` request, sets the hub key envelope via `PUT /api/hubs/:hubId/key` (can use a test-only plaintext key or generate one), and returns the hub ID.

`deleteTestHub` makes an authed `DELETE /api/hubs/:hubId` request and asserts the 200 response.

**File: `tests/global-setup.ts`**

The global setup creates the admin and default hub. It does not need to use `deleteTestHub` — that is for per-test teardown. Add a note in the file that tests requiring an isolated hub should call `createTestHub` in `beforeAll` and `deleteTestHub` in `afterAll`.

**File: `tests/multi-hub.spec.ts`**

Extend existing multi-hub tests with:
- `test('can archive a hub')` — creates a second hub, archives it, verifies it disappears from the hub list.
- `test('cannot delete hub with active call')` — creates a hub, simulates an active call, asserts DELETE returns 409.
- `test('delete hub cascades data')` — creates a hub, adds a volunteer to it, creates a test note, deletes the hub, verifies the note and volunteer assignment are gone.
- `test('cross-hub call ring from non-active hub')` — creates Hub B, adds volunteer to Hub B shift, sets active hub to Hub A, fires a call ring event for Hub B, asserts the incoming call notification appears.

---

## Phase 3 — Per-Hub Resource Isolation Audit

**Priority: P1** — Security verification, not new features.

### 3.1 SettingsDO isolation

Verify in `src/worker/durable-objects/settings-do.ts` that all routes accepting a `hubId` parameter validate that the requesting user is a member of that hub (or super-admin). The `hub.ts` middleware must enforce this.

File to check: `src/worker/middleware/hub.ts` — verify it rejects requests where `volunteer.hubRoles` does not include the `hubId` in the URL.

### 3.2 RecordsDO isolation

File: `src/worker/durable-objects/records-do.ts`

Verify: all `GET /records/notes` queries filter by `hubId`. Confirm no query returns notes across hub boundaries. The hub ID must be a required parameter on every read/write operation.

### 3.3 ShiftManagerDO isolation

File: `src/worker/durable-objects/shift-manager.ts`

Verify: shift queries accept a `hubId` parameter and the DO stores shifts with hub-scoped keys (e.g., `hub:${hubId}:shifts`). A hub admin in Hub A must not be able to read or modify Hub B's shifts.

### 3.4 Ban list isolation

File: `src/worker/routes/bans.ts` and `src/worker/durable-objects/settings-do.ts`

Verify: ban records include a `hubId` field. Bans are per-hub by default. The "global ban" flag (if it exists) must require `system:manage-hubs` permission to set.

### 3.5 Audit log isolation

File: `src/worker/routes/audit.ts`

Verify: audit log entries are tagged with `hubId`. The `GET /api/audit` endpoint must filter by the active hub unless the caller is super-admin.

### 3.6 Document findings

For each DO audited, record either "PASS — isolation confirmed" or "FAIL — gap found: [description]" in a findings note. Any FAIL is a P0 and blocks release.

---

## Phase 4 — V2 Backport Candidates

**Priority: P2** — Quality improvements, not blocking.

### 4.1 Backport evaluation process

Run `git log --oneline` in `~/projects/llamenos` and review commits from the last 30–40 entries. For each commit, evaluate:

1. Is it applicable to v1's CF Workers + DO architecture? (Skip: PostgreSQL, mobile/Tauri, CRM)
2. Does v1 already have the equivalent fix?
3. What is the complexity of the port?

Known candidates to evaluate (from git log review):

| v2 Commit | Description | v1 Applicability |
|---|---|---|
| `2d6fb70` | Offline queue encrypt-first | HIGH — v1 has offline queue in `src/client/lib/offline-queue.ts` |
| `e3d548c` | Config validation whitespace/hex | MEDIUM — v1 has `src/worker/lib/config.ts` |
| `70d6101` | Startup env var validation | HIGH — v1 needs same validation on Worker startup |
| `6090b7d` | CI codegen check gate | LOW — v1 doesn't have codegen |
| `2e305c8` | DB idle timeout | N/A — v1 doesn't use PostgreSQL |
| `fbcb6e3` | Silent catch logging | HIGH — applies to any codebase |
| `2aa63bde` | CORS env var | MEDIUM — v1 may need same for self-hosted Docker |

### 4.2 Offline queue encrypt-first (HIGH priority backport)

File: `src/client/lib/offline-queue.ts`

V2 commit `2d6fb70` fixes a security bug: the offline queue was saving plaintext to localStorage before encryption. The fix encrypts first, never writes plaintext.

Check v1's implementation — if it has the same pattern, port the fix immediately as a P0 security fix.

### 4.3 Config validation hardening

File: `src/worker/lib/config.ts` (check existence)

Port v2 commit `e3d548c`: whitespace-in-env-var rejection, lowercase hex enforcement for secrets, explicit error messages on startup failure.

### 4.4 Silent catch logging

Search all `catch` blocks in `src/worker/` and `src/client/` for empty catches or catches that only rethrow. Port the v2 pattern of logging at minimum: `console.error('[module] operation failed:', err)` before re-throwing or ignoring. This is required for observability.

---

## Phase 5 — Feature Completeness Audit

**Priority: P2** — Systematic verification of claimed epics.

### 5.1 Audit checklist

For each epic in `docs/COMPLETED_BACKLOG.md`, verify it works end-to-end in the Docker self-hosted stack:

- [ ] **Call routing** — make a test call, confirm parallel ring, confirm first-pickup termination
- [ ] **E2EE notes** — create a note, verify it is encrypted at rest in SettingsDO storage, decrypt it on the client
- [ ] **Audit log** — create a note and answer a call, verify audit entries exist with correct `previousEntryHash` chain
- [ ] **Reproducible builds** — run `scripts/verify-build.sh`, confirm CHECKSUMS.txt matches
- [ ] **Hub switcher** — switch active hub, verify data reload (calls, shifts, notes) scoped to new hub
- [ ] **Messaging (ConversationDO)** — send a test SMS webhook, verify it appears in conversations UI
- [ ] **Transcription** — verify WASM Whisper loads without errors in the browser console
- [ ] **WebAuthn** — register a device, log in with it

### 5.2 API coverage gap

Compare `src/worker/routes/*.ts` against `tests/*.spec.ts`. Any route with no test coverage is a gap. Add tests to `tests/api-helpers.ts` and the relevant spec file.

---

## Execution Order & Dependencies

```
Phase 1 (cross-hub subscriptions)
  └── depends on: understanding of hub key architecture (done)
  └── blocks: Phase 2 E2E tests (cross-hub call ring test needs multi-hub subscriptions)

Phase 2 (hub lifecycle)
  └── depends on: nothing — can run in parallel with Phase 1
  └── blocks: E2E test isolation (parallel test runs)

Phase 3 (isolation audit)
  └── depends on: nothing — read-only audit
  └── any FAIL found blocks release

Phase 4 (backports)
  └── depends on: nothing — independent
  └── offline queue fix (if needed) becomes P0, breaks ordering

Phase 5 (completeness audit)
  └── depends on: Phases 1-3 complete
  └── any P0 found restarts priority order
```

---

## Commit Strategy

- Each phase gets its own commit (or commits for large phases).
- Run `bun run typecheck && bun run build` before every commit.
- Run `bunx playwright test` after each phase to confirm no regressions.
- Tag the completion of Phase 3 isolation audit with a git note documenting the audit results.

---

## Key File Reference

| File | Purpose |
|---|---|
| `src/client/lib/nostr/relay.ts` | RelayManager — needs multi-hub key resolution |
| `src/client/lib/nostr/context.tsx` | NostrProvider — needs `getHubKey(hubId)` signature |
| `src/client/lib/nostr/hooks.ts` | `useNostrSubscription` — needs multi-hub variant |
| `src/client/lib/hooks.ts` | `useCalls()` — subscribes only to active hub (gap) |
| `src/client/routes/__root.tsx` line 162 | `NostrWrappedLayout` — single-key `getHubKey` (gap) |
| `src/worker/routes/hubs.ts` | Missing `DELETE /:hubId` and `POST /:hubId/archive` |
| `src/worker/durable-objects/settings-do.ts` line 694 | `archiveHub()` exists, `deleteHubFull()` missing |
| `src/worker/durable-objects/call-router.ts` | Needs active-call-count endpoint for safety gate |
| `tests/multi-hub.spec.ts` | Extend with hub lifecycle and cross-hub call tests |
| `tests/helpers.ts` | Add `createTestHub` / `deleteTestHub` helpers |
| `~/projects/llamenos/apps/worker/services/settings.ts` lines 1522–1646 | V2 cascade delete reference implementation |
| `~/projects/llamenos/src/client/lib/nostr/relay.ts` | V2 RelayManager — single-hub key only (same gap, different key source) |
