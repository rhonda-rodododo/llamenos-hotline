# GDPR Compliance Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the four GDPR requirements: data export, right to erasure, retention policy enforcement, and consent tracking.

**Spec:** See `docs/superpowers/specs/2026-03-22-gdpr-compliance-design.md`

**Assumes:** Drizzle migration complete (see `cf-removal-drizzle-migration-plan.md`). If implementing pre-Drizzle, use DO classes and `do-access.ts` patterns; same logic applies.

---

## Phase 1: Consent Tracking

### 1.1 Database schema (Drizzle)
- [x] Add `consent_version VARCHAR(20) NULLABLE` and `consented_at TIMESTAMPTZ NULLABLE` columns to `volunteers` table in `src/server/db/schema/identity.ts`
- [x] Run `bunx drizzle-kit generate` to create migration
- [x] Add `consentVersion: string | null` and `consentedAt: Date | null` to the Volunteer Zod schema in `src/server/schemas/identity.ts`

### 1.2 Consent API routes
- [x] Add `GET /api/gdpr/consent` to new file `src/server/routes/gdpr.ts`
  - Reads `consent_version` / `consented_at` for `req.volunteer.pubkey`
  - Returns `{ hasConsented: bool, consentVersion: string | null, consentedAt: ISO | null, currentPlatformVersion: string }`
  - `currentPlatformVersion` is a constant `CONSENT_VERSION = "2026-03-22"` in `src/shared/types.ts`
- [x] Add `POST /api/gdpr/consent` to `src/server/routes/gdpr.ts`
  - Body: `{ version: string }` (validated with Zod)
  - Validates version matches `CONSENT_VERSION`
  - Sets `consent_version` and `consented_at = NOW()` for the volunteer
  - Returns 204
- [x] Register GDPR router in `src/server/app.ts` under `/api/gdpr`
- [x] Add permission guard: `gdpr:consent` permission for volunteers, `gdpr:admin` for admin routes
- [x] Add `gdpr:consent` and `gdpr:admin` to `src/shared/permissions.ts`
- [x] Add to default role definitions in settings seed

### 1.3 Frontend consent gate
- [x] Add `useConsent()` hook in `src/client/lib/consent.ts`
  - Calls `GET /api/gdpr/consent` on mount
  - Returns `{ needsConsent: bool, submitConsent: (version) => Promise<void> }`
- [x] Create `ConsentGate` component in `src/client/components/consent-gate.tsx`
  - Full-screen overlay (non-dismissable)
  - Shows privacy summary (translatable strings in all 13 locales)
  - "Scroll to read" requirement (scroll event tracks if user reached bottom)
  - "I agree" button only enabled after scroll
  - On submit: POST consent → hides gate
- [x] Wrap `AuthProvider` children in `ConsentGate` in `src/client/lib/auth.tsx`
  - Only shown when `isKeyUnlocked && needsConsent`
- [x] Add i18n keys for consent UI to all 13 locale files
- [x] Add `CONSENT_VERSION` constant to `src/shared/types.ts`

---

## Phase 2: Data Export

### 2.1 Export route
- [x] Add `GET /api/gdpr/export` to `src/server/routes/gdpr.ts`
  - Aggregates data from all services for requesting volunteer
  - Returns JSON with categories: `{ profile, sessions, credentials, shifts, calls, notes, auditLog, hubs, exportedAt, version }`
  - Response header: `Content-Disposition: attachment; filename="llamenos-export-YYYYMMDD.json"`
- [x] Add `GET /api/gdpr/export/:pubkey` for admins (requires `gdpr:admin` permission)
  - Audit-logs the export event: `event: "gdprExportRequested", details: { targetPubkey }`
- [x] Implement export aggregation in `src/server/services/gdpr.ts` (new service):
  - `exportForVolunteer(pubkey: string): Promise<GdprExport>`
  - Calls `identityService.getVolunteer()`, `identityService.listSessions()`, `identityService.listCredentials()`
  - Calls `shiftService.listAssignmentsForVolunteer()`
  - Calls `recordsService.listCallsForVolunteer()` (metadata only)
  - Calls `recordsService.listNotesForVolunteer()` (ciphertext envelopes — server cannot decrypt)
  - Calls `recordsService.listAuditEntriesForActor()`
  - Calls `settingsService.listHubMemberships()`
- [x] Add `GdprExport` Zod schema to `src/server/schemas/gdpr.ts` (new file)

### 2.2 Frontend export button
- [x] Add "Download my data" button to `src/client/routes/preferences.tsx`
  - Triggers `GET /api/gdpr/export` and downloads the JSON file
  - Shows loading state, error handling
- [x] Add i18n keys for export UI

---

## Phase 3: Right to Erasure

