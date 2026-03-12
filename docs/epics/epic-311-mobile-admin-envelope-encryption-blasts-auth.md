# Epic 311: Mobile Admin Envelope Encryption & Blasts Authorization

**Status**: PENDING
**Priority**: High
**Depends on**: None
**Blocks**: None
**Branch**: `desktop`

## Summary

Fix two security gaps found during cross-platform audit: (1) iOS and Android create encrypted notes/reports/messages without admin envelopes — admins cannot decrypt volunteer-created content; (2) all 14 blast endpoints lack `requirePermission()` guards — any authenticated user can send blasts and manage subscribers. Also adds missing Zod request body validation to 10 non-dev endpoints.

## Problem Statement

### P1: Mobile encryption sends empty admin envelope list (SECURITY — E2EE compliance)

**Impact**: Notes, reports, and conversation messages created on iOS or Android are encrypted only for the volunteer author. Admins cannot decrypt this content, breaking the dual-encryption architecture (volunteer envelope + admin envelope) documented in PROTOCOL.md.

**Desktop works correctly**: Uses `adminDecryptionPubkey` from `GET /api/auth/me` and includes it in every `encryptNote()` and message encryption call.

**Mobile status**: Both platforms parse `adminDecryptionPubkey` from the auth response but discard it:

- **iOS**: `AppState.swift:398` has `adminDecryptionPubkey: String?` in `AuthMeResponse` but never stores it
  - `NotesView.swift:53` — `adminPubkeys: []`
  - `ReportsViewModel.swift:91` — `adminPubkeys: []`
  - `ConversationsViewModel.swift:141` — `readerPubkeys` only includes self + assigned volunteer
- **Android**: `AuthModels.kt:18` has `adminDecryptionPubkey: String?` in `MeResponse` but never stores it
  - `NotesViewModel.kt:249,368,441` — `encryptNote(payloadJson, emptyList())`
  - `ReportsViewModel.kt:149` — `encryptNote(body, emptyList())`
  - `ConversationsViewModel.kt` — `readerPubkeys` only includes self + assigned volunteer

### P2: Blasts routes missing authorization guards (SECURITY — privilege escalation)

**File**: `apps/worker/routes/blasts.ts`

All 14 blast endpoints are mounted under the `authenticated` Hono group (authentication enforced via middleware in `app.ts:127`), but NONE use `requirePermission()`. Any authenticated user — including basic volunteers and reporters — can:
- Send blasts to all subscribers
- Import/delete subscriber lists
- View/modify blast settings
- Schedule blasts

The permission catalog already defines `blasts:read`, `blasts:send`, `blasts:manage`, and `blasts:schedule` in `packages/shared/permissions.ts:99-102`, but they're never enforced.

### P3: Missing Zod request body validation (10 endpoints)

Epic 283 added Zod validation to most endpoints, but 10 non-dev endpoints still use `c.req.json() as Type`:

- `settings.ts:96` — PUT /custom-fields
- `settings.ts:562` — POST /report-types
- `settings.ts:586` — PATCH /report-types/:id
- `settings.ts:795` — PATCH /ttl
- `bans.ts:34` — POST /bans
- `bans.ts:83` — POST /bans/bulk
- `webauthn.ts:63` — POST /webauthn/authenticate
- `webauthn.ts:115` — POST /webauthn/credentials
- `webauthn.ts:142` — POST /webauthn/register
- `setup.ts:76` — POST /setup

## Implementation

### Task 1: Store `adminDecryptionPubkey` on iOS

**File**: `apps/ios/Sources/App/AppState.swift`

Add a published property and store it from the auth response:

```swift
// In AppState class:
var adminDecryptionPubkey: String?

// In fetchUserRole(), inside MainActor.run:
self.adminDecryptionPubkey = response.adminDecryptionPubkey
```

### Task 2: Wire admin pubkey into iOS encryption calls

**File**: `apps/ios/Sources/ViewModels/NotesViewModel.swift`

The `saveNote()` method already accepts `adminPubkeys: [String]` — callers need to pass the stored value.

**File**: `apps/ios/Sources/Views/Notes/NotesView.swift:53`

```swift
// Before:
adminPubkeys: []  // Fetched from server during encryption

// After:
adminPubkeys: appState.adminDecryptionPubkey.map { [$0] } ?? []
```

**File**: `apps/ios/Sources/ViewModels/ReportsViewModel.swift:91`

