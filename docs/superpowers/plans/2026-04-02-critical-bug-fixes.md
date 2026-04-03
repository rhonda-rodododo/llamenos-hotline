# Plan: Critical Bug Fixes

**Spec:** `docs/superpowers/specs/2026-04-02-critical-bug-fixes-design.md`
**Date:** 2026-04-02
**Estimated effort:** 1 session (~2-3 hours)
**Priority:** Critical

---

## Phase 1: TwiML Callback URL Fix

### Step 1.1: Fix Twilio Adapter URLs

- [x] **File:** `src/server/telephony/twilio.ts`
- [x] Find-and-replace `/api/telephony/` → `/telephony/` across all ~15 URL references
- [x] Verify `params.callbackUrl` base URLs are preserved (only the path portion changes)
- [x] Special attention to line 529 (`expectedVoiceUrl`) — this is used for webhook verification

### Step 1.2: Fix Plivo Adapter URLs

- [x] **File:** `src/server/telephony/plivo.ts`
- [x] Find-and-replace `/api/telephony/` → `/telephony/` across all ~12 URL references
- [x] Verify XML escaping is preserved (Plivo uses XML, not TwiML)

### Step 1.3: Fix Vonage Adapter URLs

- [x] **File:** `src/server/telephony/vonage.ts`
- [x] Find-and-replace `/api/telephony/` → `/telephony/` across all ~11 URL references
- [x] Vonage uses NCCO JSON format — verify array URL format `['/telephony/...']` is correct

### Step 1.4: Verify SignalWire Inheritance

- [x] **File:** `src/server/telephony/signalwire.ts`
- [x] Confirm SignalWire extends TwilioAdapter and inherits the fix
- [x] Check for any URL overrides in SignalWire-specific methods

### Step 1.5: Run Existing Tests

- [x] `bun run typecheck`
- [x] `bun run test:unit` — any telephony-related unit tests
- [x] `bunx playwright test tests/api/simulation-telephony.spec.ts` — simulation tests
- [x] `bunx playwright test tests/ui/voice-captcha.spec.ts` — CAPTCHA flow tests

### Step 1.6: Live Twilio Testing

- [x] Copy live env vars from `../llamenos/.env.local` (or equivalent)
- [x] Run `bunx playwright test --config=playwright.live.ts` against live Twilio
- [x] Test inbound call → language selection → CAPTCHA → parallel ring → answer
- [x] Test SIP trunk callback flow (if trunk configured)
- [x] Verify recording status callbacks reach `/telephony/call-recording`

---

## Phase 2: API Route 404 Fix

### Step 2.1: Add notFound Handler

- [x] **File:** `src/server/app.ts`
- [x] Add `api.notFound((c) => c.json({ error: 'Not found' }, 404))` before `api.route('/', authenticated)` at line 319
- [x] If Hono's `notFound` doesn't intercept before catch-all route, restructure: mount authenticated routes at explicit prefixes instead of root `/`

### Step 2.2: Write API E2E Test

- [x] **File:** `tests/api/security-hardening.spec.ts` (append to existing) or new `tests/api/route-404.spec.ts`
- [x] Test: `GET /api/definitely-nonexistent` returns 404
- [x] Test: `POST /api/definitely-nonexistent` returns 404
- [x] Test: `GET /api/users` without auth returns 401 (valid route, needs auth)
- [x] Test: `GET /api/health` without auth returns 200 (public route)

### Step 2.3: Verify No Regressions

- [x] `bunx playwright test tests/api/auth-facade.spec.ts`
- [x] `bunx playwright test tests/api/health-config.spec.ts`
- [x] `bunx playwright test tests/ui/auth-guards.spec.ts`

---

## Phase 3: CAPTCHA Retry Verification

### Step 3.1: Check Test Status

- [x] Read `tests/ui/voice-captcha.spec.ts` — find test 5.4, check if `test.fixme` is present
- [x] If `test.fixme`: remove it and run the test
- [x] If test passes: mark CAPTCHA retry bug as resolved in NEXT_BACKLOG
- [x] If test fails: trace the failure through telephony route → settings.verifyCaptcha()

### Step 3.2: Fix if Needed

- [x] If the route handler at `src/server/routes/telephony.ts:265-335` doesn't properly handle `shouldRetry: true` from the service, fix the response generation
- [x] Ensure retry generates new CAPTCHA digits while preserving attempt count

---

## Phase 4: Backlog Cleanup

### Step 4.1: Update NEXT_BACKLOG.md

- [x] Mark "Dashboard incoming calls require Nostr relay" as resolved with note: "REST polling fallback already implemented at 30s intervals"
- [x] Update CAPTCHA retry item based on Phase 3 findings
- [x] Mark TwiML callback URL bug as resolved
- [x] Mark 401→404 bug as resolved

### Step 4.2: Commit

- [x] `bun run typecheck && bun run build`
- [x] Commit with descriptive message covering all fixes

---

## Dependencies

- Live Twilio testing requires credentials from `../llamenos` project
- SIP trunk testing requires Asterisk infrastructure (optional for this plan)
- Phase 2 may require understanding Hono's notFound vs catch-all route priority