### 3.1 Erasure route
- [x] Add `DELETE /api/gdpr/me` to `src/server/routes/gdpr.ts`
  - Creates erasure request with 72-hour delay: `{ pubkey, requestedAt, executeAt: now+72h, status: "pending" }`
  - Stores request in `gdpr_erasure_requests` table
  - Sends confirmation to volunteer (Nostr event or in-app notification)
  - Returns 202 Accepted
- [x] Add `DELETE /api/gdpr/:pubkey` (admin-initiated, immediate)
  - Requires `gdpr:admin` permission
  - Calls `gdprService.eraseVolunteer(pubkey)` immediately
  - Audit-logs: `event: "gdprErasureExecuted", details: { targetPubkey, initiator: adminPubkey }`
- [x] Add `DELETE /api/gdpr/me/cancel` — cancel pending self-erasure request

### 3.2 Erasure database schema
- [x] Add `gdpr_erasure_requests` table to `src/server/db/schema/gdpr.ts` (new file):
  ```
  pubkey VARCHAR(64) PRIMARY KEY
  requested_at TIMESTAMPTZ NOT NULL
  execute_at TIMESTAMPTZ NOT NULL
  status VARCHAR(20) NOT NULL DEFAULT 'pending'  -- pending | cancelled | executed
  ```
- [x] Run `bunx drizzle-kit generate`

### 3.3 Erasure service
- [x] Implement `GdprService.eraseVolunteer(pubkey)` in `src/server/services/gdpr.ts`:
  - Delete WebAuthn credentials for pubkey
  - Revoke all sessions for pubkey
  - Delete shift assignments
  - Delete volunteer record (name, phone hash, spoken languages)
  - In notes: delete the volunteer's author envelope (server stores per-reader envelopes; delete theirs)
  - In call records: replace `answeredByPubkey` with `"[erased]"`
  - In audit log: replace `actorPubkey` with `"[erased]"`, add `erased: true` flag, recompute hashes forward
  - Delete provisioning rooms
  - Delete GDPR erasure request (after 30 days, via retention)
- [x] Add erasure job to cron/alarm poller: daily scan for `execute_at <= NOW()` pending requests → execute

### 3.4 Frontend erasure UI
- [x] Add "Request account deletion" section to `src/client/routes/preferences.tsx`
  - Shows warning: "72-hour review period", lists what will be deleted
  - Requires PIN re-entry to confirm
  - After submission: shows countdown + cancel button
- [x] Add i18n keys

---

## Phase 4: Data Retention Policy

### 4.1 Retention settings schema
- [x] Add `retention_settings` JSONB column to `settings` table or separate `retention_settings` table
- [x] Zod schema for `RetentionSettings`:
  ```typescript
  {
    callRecordsDays: number,    // 30–3650, default 365
    notesDays: number,          // 30–3650, default 365
    messagesDays: number,       // 30–3650, default 180
    auditLogDays: number,       // 365–3650, default 1825
  }
  ```

### 4.2 Retention API routes
- [x] Add `GET /api/settings/retention` to `src/server/routes/settings.ts`
- [x] Add `PUT /api/settings/retention` (admin only) with Zod validation

### 4.3 Retention enforcement
- [x] Create `src/server/jobs/retention-purge.ts`:
  - `purgeExpiredData(db: Database, settings: RetentionSettings): Promise<PurgeSummary>`
  - Deletes call records older than `callRecordsDays`
  - Deletes notes older than `notesDays`
  - Deletes messages older than `messagesDays`
  - Deletes audit entries older than `auditLogDays`
  - Returns counts of deleted records
- [x] Wire retention purge to alarm poller: run daily at 03:00 UTC
- [x] Add audit log event for purge runs: `event: "dataRetentionPurge", details: { counts }`

### 4.4 Retention settings UI
- [x] Add "Data retention" section to `src/client/routes/admin/settings.tsx`
  - Number inputs for each category (with min/max enforcement)
  - Save button
  - Shows "Next purge: in X hours" based on last run timestamp
- [x] Add i18n keys

---

## Phase 5: E2E Tests

- [x] Create `tests/gdpr.spec.ts`:
  - Consent gate shown on first login, hidden after consent
  - Consent gate shown again after version bump
  - Data export downloads JSON with expected keys
  - Self-erasure request created, visible, cancelable
  - Admin erasure executes immediately
  - Retention settings saved and reflected in API
  - Verify audit log entry `actorPubkey` replaced with `[erased]` after erasure

---

## Completion Checklist

- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] All GDPR routes return correct HTTP status codes
- [x] Consent gate renders in all 13 locales (spot-check: en, es, ar RTL)
- [x] Export JSON is valid and contains all expected categories
- [x] Erasure removes all personal data verifiable via export (export after erasure = no PII)
- [x] Retention purge runs and audit logs the result
- [x] E2E tests pass
