# Remaining 13 CI E2E Failures — Analysis

## Core Issue: Hub Key Cache Timing (7 of 13 failures)

React Query queries call `decryptHubField()` BEFORE `loadHubKeysForUser()` populates the cache. The hub key is loaded async after PIN unlock, but queries run immediately and render encrypted/empty data.

**Affected tests:** hub-access-control, multi-hub, notes-custom-fields, report-types, roles, shift-management (hub-key encrypted names)

**Root fix options:**
1. Invalidate hub-key-dependent queries AFTER `loadHubKeysForUser()` completes (in auth.tsx's `unlockWithPin`)
2. Make hub-dependent queryFns `enabled: !!hubKey` so they don't fire until the key is available
3. Add `keyManager.onUnlock` → `queryClient.invalidateQueries` for hub-key-dependent query keys

Option 1 is cleanest — `unlockWithPin` already calls `loadHubKeysForUser(hubIds)`. After that completes, invalidate the relevant queries.

## Individual Failures

### Category A: Hub key timing (7 tests)
| File | Line | Issue |
|------|------|-------|
| hub-access-control.spec.ts | 33 | Hub name not decrypted → undefined `.id` |
| multi-hub.spec.ts | 39 | Hub name not decrypted in archive dialog |
| notes-custom-fields.spec.ts | 69 | Custom field label encrypted |
| report-types.spec.ts | 189, 204 | Report type name encrypted in selector |
| roles.spec.ts | 115 | Role names "Volunteer" etc. not decrypted |
| shift-management.spec.ts | 138, 209 | User/shift names encrypted in dropdown |

### Category B: Envelope-encrypted PII timing (2 tests)
| File | Line | Issue |
|------|------|-------|
| profile-settings.spec.ts | 5, 140 | `[encrypted]` after reload — crypto worker not re-initialized |

**Fix:** After `reenterPinAfterReload()`, wait for crypto worker to decrypt before asserting. Or increase timeout.

### Category C: PIN re-entry / timing (2 tests)
| File | Line | Issue |
|------|------|-------|
| theme.spec.ts | 34 | Theme check after reload needs networkidle wait |
| webauthn.spec.ts | 207 | Passkey login flow needs PIN path handling |

### Category D: Access control (1 test)
| File | Line | Issue |
|------|------|-------|
| blasts.spec.ts | 10 | Volunteer access restriction — verify middleware |

### Category E: Complex flow (1 test)
| File | Line | Issue |
|------|------|-------|
| webauthn.spec.ts | 207 | Passkey login + virtual authenticator race |
