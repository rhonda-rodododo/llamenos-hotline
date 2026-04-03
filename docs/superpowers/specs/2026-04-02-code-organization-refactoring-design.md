# Spec: Code Organization & Refactoring

**Date:** 2026-04-02
**Priority:** Medium (Code Quality)
**Status:** Draft

## Overview

Several files have grown beyond maintainable size. This spec covers splitting monolithic files, standardizing route patterns, migrating decryptHubField calls to the decrypt-in-queryFn pattern, and cleaning up debug logging.

---

## Issue 1: Monolithic Files

### api.ts (2,325 lines, ~201 exported functions)

`src/client/lib/api.ts` contains ALL API client functions across 41+ domains. Split into domain-specific modules with a barrel re-export.

**Proposed Split:**

| New File | Domain | ~Functions |
|----------|--------|-----------|
| `api/auth.ts` | Login, bootstrap, logout, getMe | 4 |
| `api/users.ts` | User CRUD, profile, availability, unmasking | 10 |
| `api/calls.ts` | Active calls, history, answer, hangup, analytics | 11 |
| `api/contacts.ts` | Contact CRUD, relationships, bulk, notifications | 15 |
| `api/conversations.ts` | Conversations, messages, stats | 8 |
| `api/reports.ts` | Reports, report types, file management | 18 |
| `api/blasts.ts` | Blasts, subscribers, blast settings | 9 |
| `api/hubs.ts` | Hub CRUD, members, encryption, data export | 8 |
| `api/settings.ts` | Spam, call, transcription, IVR, custom fields, geocoding | 20+ |
| `api/telephony.ts` | Provider config, WebRTC, webhooks | 8 |
| `api/invites.ts` | Invite CRUD, redemption, distribution | 6 |
| `api/files.ts` | Upload, download, sharing | 8 |
| `api/index.ts` | Barrel re-export of all modules | — |

The `request()` helper and auth token management stay in a shared `api/client.ts` base.

### settings.ts service (1,439 lines, ~53 methods)

`src/server/services/settings.ts` bundles 20 domains. Split by concern:

| New File | Domain | ~Methods |
|----------|--------|---------|
| `services/spam-settings.ts` | Spam settings, rate limiting, CAPTCHA | 5 |
| `services/call-settings.ts` | Call settings, transcription settings | 4 |
| `services/ivr-settings.ts` | IVR languages, audio files | 6 |
| `services/provider-config.ts` | Telephony provider, OAuth state, credentials | 6 |
| `services/messaging-config.ts` | Messaging config, setup state, channels | 4 |
| `services/hub-management.ts` | Hub CRUD, hub key management, envelopes | 10 |
| `services/role-management.ts` | Role CRUD | 4 |
| `services/geocoding-config.ts` | Geocoding config | 2 |

### contacts.ts route (1,231 lines, 18 endpoints)

`src/server/routes/contacts.ts` — split into:

| New File | Endpoints |
|----------|-----------|
| `routes/contacts/index.ts` | CRUD, list, search, duplicate check |
| `routes/contacts/relationships.ts` | Relationship CRUD, link/unlink |
| `routes/contacts/bulk.ts` | Bulk update, bulk delete |
| `routes/contacts/outreach.ts` | Notifications, call linking |

### server types.ts (988 lines)

`src/server/types.ts` — split into domain-specific type files:

| New File | Categories |
|----------|-----------|
| `types/auth.ts` | UserRole, AuthPayload, ServerSession, WebAuthn types |
| `types/calls.ts` | ActiveCall, CallLeg, CallRecord, CallToken types |
| `types/messaging.ts` | Conversation, Message, Blast, Subscriber types |
| `types/scheduling.ts` | Shift, Schedule, Override, RingGroup types |
| `types/settings.ts` | SpamSettings, CallSettings, IVR, CustomField types |
| `types/index.ts` | Barrel re-export + AppEnv, Env |

---

## Issue 2: Inconsistent Route Patterns

4-5 route files use plain Hono instead of `createRoute()`:

- `auth-facade.ts` — addressed in Schema Alignment spec
- `telephony.ts` — justified (webhook payloads aren't JSON), but should have OpenAPI descriptions
- `contacts-import.ts` — should convert
- `messaging/signal-registration.ts` — should convert

For telephony, add OpenAPI documentation comments even if request validation uses provider-specific parsing.

---

## Issue 3: decryptHubField Migration

75 usages of `decryptHubField` across 22 files. The established pattern is to decrypt inside React Query `queryFn` callbacks, not in components. Many calls are already in query files; the remaining ones in route/component files need migrating.

**Files to migrate (component-level calls):**

| File | Count | Action |
|------|-------|--------|
| `routes/admin/hubs.tsx` | 4 | Move to queries/hubs.ts |
| `routes/blasts.tsx` | 2 | Move to queries/blasts.ts |
| `routes/contacts_.$contactId.tsx` | 2 | Move to queries/contacts.ts |
| `routes/contacts.tsx` | 2 | Move to queries/contacts.ts |
| `routes/shifts.tsx` | 2 | Move to queries/shifts.ts |
| `components/admin-settings/*.tsx` | 9 | Move to respective query files |
| `components/hub-switcher.tsx` | 2 | Move to queries/hubs.ts |

After migration, remove `src/client/lib/hub-field-crypto.ts` if no consumers remain.

---

## Issue 4: Debug Console.log Cleanup

17 `console.log` statements in WebRTC adapters and key-manager:

| File | Count |
|------|-------|
| `lib/webrtc/manager.ts` | 3 |
| `lib/webrtc/adapters/twilio.ts` | 3 |
| `lib/webrtc/adapters/vonage.ts` | 4 |
| `lib/webrtc/adapters/plivo.ts` | 5 |
| `lib/key-manager.ts` | 3 |

Replace with a structured logger (e.g., a simple `createLogger(namespace)` wrapper) that can be silenced in production via environment variable, or remove entirely if they add no diagnostic value.

---

## Testing Strategy

- Each file split must be followed by `bun run typecheck` + `bun run build`
- Import path changes require updating all consumers
- No functional changes — only file organization
- All existing tests must pass after each phase
