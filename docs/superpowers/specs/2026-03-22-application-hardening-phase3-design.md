# Application Hardening Phase 3 — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Context

`docs/superpowers/specs/2026-03-22-application-hardening-design.md` covers Phases 1 and 2 of application hardening. Phase 3 expands on underspecified items in that document and adds newly discovered gaps. This spec is a companion to the existing hardening design, not a replacement.

## Scope

Five targeted improvements identified during the comprehensive platform audit:

1. Auth middleware TypeScript correctness (`as any` in permission guards)
2. Profile setup completion wiring (setup wizard completion state not persisted correctly)
3. On-break call routing verification
4. Admin active calls widget completeness
5. Call history pagination and search

---

## 1. Auth Middleware Type Safety

**Problem:** `AppEnv` (defined in `src/worker/types.ts`) already correctly types the Hono context `Variables` (`pubkey`, `volunteer`, `permissions`, `allRoles`, `hubId`, `hubPermissions`). The actual issue is narrower: specific `.json()` response casts in the auth/permission middleware use `as any` (e.g. `(await rolesRes.json()) as any`), which bypasses type checking on DO internal fetch responses.

**Design:**
- `AppEnv` is already correct — do NOT redefine or rename it
- Define typed response interfaces for DO internal fetch calls, for example:
  ```typescript
  interface RolesResponse { roles: Role[] }
  ```
- Replace `as any` casts on `.json()` calls with these typed interfaces (or use Zod parsing for runtime safety)
- All `as any` assertions must be removed from auth and permission middleware
- `bun run typecheck` must pass with no `as any` in auth middleware

---

## 2. Profile Setup Completion Wiring

**Problem:** The profile setup wizard at `/profile-setup` walks through: name → phone → spoken languages → device setup. After completing all steps, it may not correctly mark the volunteer profile as "setup complete," leaving the volunteer stuck if they refresh mid-flow or if the redirect to dashboard doesn't fire.

**Design:**
- Server: the existing field is `volunteer.profileCompleted: boolean` (in `src/worker/types.ts`). This is the field to wire up correctly — do NOT rename it to `setupCompletedAt` unless there is an explicit decision to change the type to `Date | null` for richer completion tracking. If such a rename is desired, it must be treated as a schema migration with rationale: `boolean` is simpler; `Date | null` enables "completed X days ago" display and audit. Decide before implementing and update this spec.
- Client: completion check on the profile setup route:
  - If `profileCompleted` is already `true` → redirect to `/` immediately (no need to show wizard)
  - After final wizard step → `PATCH /api/volunteers/me { profileCompleted: true }` → redirect to `/`
- Navigation guard: if `profileCompleted` is `false` and user navigates away from `/profile-setup`, show a warning "Your profile isn't complete yet"

**Fields required for setup completion:** name (non-empty), at least one spoken language selected.

**Phone is optional** (some volunteers don't want to provide a phone; this should not block setup).

---

## 3. On-Break Call Routing Verification

**Problem:** Volunteers can set themselves as "on break" via a status toggle. The expected behaviour is that on-break volunteers are excluded from the parallel ring group. This has not been verified end-to-end in tests.

**Design:**
- The UI toggle and server-side exclusion from the ring group already exist. The remaining gap is test coverage confirming the integration end-to-end.
- Verify (read) the ShiftManager / ring group query that determines who to ring:
  - Must exclude volunteers where `onBreak = true`
  - If the check is missing, fix the query — otherwise proceed directly to the test
- No new feature — this is a verification and test task

**Remaining gap:** A call-flow E2E test confirming that when an on-break volunteer's status is set, an inbound call does NOT cause ringing UI to appear in their browser.

**Test:** Volunteer marks themselves on-break → simulated inbound call → on-break volunteer's browser does NOT show ringing UI.

---

## 4. Admin Active Calls Widget

**Problem:** The dashboard shows active call count and a simplified list of active calls. Gaps:
- No click-through from the active call to the call detail page
- No way to see which volunteer is currently on the call
- "Answer" button may appear for calls already answered (stale state)

**Design:**
- Each row in the active calls widget shows: caller last4, time since ringing/answered, status badge, assigned volunteer name (if answered)
- Row is clickable → `/calls/:callId`
- If call is already answered by another volunteer: show "In progress — [Volunteer Name]" (no answer button)
- Poll every 5 seconds (or use Nostr event subscription) to keep list fresh
- If no active calls: show "No active calls" empty state (not a blank widget)

---

## 5. Call History Pagination and Search

**Problem:** `GET /api/calls` and the call history list at `/calls` return all calls for the hub. As call volume grows, this becomes slow and unwieldy.

**Design:**
- `GET /api/calls?page=1&limit=25&q=&status=` server-side pagination
- Default: 25 per page, ordered by `created_at DESC`
- Optional filters: `status` (answered/voicemail/missed), `q` (search by callerLast4 or date range)
- Client: infinite scroll or pagination controls in call history list
- "No calls found" empty state for empty filtered results

**Note:** Full-text search across note content is NOT included here (E2EE prevents server-side search; that's a future client-side search feature). Search is limited to call metadata (callerLast4, date range, status).

---

## Testing

1. `bun run typecheck` passes with no `as any` in auth middleware
2. Profile setup wizard: completing all steps marks `profileCompleted: true`; refresh mid-flow → wizard resumes
3. On-break volunteer: inbound call does not ring their browser
4. Active calls widget: clicking a row navigates to call detail; in-progress calls show volunteer name
5. Call history: paginating returns correct page 2 results; filtering by status returns correct subset
