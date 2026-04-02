# Plan: Test Coverage Hardening

**Spec:** `docs/specs/2026-04-02-test-coverage-hardening.md`
**Date:** 2026-04-02
**Estimated effort:** 4-5 sessions (~12-16 hours)
**Priority:** High

---

## Phase 1: Fix Known Failing Tests (Unblock CI)

### Step 1.1: Fix roles.spec.ts (6 failures)
- [ ] Read `tests/api/roles.spec.ts` — trace auth state through beforeAll hooks
- [ ] Identify why JWT tokens return 401 in subsequent tests
- [ ] Fix: either re-authenticate per test or extend token lifetime for tests
- [ ] Run: `bunx playwright test tests/api/roles.spec.ts` — all 28 should pass

### Step 1.2: Fix hub-access-control.spec.ts (1 failure)
- [ ] Read `tests/ui/hub-access-control.spec.ts` — find the hub-access-toggle reference
- [ ] Check UI components for missing `data-testid="hub-access-toggle"`
- [ ] Fix: add the data-testid to the correct component, or update test
- [ ] Run: `bunx playwright test tests/ui/hub-access-control.spec.ts`

---

## Phase 2: High-Value Service Unit Tests

### Step 2.1: CallsService Tests
- [ ] **File:** `src/server/services/calls.test.ts` (create)
- [ ] Test `cancelOtherLegs` — 3 legs, 1 answers, verify others cancelled
- [ ] Test `cancelOtherLegs` — phone vs browser type filtering
- [ ] Test `validateCallToken` — valid token, expired token, missing token
- [ ] Test `createActiveCall` — caller number encryption
- [ ] Test hub ID isolation — hub-scoped vs cross-hub queries
- [ ] Requires: DB (integration test)

### Step 2.2: ShiftsService Tests
- [ ] **File:** `src/server/services/shifts.test.ts` (create)
- [ ] Test `getEffectiveUsers` — normal schedule within hours
- [ ] Test `getEffectiveUsers` — midnight-crossing shift (22:00-06:00)
- [ ] Test `getEffectiveUsers` — override cancels schedule
- [ ] Test `getEffectiveUsers` — global substitute override
- [ ] Test `getEffectiveUsers` — only clocked-in users returned
- [ ] Test `getUserStatus` — next shift calculation across days
- [ ] Test time format validation — valid/invalid HH:MM
- [ ] Requires: DB (integration test)

### Step 2.3: GdprService Tests
- [ ] **File:** `src/server/services/gdpr.test.ts` (create)
- [ ] Test `eraseUser` — full erasure atomicity (all data types)
- [ ] Test `eraseUser` — shift schedule array filtering (remove pubkey)
- [ ] Test `eraseUser` — audit log anonymization (actorPubkey → '[erased]')
- [ ] Test `purgeExpiredData` — respects retention day counts
- [ ] Test `purgeExpiredData` — boundary conditions (exactly N days)
- [ ] Test erasure request 72-hour delay
- [ ] Test `exportForUser` — comprehensive data assembly
- [ ] Requires: DB (integration test)

---

## Phase 3: Security Module Tests

### Step 3.1: SSRF Guard Tests
- [ ] **File:** `src/server/lib/ssrf-guard.test.ts` (create)
- [ ] Test all IPv4 range boundaries (loopback, private, CGNAT, reserved)
- [ ] Test IPv6 patterns (loopback, link-local, ULA, mapped IPv4)
- [ ] Test hostname checks (localhost, *.localhost, 0.0.0.0)
- [ ] Test URL validation (protocol enforcement, internal IP rejection)
- [ ] Test edge cases (invalid octets, 3-octet IPs, bracketed IPv6)
- [ ] Pure unit test — no DB needed

### Step 3.2: Auth Middleware Tests
- [ ] **File:** `src/server/lib/auth.test.ts` (create)
- [ ] Test missing Authorization header → null
- [ ] Test malformed header (not "Bearer ") → null
- [ ] Test expired JWT → null (with mocked identity)
- [ ] Test valid JWT but deleted user → null
- [ ] Test successful auth → {pubkey, user}
- [ ] Mock identity service

### Step 3.3: Retention Purge Job Tests
- [ ] **File:** `src/server/jobs/retention-purge.test.ts` (create)
- [ ] Test scheduled time calculation (next 03:00 UTC)
- [ ] Test no audit entry on zero deletions
- [ ] Test error handling (continues after failure)
- [ ] Mock services

---

## Phase 4: Messaging Adapter Tests

### Step 4.1: SMS Adapter Interface Tests
- [ ] **File:** `src/server/messaging/sms/twilio.test.ts` (create)
- [ ] Test `parseIncomingMessage` — form-encoded Twilio webhook
- [ ] Test `validateWebhook` — HMAC signature verification
- [ ] Test `sendMessage` — API call construction
- [ ] Mock HTTP client

### Step 4.2: WhatsApp Adapter Tests
- [ ] **File:** `src/server/messaging/whatsapp/whatsapp.test.ts` (create)
- [ ] Test both Meta Direct and Twilio modes
- [ ] Test media message handling

### Step 4.3: Signal Adapter Tests
- [ ] **File:** `src/server/messaging/signal/signal.test.ts` (create)
- [ ] Test bridge communication format
- [ ] Test SSRF-guarded bridge URL validation

---

## Phase 5: Telephony Adapter Tests

### Step 5.1: TwiML Output Tests
- [ ] **File:** `src/server/telephony/twilio.test.ts` (create)
- [ ] Test `handleIncomingCall` — generates valid TwiML XML
- [ ] Test `handleLanguageMenu` — correct Gather verb
- [ ] Test `handleCaptchaResponse` — retry vs reject TwiML
- [ ] Test `ringUsers` — correct outbound call params
- [ ] Test callback URL correctness (uses `/telephony/` not `/api/telephony/`)

### Step 5.2: NCCO Output Tests
- [ ] **File:** `src/server/telephony/vonage.test.ts` (create)
- [ ] Test NCCO JSON structure for key operations
- [ ] Test webhook URL generation

---

## Verification After Each Phase

- [ ] `bun run typecheck`
- [ ] `bun run test:unit` — all unit tests pass
- [ ] `bun run test:api` — all API E2E tests pass
- [ ] No regressions in existing test suites