```swift
// Before:
let encryptedNote = try cryptoService.encryptNote(payload: body, adminPubkeys: [])

// After:
let encryptedNote = try cryptoService.encryptNote(payload: body, adminPubkeys: adminPubkeys)
```

Where `adminPubkeys` is passed through from AppState.

**File**: `apps/ios/Sources/ViewModels/ConversationsViewModel.swift:141-152`

Add admin pubkey to `readerPubkeys` list:

```swift
// After adding our own pubkey and assigned volunteer:
if let adminPubkey = adminDecryptionPubkey,
   !readerPubkeys.contains(adminPubkey) {
    readerPubkeys.append(adminPubkey)
}
```

### Task 3: Store `adminDecryptionPubkey` on Android

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/ui/dashboard/DashboardViewModel.kt`

The `fetchServerEventKey()` method already calls `GET /api/auth/me`. Store the admin pubkey:

```kotlin
// In DashboardViewModel or a shared AuthRepository:
private val _adminDecryptionPubkey = MutableStateFlow<String?>(null)
val adminDecryptionPubkey: StateFlow<String?> = _adminDecryptionPubkey.asStateFlow()

// In fetchServerEventKey():
_adminDecryptionPubkey.value = meResponse.adminDecryptionPubkey
```

### Task 4: Wire admin pubkey into Android encryption calls

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/ui/notes/NotesViewModel.kt`

Lines 249, 368, 441:

```kotlin
// Before:
val encrypted = cryptoService.encryptNote(payloadJson, emptyList())

// After:
val adminPubkeys = adminDecryptionPubkey.value?.let { listOf(it) } ?: emptyList()
val encrypted = cryptoService.encryptNote(payloadJson, adminPubkeys)
```

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/ui/reports/ReportsViewModel.kt:149`

Same pattern.

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/ui/conversations/ConversationsViewModel.kt`

Add admin pubkey to reader list, same as iOS.

### Task 5: Add `requirePermission()` to all blast endpoints

**File**: `apps/worker/routes/blasts.ts`

Add permission guards to all 14 endpoints:

| Endpoint | Permission |
|----------|-----------|
| GET /subscribers | `blasts:manage` |
| DELETE /subscribers/:id | `blasts:manage` |
| GET /subscribers/stats | `blasts:read` |
| POST /subscribers/import | `blasts:manage` |
| GET / | `blasts:read` |
| POST / | `blasts:send` |
| GET /:id | `blasts:read` |
| PATCH /:id | `blasts:send` |
| DELETE /:id | `blasts:manage` |
| POST /:id/send | `blasts:send` |
| POST /:id/schedule | `blasts:schedule` |
| POST /:id/cancel | `blasts:schedule` |
| GET /settings | `blasts:read` |
| PATCH /settings | `blasts:manage` |

### Task 6: Add Zod schemas for settings endpoints

**File**: `apps/worker/routes/settings.ts`

Add Zod schemas and `validator('json', schema)` for:
- PUT /custom-fields (line 96) — array of CustomFieldDefinition
- POST /report-types (line 562) — `{ name: string; slug?: string; fields?: string[] }`
- PATCH /report-types/:id (line 586) — partial of above
- PATCH /ttl (line 795) — `{ [namespace]: number }` record

### Task 7: Add Zod schemas for bans endpoints

**File**: `apps/worker/routes/bans.ts`

- POST /bans (line 34) — `{ phone: z.string(), reason: z.string() }`
- POST /bans/bulk (line 83) — `{ phones: z.array(z.string()), reason: z.string() }`

### Task 8: Add Zod schemas for webauthn endpoints

**File**: `apps/worker/routes/webauthn.ts`

- POST /authenticate (line 63) — `{ assertion: z.any(), challengeId: z.string() }`
- POST /credentials (line 115) — `{ label: z.string().max(100) }`
- POST /register (line 142) — `{ attestation: z.any(), label: z.string().max(100), challengeId: z.string() }`

Note: WebAuthn assertion/attestation are complex browser-generated objects; use `z.any()` or `z.record()` since the actual validation happens in the WebAuthn library.

### Task 9: Add Zod schema for setup endpoint

**File**: `apps/worker/routes/setup.ts`

- POST /setup (line 76) — `{ demoMode: z.boolean().optional() }`

## Files to Modify

