# Spec: Critical Bug Fixes

**Date:** 2026-04-02
**Priority:** Critical (Pre-Launch)
**Status:** Draft

## Overview

Three critical bugs identified during comprehensive codebase audit. These affect core telephony functionality and security posture.

> **Note:** The "Dashboard incoming calls require Nostr relay" item from NEXT_BACKLOG was investigated and found to **already have a REST polling fallback** at 30-second intervals (`src/client/lib/queries/calls.ts:87-112`). Nostr is primary for sub-second updates; REST is the safety net. This item is resolved — no additional work needed.

> **Note:** The CAPTCHA retry bug was investigated and the service layer (`src/server/services/settings.ts:737-798`) correctly implements attempt tracking, retry logic, and max-attempt enforcement. The original bug report may be outdated or the fix was applied without updating the backlog. The test `voice-captcha.spec.ts` test 5.4 should be verified — if it passes, this item is resolved. If `test.fixme` is still present, investigate the route-level handler.

---

## Bug 1: TwiML Callback URLs Use Wrong Prefix

### Problem

All telephony adapters generate TwiML/NCCO/XML with action URLs prefixed `/api/telephony/...`, but telephony webhook routes are mounted at top-level `/telephony/...` (not under `/api/`). The `/api/` prefix hits the authenticated API router, where Twilio/Vonage/Plivo callbacks will fail auth.

### Impact

**All inbound call flows are broken for Twilio, Vonage, Plivo, and SignalWire (which extends Twilio).** Callbacks for language selection, CAPTCHA verification, queue management, voicemail recording, and call status updates all 404 or 401.

Asterisk is unaffected — it uses event-based metadata rather than HTTP callback URLs.

### Root Cause

Route mounting in `src/server/app.ts`:

- Line 323: `app.route('/telephony', telephonyRoutes)` — webhooks at `/telephony/*`
- Line 326: `app.route('/api', api)` — authenticated API at `/api/*`

But adapters hardcode `/api/telephony/` prefix in generated URLs.

### Affected Files & Lines

**Twilio** (`src/server/telephony/twilio.ts`):

- Lines 111, 129, 132, 160, 176, 190, 200, 204, 221, 255, 292, 293, 529
- ~15 URL references with `/api/telephony/` prefix

**Plivo** (`src/server/telephony/plivo.ts`):

- Lines 140, 154, 157, 180, 194, 205, 213, 231, 259, 304-310
- ~12 URL references

**Vonage** (`src/server/telephony/vonage.ts`):

- Lines 145, 165, 196, 211, 228, 243, 262, 305, 356, 360, 603
- ~11 URL references

**SignalWire** (`src/server/telephony/signalwire.ts`):

- Inherits all Twilio URLs via class extension

### Fix

Global find-and-replace `/api/telephony/` → `/telephony/` in all four adapter files. Both relative paths (in TwiML XML) and absolute paths (using `params.callbackUrl` base) need updating.

### Verification

1. `bun run typecheck` — no type changes needed
2. Unit tests for TwiML output (if they exist)
3. **Live Twilio test** using `playwright.live.ts` config with live credentials from `../llamenos` — test full inbound call flow: incoming → language selection → CAPTCHA → queue → answer
4. **Live SIP trunk test** — validate callback URLs work for SIP-originated calls

---

## Bug 2: Unknown API Routes Return 401 Instead of 404

### Problem

Unauthenticated requests to non-existent API routes (e.g., `GET /api/nonexistent`) return `401 Unauthorized` instead of `404 Not Found`. This leaks information: an attacker can distinguish "route exists but needs auth" from "route doesn't exist" — both return 401.

### Impact

Information disclosure vulnerability. Attackers can enumerate valid API routes by observing that all paths return 401.

### Root Cause

In `src/server/app.ts`:

- Line 239-241: `authenticated` sub-app created with `authenticated.use('*', auth)`
- Line 319: `api.route('/', authenticated)` — mounted as catch-all
- No explicit 404 handler after all routes

Request flow for unknown route:

1. Request hits `/api/unknown`
2. Falls through all explicit routes (health, config, auth, etc.)
3. Reaches `authenticated` catch-all at line 319
4. Auth middleware at line 241 rejects → returns 401
5. Never reaches route matching where 404 would be returned

### Fix

Add a catch-all `notFound()` handler on the `api` OpenAPIHono instance that returns 404 regardless of auth state. In Hono, `app.notFound(handler)` fires when no route matches. This should be set on the `api` object (not on `authenticated`), so it catches unmatched routes before they fall through to the authenticated sub-app.

**Alternative**: Restructure so that `authenticated` is not a catch-all — mount it at specific path prefixes instead. This is a larger refactor but more architecturally sound.

### Affected Files

- `src/server/app.ts` — lines 239-326 (route mounting section)

### Verification

1. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/nonexistent` → should return 404
2. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/users` → should still return 401 (valid route, needs auth)
3. API E2E test for 404 behavior

---

## Bug 3: CAPTCHA Retry (Verification Needed)

### Problem (As Originally Reported)

`captchaMaxAttempts` setting exists and is persisted, but the server deletes challenge state after the first attempt.

### Investigation Findings

The service layer in `src/server/services/settings.ts:737-798` appears to correctly implement:

- Attempt counting (line 766: `const newAttempts = row.attempts + 1`)
- Max attempt enforcement (line 781: `if (newAttempts >= maxAttempts)`)
- Retry with preserved state (line 788-797: updates attempt count, returns `shouldRetry: true`)

The DB schema (`src/server/db/schema/settings.ts:133-139`) has an `attempts` column.

### Action Required

1. Check if `voice-captcha.spec.ts` test 5.4 still has `test.fixme` marker
2. If `test.fixme` is present, run it and observe failure mode
3. If the test passes, mark this bug as resolved in NEXT_BACKLOG
4. If it fails, trace the exact code path from the telephony route handler through to the service

### Affected Files

- `src/server/routes/telephony.ts` — CAPTCHA route handler (~lines 265-335)
- `src/server/services/settings.ts` — `verifyCaptcha()` method (lines 737-798)
- `tests/ui/voice-captcha.spec.ts` — test 5.4

---

## Testing Strategy

### Live Telephony Testing (Bug 1)

Use the existing `playwright.live.ts` configuration with Twilio credentials from `../llamenos`:

1. Copy live env vars from `../llamenos/.env` to test environment
2. Run against live Twilio API: `bunx playwright test --config=playwright.live.ts tests/api/simulation-telephony.spec.ts`
3. Also test SIP trunk callbacks if SIP trunk is configured

### Security Testing (Bug 2)

Add API E2E tests in `tests/api/` that verify:

- Unknown routes return 404 (not 401)
- Known authenticated routes still return 401 when unauthenticated
- Known public routes return 200 without auth

### Regression Testing

All existing telephony and auth E2E tests must continue passing after fixes.
