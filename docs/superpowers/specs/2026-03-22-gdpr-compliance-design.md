# GDPR Compliance Layer — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

The platform processes personal data of EU-based users (volunteers and callers) on behalf of an EU-registered crisis hotline organisation. GDPR compliance is non-optional before launch. This spec covers the four minimum-viable GDPR requirements: right to access (data export), right to erasure, data retention policy enforcement, and consent tracking.

This spec does NOT cover legal documentation (privacy policy text, DPA templates) — those are an ops/legal task outside the codebase.

---

## 1. Right to Access (Data Export)

### Requirement
Any volunteer must be able to request a machine-readable export of all personal data the platform holds about them. Admins must be able to export on behalf of a user or pull the full org export.

### Data in scope

| Category | What we export | Notes |
|---|---|---|
| Identity | Name, phone (E.164 hashed, not plaintext), public key, spoken languages, UI language | Phone is HMAC-hashed at rest — export the hash, not plaintext (we don't have plaintext) |
| Sessions | Session creation timestamps, device labels, last-seen | No session tokens (security) |
| WebAuthn credentials | Credential labels, creation dates, last-used | Not the raw key bytes |
| Shift assignments | Shift names, dates, assigned times | |
| Call records (metadata) | Call IDs, timestamps, duration, answeredBy (self) | Admin can see all records; volunteer sees only their own |
| Notes (metadata) | Note IDs, call IDs, timestamps | Content is E2EE; server cannot decrypt — export the ciphertext envelopes |
| Audit log entries | Own entries (actor=self) | Admin sees all |
| Hub memberships | Hub names, roles | |

### Export format
JSON with top-level keys per category. Must be deterministic and downloadable. Export is not encrypted (handled over TLS); optionally the caller can request envelope-re-encryption with their own public key.

### API

```
GET /api/gdpr/export            → 200 { profile, sessions, credentials, shifts, calls, notes, auditLog, hubs }
GET /api/gdpr/export/:pubkey    → admin only, export for specific volunteer
```

Response includes `exportedAt` ISO timestamp and `version: "1.0"` for future format upgrades.

---

## 2. Right to Erasure (Deletion + Cascade)

### Requirement
A volunteer has the right to request deletion of their account and all personal data. This is separate from an admin removing a volunteer from the system; this is a full data purge.

### Existing deletion gap
`DELETE /api/volunteers/:pubkey` exists and revokes sessions, but it is not confirmed to cascade-delete all of the following:
- Notes authored by the volunteer
- Call records where volunteer was the answerer
- Audit log entries where volunteer was the actor (GDPR: right to erase; **but** audit log integrity may conflict — see tension below)
- WebAuthn credentials
- Shift assignments
- Provisioning rooms

### Tension: audit log vs. erasure
GDPR erasure applies to personal data. The audit log records actions by pubkey. On erasure:
- Option A: Delete the actor pubkey from audit entries (replace with `[deleted]`) — preserves chain integrity, loses actor identity
- Option B: Delete the entire audit entry — breaks hash chain
- **Decision: Option A** — replace `actorPubkey` with `"[erased]"` in all audit entries, recompute hashes forward from the modified entry. Add `erasedAt` flag to entries where this occurred.

### Self-service vs. admin-initiated

| Path | Initiator | Effect |
|---|---|---|
| `DELETE /api/gdpr/me` | Volunteer (self) | Full erasure with 72-hour delay + confirmation email-equivalent |
| `DELETE /api/gdpr/:pubkey` | Admin | Immediate full erasure |

The 72-hour delay for self-service gives admins a window to flag if the account is under active incident review.

---

## 3. Data Retention Policy

### Requirement
Personal data must not be kept longer than necessary. The platform should automatically purge data after configurable retention windows.

### Retention categories

| Data type | Default retention | Configurable by admin |
|---|---|---|
| Call records (metadata) | 365 days | Yes (30–3650 days) |
| Call notes (ciphertext) | 365 days | Yes |
| Messages / conversations | 180 days | Yes |
| Audit log entries | 1825 days (5 years) | Yes (min 365) |
| Sessions | 30 days (inactivity) | No |
| Provisioning rooms | 24 hours | No |
| GDPR erasure requests | 30 days | No |

### Implementation model
- Retention settings stored in `SettingsService` (or `SettingsDO` pre-Drizzle)
- A daily alarm/cron job scans for records past their retention window and deletes them
- Deletion is logged to the audit log as `dataRetentionPurge` event (without personal data in the event body)
- Records nearing retention limit (within 30 days) are visible in the admin dashboard

---

## 4. Consent Tracking

### Requirement
Volunteers must explicitly consent to data processing before their first login completes. The consent record must include the consent version and timestamp.

### Consent model
- Consent is a boolean + version string stored per volunteer in `IdentityService`
- Consent version is a simple incrementing string (e.g., `"2026-03-01"`)
- If the platform's consent version is bumped, all users must re-consent on next login
- Consent is collected during the onboarding flow (after keypair setup, before profile setup)

### API

```
GET  /api/gdpr/consent          → { hasConsented: bool, consentVersion: string, consentedAt: ISO | null }
POST /api/gdpr/consent          → { version: string } → 204
```

### UI gate
On login, after PIN unlock but before the app shell loads:
1. Check `GET /api/gdpr/consent`
2. If `!hasConsented` or `consentVersion !== currentPlatformVersion`, show a non-dismissable consent screen
3. User must scroll to bottom + click "I agree" before proceeding
4. POST to `/api/gdpr/consent` then continue

---

## 5. Out of Scope (Pre-Launch Non-Blockers)

These are real requirements but don't need to ship with initial launch:

- **Subprocessor register**: Documentation of Twilio, Hetzner, Backblaze as subprocessors
- **Privacy notice**: The actual legal text of the privacy notice (content task)
- **DPA template**: Data Processing Agreement for orgs deploying this platform
- **Data portability in interoperable format**: JSON is sufficient for now; CSV/vCard export is future
- **Cookie consent**: No cookies used (sessionStorage only) — no cookie banner needed

---

## 6. Security Notes

- The data export endpoint must respect E2EE: export note and message ciphertext, not plaintext. The server cannot decrypt these.
- The export response itself is served over HTTPS only; no additional envelope encryption unless the volunteer requests it
- Admin export of another user's data must be audit-logged
- GDPR erasure requests must themselves be logged (but the log entry for the erasure request is deleted after 30 days)

---

## 7. Dependencies

- **IdentityService** (or `IdentityDO`): consent fields, volunteer deletion
- **RecordsService** (or `RecordsDO`): notes, calls, audit log purge
- **SettingsService** (or `SettingsDO`): retention window config
- **ShiftService** (or `ShiftManagerDO`): shift assignment cleanup
- **ConversationService** (or `ConversationDO`): message purge

> **Note:** This spec is written assuming the Drizzle migration (see `cf-removal-drizzle-migration-plan.md`) is complete. If implementing before migration, use the equivalent DO classes and `do-access.ts` patterns instead.
