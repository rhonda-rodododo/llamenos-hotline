# Application Hardening Phase 3 — v2 Feature Backport Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete Application Hardening Phase 3 — which was underspecified in the original spec. Enumerate specific v2 features to audit and backport to v1.

**Context:** The original `2026-03-22-application-hardening-design.md` describes Phase 3 as "audit v2 for additional call routing features". This plan expands that to a concrete feature list based on codebase analysis.

**v2 reference repo:** `~/projects/llamenos` (last 20–40 commits are the source of truth)

---

## Phase 3.1: v2 Feature Audit

Before implementing, run a fresh diff of v2 features not in v1:

- [x] `cd ~/projects/llamenos && git log --oneline -40` — read last 40 commits
- [x] For each v2-only feature below, confirm it exists in v2 and is missing from v1
- [x] Check `~/projects/llamenos/src/` for each area

---

## Phase 3.2: Auth Middleware JSON Validation

**Gap found by code audit:** `src/worker/middleware/auth.ts` uses `(await rolesRes.json()) as any` — untyped DO response cast. `AppEnv` (in `src/worker/types.ts`) already correctly defines all typed Variables; do NOT redefine it.

- [x] Read `src/worker/middleware/auth.ts`
- [x] Identify all `.json() as any` casts on DO internal fetch calls
- [x] For each: define a typed response interface (or Zod schema) and replace `as any`:
  ```typescript
  // Option A: typed interface
  interface RolesResponse { roles: Role[] }
  const { roles } = (await rolesRes.json()) as RolesResponse
  // Option B: Zod (preferred for runtime safety)
  const RolesResponse = z.object({ roles: z.array(RoleSchema) })
  const { roles } = RolesResponse.parse(await rolesRes.json())
  ```
- [x] Add error handling: if parse fails, log error and return 401 (not crash)
- [x] `bun run typecheck` must pass after this change with no `as any` in auth middleware

---

## Phase 3.3: Volunteer Profile Setup Completion Flow

**Gap:** Volunteer "profile setup" gate exists but the completion flow (marking profile as complete) may not be fully wired. The existing field is `volunteer.profileCompleted: boolean` — use this field name as-is unless a deliberate decision is made to change it to `setupCompletedAt: Date | null` (see spec for migration rationale).

- [x] Read `src/client/routes/profile-setup.tsx`
- [x] Verify: profile setup form submits to `PATCH /api/volunteers/me` with `{ profileCompleted: true }` on final step
- [x] Verify: on completion, `profileCompleted: true` is set in auth context
- [x] Verify: subsequent logins skip profile setup gate (redirect to `/` if `profileCompleted` is already `true`)
- [x] Add test to `tests/invite-onboarding.spec.ts`:
  ```
  Given: New volunteer redeems invite code
  When: Completes profile setup form (name, phone, spoken languages)
  Then: profileCompleted = true
  Then: Subsequent login goes directly to dashboard (no profile setup gate)
  ```

---

## Phase 3.4: Volunteer "On Break" Status

**Gap:** Break toggle and server-side ring group exclusion already exist. The remaining gap is a call-flow E2E test confirming the integration end-to-end.

- [x] Read the ring group query in `src/worker/durable-objects/shift-manager-do.ts` (CF path) and/or the Bun server equivalent (`src/server/services/` or `src/worker/services/ringing.ts`) — verify on-break volunteers are excluded (`onBreak: false` filter in the query)
- [x] If the `onBreak` check is missing from the ring group query, fix it first
- [x] Add E2E test confirming that an on-break volunteer's browser does NOT show ringing UI when an inbound call arrives:
  ```
  Given: Volunteer A is on shift and NOT on break
  Given: Volunteer B is on shift AND on break
  When: Simulate inbound call
  Then: Call rings Volunteer A's browser
  Then: Volunteer B's browser does NOT show ringing UI
  ```

---

## Phase 3.5: Call Transfer / Warm Handoff

> **OUT OF SPEC — DISCOVERY ONLY.** Do not implement until a dedicated design spec is written.

- [x] Check `~/projects/llamenos/src/` for "transfer" patterns in call routes
- [x] If found in v2: document the approach and create a new spec (`2026-03-22-call-transfer-design.md`) before any implementation
- [x] If not in v2: mark as future work, skip

---

## Phase 3.6: Notes Reply Threading

> **OUT OF SPEC — DISCOVERY ONLY.** Do not implement until a dedicated design spec is written.

- [x] Check `~/projects/llamenos/src/` for "note reply" or "noteReply" patterns
- [x] If found in v2: document and create a new spec before implementation
- [x] If not in v2: leave Epic 123 placeholder, skip

---

## Phase 3.7: Dashboard Active Calls Display

**Check:** Does the volunteer dashboard show a real-time "currently active calls" summary for admins (not just incoming rings)?

- [x] Check admin dashboard (`/src/client/routes/index.tsx`) for active call summary widget
- [x] Verify: admin sees all currently active calls (ongoing), not just ringing
- [x] Verify: shows volunteer name, caller ID (anonymised), duration
- [x] If missing: add active calls widget to admin dashboard using `GET /api/calls/active`
- [x] E2E test: simulate active call → verify admin dashboard shows it with duration

---

## Phase 3.8: Call History Pagination & Search

**Check:** Is call history paginated? Can admin search/filter by date, volunteer, or duration?

- [x] Read `src/worker/routes/calls.ts` — verify pagination params exist (`offset`, `limit`)
- [x] Read admin call history page — verify pagination UI
- [x] If pagination missing: add `page` + `limit` params to `GET /api/calls` (page-based: `?page=1&limit=25`, default 25 per page ordered `created_at DESC`)
- [x] Verify date range filter exists
- [x] Verify volunteer filter (admin can filter by which volunteer answered)
- [x] E2E test: create 20+ call records, verify pagination works

---

## Phase 3.9: Conversation Auto-Assignment Rules

> **OUT OF SPEC — DISCOVERY ONLY.** Do not implement until a dedicated design spec is written.

- [x] Check v2 for "auto-assign" or "assignment rules" in conversation DO
- [x] If found in v2: document and create a new spec before implementation
- [x] If not in v2: skip

---

## Phase 3.10: Delete Hub Cascade (Already in Hardening Plan)

- [x] This is already specified in `2026-03-22-application-hardening-design.md` Phase 2
- [x] No duplication needed here — track completion via Phase 2 checkboxes

---

## Completion Checklist

- [x] Auth middleware: `as any` removed, Zod validation added
- [x] Profile setup: completion flag set correctly, gate bypassed on subsequent login
- [x] On-break: call routing excludes on-break volunteers
- [x] Call transfer: audited in v2 (defer implementation to new spec if found)
- [x] Note replies: audited in v2 (defer implementation to new spec if found)
- [x] Admin active calls dashboard widget: shows ongoing calls with duration
- [x] Call history: pagination and date/volunteer filter working
- [x] Conversation auto-assignment: audited in v2 (defer implementation to new spec if found)
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] All new functionality has E2E tests
