# UI Test Parallel Isolation Design

**Date:** 2026-03-24
**Status:** Approved
**Goal:** Get all 448 UI tests passing with `PLAYWRIGHT_WORKERS=3`

## Problem

Running UI tests with 3 workers yields ~250 passing, ~120 "did not run", and occasional failures from state pollution. Three root causes:

1. **Serial mode** — 29 test files use `serial` mode, blocking parallelism and causing "did not run" cascades when one test skips
2. **Telephony skips** — 25 tests skip because no telephony provider is configured (returns 503)
3. **Conditional skips** — 7 tests skip due to missing state (no volunteers with phones, getting-started completed, messaging already configured)

## Design

### Part A: TestAdapter for Telephony (25 tests)

Create a `TestAdapter` that implements the `TelephonyAdapter` interface with in-memory state. This allows telephony webhook routes to return valid TwiML responses without a real provider.

**Location:** `src/server/telephony/test.ts`

**Registration:** In `src/server/lib/adapters.ts`, after all provider checks (hub config, global config, Twilio env vars), add a final fallback: `if (Bun.env.USE_TEST_ADAPTER === 'true') return new TestAdapter()`. This is a fallback, not an override — if a real provider is configured, it takes precedence.

**Activation:** Set `USE_TEST_ADAPTER=true` in the Playwright webServer env. This only affects the test server, not dev or production. Note: when `reuseExistingServer: true` (local dev), the env is NOT passed to an already-running server. Developers running `bun run dev:server` separately must set `USE_TEST_ADAPTER=true` in their environment or `.env` file.

**Middleware note:** The telephony middleware at `src/server/routes/telephony.ts` line 53 returns **404** (not 503) when `getTelephony()` returns null. Individual route handlers also check for null and return **503**, but those checks are dead code because the middleware short-circuits first. With TestAdapter, `getTelephony()` returns a non-null adapter, so neither the 404 nor 503 paths trigger.

**Full interface (22 methods from `TelephonyAdapter`):**

Core TwiML responses:
- `handleLanguageMenu(params)` — return TwiML with language `<Gather>` digits
- `handleIncomingCall(params)` — return TwiML with `<Enqueue>` or `<Reject>` (based on ban list) or CAPTCHA `<Gather>`
- `handleCaptchaResponse(params)` — return TwiML with `<Enqueue>` on correct digits or `<Hangup>` on failure
- `handleCallAnswered(params)` — return TwiML that bridges caller → volunteer via queue
- `handleVoicemail(params)` — return TwiML with `<Record>`
- `handleVoicemailComplete(lang)` — return TwiML with thank-you and `<Hangup>`
- `handleWaitMusic(lang, audioUrls?, queueTime?, queueTimeout?)` — return TwiML with `<Play>` or `<Leave>` if timeout exceeded
- `rejectCall()` — return TwiML with `<Reject>`
- `emptyResponse()` — return empty TwiML `<Response/>`

Call control (stubbed for test):
- `hangupCall(callSid)` — no-op (no real call to hang up)
- `ringVolunteers(params)` — no-op, return empty array (no real outbound calls)
- `cancelRinging(callSids, exceptSid?)` — no-op

Webhook parsing (Twilio form-body format):
- `parseIncomingWebhook(request)` — extract callSid, callerNumber, calledNumber from form body
- `parseLanguageWebhook(request)` — extract callSid, callerNumber, digits
- `parseCaptchaWebhook(request)` — extract digits, callerNumber
- `parseCallStatusWebhook(request)` — extract callSid, status
- `parseQueueWaitWebhook(request)` — extract queueTime
- `parseQueueExitWebhook(request)` — extract result
- `parseRecordingWebhook(request)` — extract status, recordingSid, callSid

Other:
- `validateWebhook(request)` — always return true
- `getCallRecording(callSid)` — return null (no real recordings)
- `getRecordingAudio(recordingSid)` — return null
- `testConnection()` — return `{ connected: true, latencyMs: 0 }`

**What TestAdapter does NOT need to do:**
- Make real outbound calls
- Bridge real audio
- Provision phone numbers
- Connect to external APIs

**Tests that will work with TestAdapter:**
| File | Tests | Currently skipping |
|------|-------|--------------------|
| call-flow.spec.ts | 5 | All 5 |
| call-spam.spec.ts | 6 | All 6 |
| voice-captcha.spec.ts | 6 | All 6 |
| nostr-relay.spec.ts | 7 | All 7 (also needs relay running) |
| voicemail-webhook.spec.ts | 1 | 1 |

### Part B: Fix Conditional Skips (7 tests)

**pin-challenge.spec.ts (3 tests):**
Tests skip when no volunteers with phone numbers exist. Fix: create a volunteer with a phone number in `beforeAll` using the admin API.

**help.spec.ts (2 tests):**
Tests skip when the "Getting Started" checklist is hidden (all items completed). Fix: The `resetTestState` endpoint already resets the app to fresh state. These tests should run after reset. If the checklist still hides, the `resetTestState` needs to reset setup wizard completion flags.

**conversations.spec.ts (2 tests):**
Tests skip when messaging channels are already enabled. Fix: These tests validate the empty state (no channels). After `resetTestState`, messaging should be unconfigured. If it's still configured, `resetTestState` needs to clear messaging config.

### Part C: Accepted Skips (9 tests)

These are legitimate and should NOT be changed:
- **webauthn.spec.ts (8)** — CDP virtual authenticator only works in Chromium. Tests check for authenticator support and skip gracefully.
- **capture-screenshots.spec.ts (1)** — Intentionally disabled in CI.

### Part D: Serial → Parallel (Category 1)

Already being handled by 4 parallel agents. The pattern is:
- Remove `test.describe.configure({ mode: 'serial' })`
- Make each test self-contained with its own setup
- Use unique names/IDs to avoid collision between parallel tests

### Expected Outcome

| Category | Tests | Before | After |
|----------|-------|--------|-------|
| Serial mode | ~180 (in 29 files) | Many "did not run" | All run in parallel |
| Telephony-dependent | 26 | All skip | All pass (with TestAdapter; nostr-relay needs relay running) |
| Conditional skips | 7 | Skip | Pass (with better state setup) |
| Accepted skips | 9 | Skip | Skip (legitimate) |
| **Total passing** | **448** | **~250** | **~439 pass, 9 skip** |

## Implementation Notes

**TestAdapter TwiML format:** Use Twilio-compatible TwiML since the test webhooks send Twilio-format form data. The TestAdapter parses `CallSid`, `From`, `To`, `CallStatus`, `Digits` fields.

**Playwright config change:** Add `USE_TEST_ADAPTER=true` to the webServer env:
```typescript
webServer: {
  command: "bun run build && bun run start",
  url: "http://localhost:3000/api/health/ready",
  reuseExistingServer: !process.env.CI,
  env: { USE_TEST_ADAPTER: 'true' },
},
```

**Test file changes for telephony tests:** Remove all `if (res.status() === 503) { test.skip() }` and `if (res.status() === 404) { test.skip() }` blocks. With TestAdapter active, `getTelephony()` always returns a non-null adapter, so neither 404 (middleware) nor 503 (dead route handler code) should ever trigger. If they do, that's a bug to fix, not a skip to add.

**Nostr relay dependency:** The nostr-relay.spec.ts tests also need the strfry relay running (`ws://localhost:7778`). This is started by `bun run dev:docker`. Tests will still skip if relay is unreachable — this is acceptable since the relay is infrastructure, not something TestAdapter can simulate.
