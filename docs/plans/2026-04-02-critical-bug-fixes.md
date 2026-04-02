# Plan: Critical Bug Fixes

**Spec:** `docs/specs/2026-04-02-critical-bug-fixes.md`
**Date:** 2026-04-02
**Estimated effort:** 1 session (~2-3 hours)
**Priority:** Critical

---

## Phase 1: TwiML Callback URL Fix

### Step 1.1: Fix Twilio Adapter URLs

- [ ] **File:** `src/server/telephony/twilio.ts`
- [ ] Find-and-replace `/api/telephony/` → `/telephony/` across all ~15 URL references
- [ ] Verify `params.callbackUrl` base URLs are preserved (only the path portion changes)
- [ ] Special attention to line 529 (`expectedVoiceUrl`) — this is used for webhook verification

### Step 1.2: Fix Plivo Adapter URLs

- [ ] **File:** `src/server/telephony/plivo.ts`
- [ ] Find-and-replace `/api/telephony/` → `/telephony/` across all ~12 URL references
- [ ] Verify XML escaping is preserved (Plivo uses XML, not TwiML)

### Step 1.3: Fix Vonage Adapter URLs

- [ ] **File:** `src/server/telephony/vonage.ts`
- [ ] Find-and-replace `/api/telephony/` → `/telephony/` across all ~11 URL references
- [ ] Vonage uses NCCO JSON format — verify array URL format `['/telephony/...']` is correct

### Step 1.4: Verify SignalWire Inheritance

- [ ] **File:** `src/server/telephony/signalwire.ts`
- [ ] Confirm SignalWire extends TwilioAdapter and inherits the fix
- [ ] Check for any URL overrides in SignalWire-specific methods

### Step 1.5: Run Existing Tests

- [ ] `bun run typecheck`
- [ ] `bun run test:unit` — any telephony-related unit tests
- [ ] `bunx playwright test tests/api/simulation-telephony.spec.ts` — simulation tests
- [ ] `bunx playwright test tests/ui/voice-captcha.spec.ts` — CAPTCHA flow tests

### Step 1.6: Live Twilio Testing

- [ ] Copy live env vars from `../llamenos/.env.local` (or equivalent)
- [ ] Run `bunx playwright test --config=playwright.live.ts` against live Twilio
- [ ] Test inbound call → language selection → CAPTCHA → parallel ring → answer
- [ ] Test SIP trunk callback flow (if trunk configured)
- [ ] Verify recording status callbacks reach `/telephony/call-recording`

---

## Phase 2: API Route 404 Fix

### Step 2.1: Add notFound Handler

- [ ] **File:** `src/server/app.ts`
- [ ] Add `api.notFound((c) => c.json({ error: 'Not found' }, 404))` before `api.route('/', authenticated)` at line 319
- [ ] If Hono's `notFound` doesn't intercept before catch-all route, restructure: mount authenticated routes at explicit prefixes instead of root `/`

### Step 2.2: Write API E2E Test

- [ ] **File:** `tests/api/security-hardening.spec.ts` (append to existing) or new `tests/api/route-404.spec.ts`
- [ ] Test: `GET /api/definitely-nonexistent` returns 404
- [ ] Test: `POST /api/definitely-nonexistent` returns 404
- [ ] Test: `GET /api/users` without auth returns 401 (valid route, needs auth)
- [ ] Test: `GET /api/health` without auth returns 200 (public route)

### Step 2.3: Verify No Regressions

- [ ] `bunx playwright test tests/api/auth-facade.spec.ts`
- [ ] `bunx playwright test tests/api/health-config.spec.ts`
- [ ] `bunx playwright test tests/ui/auth-guards.spec.ts`

---

## Phase 3: CAPTCHA Retry Verification

### Step 3.1: Check Test Status

- [ ] Read `tests/ui/voice-captcha.spec.ts` — find test 5.4, check if `test.fixme` is present
- [ ] If `test.fixme`: remove it and run the test
- [ ] If test passes: mark CAPTCHA retry bug as resolved in NEXT_BACKLOG
- [ ] If test fails: trace the failure through telephony route → settings.verifyCaptcha()

### Step 3.2: Fix if Needed

- [ ] If the route handler at `src/server/routes/telephony.ts:265-335` doesn't properly handle `shouldRetry: true` from the service, fix the response generation
- [ ] Ensure retry generates new CAPTCHA digits while preserving attempt count

---

## Phase 4: Backlog Cleanup

### Step 4.1: Update NEXT_BACKLOG.md

- [ ] Mark "Dashboard incoming calls require Nostr relay" as resolved with note: "REST polling fallback already implemented at 30s intervals"
- [ ] Update CAPTCHA retry item based on Phase 3 findings
- [ ] Mark TwiML callback URL bug as resolved
- [ ] Mark 401→404 bug as resolved

### Step 4.2: Commit

- [ ] `bun run typecheck && bun run build`
- [ ] Commit with descriptive message covering all fixes

---

## Dependencies

- Live Twilio testing requires credentials from `../llamenos` project
- SIP trunk testing requires Asterisk infrastructure (optional for this plan)
- Phase 2 may require understanding Hono's notFound vs catch-all route priority
