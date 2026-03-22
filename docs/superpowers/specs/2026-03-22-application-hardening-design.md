# Application Hardening & Gap Filling — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Systematically identify and fix gaps in v1's existing features, with particular focus on multi-hub functionality which has incomplete pieces. Borrow proven improvements from v2 where applicable. V1 scope: perfecting the hotline/crisis response use case — no CRM, CMS, or mobile clients.

This is an ongoing workstream. This spec covers the audit and prioritization process, plus the highest-priority known gaps. Individual features will get their own implementation plans as they're uncovered.

---

## 1. Multi-Hub — Architecture Model & Known Gaps

Multi-hub (Epics 60–63) is implemented but has incomplete pieces. The reference implementation is in v2 (~/projects/llamenos), last 20–40 commits. Use those commits as the authoritative design when implementing v1 gaps.

### Architecture model (from v2)

**Active hub:** Each user has an "active hub" — the hub they are currently operating in. Most UI features and data access are scoped to the active hub. This is a security boundary, not just UX.

**Cross-hub features (transcend active hub):** Inbound calls and notifications must work across ALL hubs where the user is currently on shift — not just the active hub. A volunteer on shift in Hub A and Hub B must receive calls from both simultaneously, even if their active hub is Hub A.

**Per-hub roles:** Users have roles per hub. The same user can be a volunteer in Hub A and an admin in Hub B. Some roles allow hub switching or cross-hub visibility. Default: users see only their active hub's data.

### 1.1 Cross-hub call reception

**Gap:** Client must subscribe to call notifications for all hubs where the user is on shift, not just the active hub.

**Required behavior:**
- On login/shift-start, client fetches all hubs where user is currently on shift
- Client subscribes using the hub key for each of those hubs (not just active hub key)
- Incoming call UI shows which hub the call is for, even when it's not the active hub
- `CallRouterDO` is already hub-scoped (keyed per hub) — verify this and confirm parallel ring only targets that hub's on-shift volunteers

### 1.2 Cross-hub notifications

**Gap:** Nostr kind 20001 event subscription must cover all on-shift hubs.

**Required behavior:**
- Client decrypts events using the hub key of each hub it's subscribed to
- Event handler routes each event to the correct hub's state (not always the active hub)
- Admin subscribes to all hubs they manage, not just the active hub

### 1.3 Per-hub resource isolation (security)

**Required behavior (verify each):**
- `SettingsDO`: verify telephony config, custom fields, call settings are not readable across hub boundaries
- `RecordsDO`: notes and call records queries must include hub scoping — no cross-hub data leakage
- `ShiftManagerDO`: hub admins can only manage their own hub's shifts
- Ban lists: per-hub bans by default; no automatic cross-hub propagation unless global ban flag set

### 1.4 Hub switcher data refresh

**Required behavior:**
- Switching active hub triggers full data reload: calls, current shift, conversations, notes
- Active hub persists in session (survives page refresh)
- Hub context visible throughout UI (header indicator)

### 1.5 Hub deletion / archiving — MISSING FEATURE

**Gap:** Hub deletion and archiving do not exist. This is critical for:
1. **Cleanup:** operators need to remove test/stale hubs
2. **Parallel testing:** hub creation+deletion enables fast, isolated E2E test environments

**Required behavior:**
- **Archive:** soft-delete — hub is hidden from active lists, no new calls/shifts, data retained
- **Delete:** hard-delete (admin only) — cascades to: volunteer hub assignments (remove), shifts (mark ended), call history (retain in records with tombstone), settings (delete), telephony provider config (disable)
- **UI:** hub management page gains Archive and Delete actions with confirmation dialogs
- **API:** `DELETE /api/hubs/:hubId` and `POST /api/hubs/:hubId/archive`
- **Safety gate:** cannot delete a hub with an active call in progress
- **E2E testing:** add hub lifecycle to global-setup/teardown so tests can create isolated hubs and delete them after

---

## 2. V2 Backport Candidates

Review v2 (~/projects/llamenos) for improvements applicable to v1. **Exclude:** CRM/CMS features, mobile/desktop clients, monorepo structure, i18n package refactor.

**Likely backport candidates (to be verified against v2 codebase):**

| Area | What to check in v2 |
|---|---|
| Security | Any new security fixes since v1's last sync (March 2026) |
| PostgreSQL shim | Improvements to `storage.transaction()`, advisory locks, connection pooling |
| Bun runtime | Already planned in Foundation Tooling workstream |
| Error handling | Better error boundaries, structured error responses |
| Nostr publisher | Improvements to `NostrPublisher` reliability/reconnection |
| Hub key rotation | Any improvements to the rotation flow on member departure |
| API response consistency | Standardized error format, pagination, etc. |

Backport process: read v2 git log since the last common commit, identify non-CRM/CMS changes, evaluate each for v1 applicability.

---

## 3. Audit Process

### 3.1 Feature completeness audit

Walk through every epic in `docs/COMPLETED_BACKLOG.md` and verify the implementation actually works end-to-end in the Docker self-hosted stack (not just CF Workers). All seven DOs must be audited: CallRouterDO, ShiftManagerDO, SettingsDO, RecordsDO, ConversationDO, IdentityDO, BlastDO.

- Telephony: does call routing work with each provider adapter in Docker mode?
- Messaging: do SMS/WhatsApp/Signal webhooks route correctly to ConversationDO?
- E2EE: do note/message decrypt properly on the client after encrypt-on-save?
- Reproducible builds: does `scripts/verify-build.sh` pass?
- Audit log: is the hash chain intact across a series of calls/notes?

### 3.2 API contract audit

Verify all documented API routes in `src/worker/routes/` have corresponding E2E test coverage. Use the coverage gap doc from the E2E Test Improvements workstream.

### 3.3 Security regression check

Re-run the checklist from `docs/security/DEPLOYMENT_HARDENING.md` against the current codebase to confirm all audit findings are still fixed and haven't regressed.

---

## 4. Prioritization Framework

Issues discovered in the audit are prioritized as:

1. **P0 — Data corruption or security regression**: fix immediately, block release
2. **P1 — Feature broken in primary deployment path (Docker/Ansible)**: fix before customer onboarding
3. **P2 — Feature broken in CF Workers demo only**: fix before marketing launch
4. **P3 — UX gap or missing polish**: fix post-launch, add to backlog

---

## 5. Individual Plans

Each P0/P1 gap discovered gets its own implementation plan (invoked via `writing-plans` skill). This spec serves as the audit framework. Specific multi-hub gaps (section 1) are P1 and will be planned immediately after this workstream's audit phase.

---

## Out of Scope

- CRM / client management features (v2 only)
- Mobile/desktop clients (v2 only)
- New telephony providers beyond current 5
- New messaging channels beyond current 3 (SMS, WhatsApp, Signal, RCS)
- Marketing site changes