| File | Change |
|------|--------|
| `apps/ios/Sources/App/AppState.swift` | Store `adminDecryptionPubkey` from auth response |
| `apps/ios/Sources/Views/Notes/NotesView.swift` | Pass admin pubkey to encryption |
| `apps/ios/Sources/ViewModels/ReportsViewModel.swift` | Pass admin pubkey to encryption |
| `apps/ios/Sources/ViewModels/ConversationsViewModel.swift` | Add admin pubkey to reader list |
| `apps/android/.../ui/dashboard/DashboardViewModel.kt` | Store `adminDecryptionPubkey` |
| `apps/android/.../ui/notes/NotesViewModel.kt` | Pass admin pubkeys to `encryptNote()` (3 calls) |
| `apps/android/.../ui/reports/ReportsViewModel.kt` | Pass admin pubkeys to `encryptNote()` |
| `apps/android/.../ui/conversations/ConversationsViewModel.kt` | Add admin pubkey to reader list |
| `apps/worker/routes/blasts.ts` | Add `requirePermission()` to all 14 endpoints |
| `apps/worker/routes/settings.ts` | Add Zod validators to 4 endpoints |
| `apps/worker/routes/bans.ts` | Add Zod validators to 2 endpoints |
| `apps/worker/routes/webauthn.ts` | Add Zod validators to 3 endpoints |
| `apps/worker/routes/setup.ts` | Add Zod validator to 1 endpoint |

## Testing

### Backend BDD

**File**: `packages/test-specs/features/security/blasts-authorization.feature` (new)

Scenarios:
- Volunteer without `blasts:send` permission gets 403 on POST /blasts/:id/send
- Admin with `blasts:send` permission can send blasts
- Reporter role cannot access any blast endpoints
- `blasts:read` permission allows GET but not POST

**File**: `tests/steps/backend/blasts-auth.steps.ts` (new)

Backend step definitions for above scenarios.

### Unit Tests

**File**: Existing iOS/Android unit test files

- Verify encryption calls include admin pubkey when available
- Verify encryption calls work with empty admin pubkey (graceful degradation)

### Existing Tests

All existing BDD suites must continue passing since the changes are additive (new permission checks, new Zod schemas, additional encryption recipients).

## Acceptance Criteria & Test Scenarios

- [ ] iOS notes encrypted with admin envelope when `adminDecryptionPubkey` is available
  -> Code review: `NotesView.swift` passes non-empty `adminPubkeys`
- [ ] iOS reports encrypted with admin envelope
  -> Code review: `ReportsViewModel.swift` passes non-empty `adminPubkeys`
- [ ] iOS conversation messages include admin pubkey in reader list
  -> Code review: `ConversationsViewModel.swift` includes admin in `readerPubkeys`
- [ ] Android notes encrypted with admin envelope (3 call sites)
  -> Code review: `NotesViewModel.kt` passes non-empty list at lines 249, 368, 441
- [ ] Android reports encrypted with admin envelope
  -> Code review: `ReportsViewModel.kt` passes non-empty list at line 149
- [ ] Android conversation messages include admin pubkey in reader list
  -> Code review: `ConversationsViewModel.kt` includes admin in reader list
- [ ] All 14 blast endpoints enforce `requirePermission()`
  -> `packages/test-specs/features/security/blasts-authorization.feature: "Volunteer without blast permission gets 403"`
- [ ] 10 non-dev endpoints have Zod request body validation
  -> Code review: no `c.req.json() as Type` in settings, bans, webauthn, setup routes
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/security/blasts-authorization.feature` | New | Blast permission enforcement scenarios |
| `tests/steps/backend/blasts-auth.steps.ts` | New | Backend step definitions |

## Risk Assessment

- **Low risk**: Tasks 6-9 (Zod validators) — additive schemas, don't change existing behavior, reject malformed input that previously would have been passed through to DOs
- **Medium risk**: Tasks 1-4 (admin envelopes) — changes encryption output, but the architecture is already in place on all platforms. The Rust `encryptNote` FFI already supports admin pubkeys. Desktop already uses this pattern. Risk is in wiring, not logic.
- **Medium risk**: Task 5 (blast permissions) — adds 403 responses where 200 was returned before. Existing admin users won't be affected (admin role has `blasts:*` wildcard). Non-admin users who were erroneously accessing blasts will lose access.

## Execution

- Tasks 1-2 (iOS admin envelopes) can run in parallel with Tasks 3-4 (Android admin envelopes)
- Task 5 (blast auth) is independent of Tasks 1-4
- Tasks 6-9 (Zod validators) are independent of each other and of Tasks 1-5
- **Phase 1**: Tasks 5-9 (backend: blast auth + Zod validators) — single agent
- **Phase 2**: Tasks 1-2 (iOS) and Tasks 3-4 (Android) — parallel agents
