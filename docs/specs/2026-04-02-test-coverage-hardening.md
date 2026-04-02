# Spec: Test Coverage Hardening

**Date:** 2026-04-02
**Priority:** High (Pre-Launch Quality)
**Status:** Draft

## Overview

8 services have zero unit tests, the entire messaging system (16+ files) is untested, most telephony adapters lack tests, and security-critical modules (auth, SSRF guard, WebAuthn) have no coverage. Additionally, 7 known test failures need fixing. This spec covers systematic test coverage expansion.

---

## Current State

### Services WITHOUT Unit Tests (8)
| Service | File | Complexity | Critical? |
|---------|------|-----------|-----------|
| CallsService | `src/server/services/calls.ts` | HIGH (cancelOtherLegs, token mgmt) | Yes — core call flow |
| ShiftsService | `src/server/services/shifts.ts` | VERY HIGH (getEffectiveUsers, midnight crossing) | Yes — scheduling core |
| GdprService | `src/server/services/gdpr.ts` | VERY HIGH (eraseUser transactional, purgeExpiredData) | Yes — compliance |
| SettingsService | `src/server/services/settings.ts` | HIGH (53 methods, 20 domains) | Partial — most methods simple CRUD |
| ConversationsService | `src/server/services/conversations.ts` | MEDIUM | Medium |
| FilesService | `src/server/services/files.ts` | MEDIUM | Medium |
| InviteDeliveryService | `src/server/services/invite-delivery-service.ts` | LOW | Low |
| ReportTypesService | `src/server/services/report-types.ts` | LOW | Low |

### Security-Critical Modules WITHOUT Tests (3)
| Module | File | Risk |
|--------|------|------|
| Auth middleware | `src/server/lib/auth.ts` | Authentication bypass |
| SSRF guard | `src/server/lib/ssrf-guard.ts` | SSRF attacks |
| Retention purge job | `src/server/jobs/retention-purge.ts` | Data loss/retention violation |

### Known Failing Tests (7)
| Test File | Failures | Root Cause |
|-----------|----------|-----------|
| `tests/api/roles.spec.ts` | 6/28 | Auth token persistence across test hooks |
| `tests/ui/hub-access-control.spec.ts` | 1/4 | Missing `data-testid="hub-access-toggle"` UI element |

---

## Priority 1: Fix Known Failing Tests

### roles.spec.ts (6 failures)
Tests fail with 401 Unauthorized. Root cause: JWT tokens from `beforeAll` hooks expire or aren't properly passed to subsequent tests. Fix the auth state persistence pattern.

### hub-access-control.spec.ts (1 failure)
Test expects `data-testid="hub-access-toggle"` which may be missing from the UI. Either add the missing data-testid attribute or update the test.

---

## Priority 2: High-Value Service Unit Tests

### CallsService — Key Test Cases
1. **cancelOtherLegs** — multi-leg filtering + type matching (phone vs browser)
2. **validateCallToken** — expiry, cleanup, 401 error scenarios
3. **Hub ID isolation** — cross-hub queries vs hub-scoped queries
4. **Encryption/decryption** — caller number encrypt on create, decrypt on read

### ShiftsService — Key Test Cases
1. **getEffectiveUsers** — midnight-crossing shifts (startTime > endTime)
2. **Override cascade** — schedule-specific cancel > global substitute precedence
3. **Effective users with clock-in filter** — intersection of schedules and activeShifts
4. **getUserStatus** — next shift calculation with 7-day day-of-week wrap
5. **Time format validation** — HH:MM regex enforcement

### GdprService — Key Test Cases
1. **eraseUser atomicity** — all-or-nothing deletion of credentials, notes, sessions + PII anonymization
2. **Shift schedule array filtering** — removing erased user from JSONB arrays
3. **Retention cutoff accuracy** — purgeExpiredData respects configured day counts
4. **Erasure request 72-hour delay** — timer enforcement
5. **PII anonymization vs deletion** — user record preserved but cleared

---

## Priority 3: Security Module Tests

### SSRF Guard — Key Test Cases
1. **IPv4 range boundaries** — test every blocked range at exact boundaries (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, etc.)
2. **IPv6 patterns** — ::1, fe80::, fc00::, fd00::, ::ffff:mapped, brackets
3. **Hostname normalization** — localhost, *.localhost, 0.0.0.0
4. **URL validation wrapper** — protocol enforcement, error messages

### Auth Middleware — Key Test Cases
1. **Missing/malformed Authorization header** — various invalid formats
2. **Invalid JWT** — expired, tampered, wrong signature
3. **User lookup failure** — valid token but deleted user
4. **Successful auth** — returns {pubkey, user}

### Retention Purge Job — Key Test Cases
1. **Scheduled time calculation** — next 03:00 UTC
2. **Audit log threshold** — no logging for zero-deletion runs
3. **Error resilience** — continues schedule after failure

---

## Priority 4: Messaging & Telephony Adapters

### Messaging System (16+ files, all untested)
Focus on adapter interface compliance:
- Each SMS adapter: `parseIncomingMessage`, `validateWebhook`, `sendMessage`
- WhatsApp adapter: same + media message handling
- Signal adapter: bridge communication + registration flow

### Telephony Adapters (19 files)
Focus on TwiML/NCCO/XML output correctness:
- Each adapter's `handleIncomingCall` produces valid provider-specific response
- `parseIncomingWebhook` correctly extracts call info from provider payloads
- `ringUsers` generates correct outbound call params

---

## Testing Approach

- **Unit tests** (`.test.ts` colocated): Mock DB and external services. Fast, pure.
- **Integration tests** (`.integration.test.ts` colocated): Require Postgres (`bun run dev:docker`)
- **CallsService and ShiftsService** need integration tests (complex DB queries)
- **GdprService** needs integration tests (transactional, multi-table operations)
- **SSRF guard** is pure — unit test only
- **Auth middleware** — mock identity service, test with various headers
