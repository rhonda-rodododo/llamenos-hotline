# Voice CAPTCHA & Bot Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the voice CAPTCHA end-to-end flow: challenge generation, TTS delivery, DTMF collection, verification, and rejection on failure.

**Spec:** See `docs/superpowers/specs/2026-03-22-voice-captcha-bot-detection-design.md`

**Assumes:** Drizzle migration complete. Pre-Drizzle: use SettingsDO patterns.

---

## Phase 1: Audit Current CAPTCHA State

- [x] Read `src/worker/routes/telephony.ts` (or `src/server/routes/telephony.ts` post-Drizzle)
  - Confirm `POST /api/telephony/captcha` route exists
  - If missing: add the route (see Phase 2.3)
- [x] Read `src/worker/durable-objects/settings-do.ts` (or `SettingsService`)
  - Find `/captcha/store` and `/captcha/verify` handlers
  - Document their actual implementation (what they store and return)
- [x] Read each telephony adapter's `handleCaptchaResponse()` method
  - Twilio: `src/worker/telephony/twilio.ts`
  - Vonage: `src/worker/telephony/vonage.ts`
  - Plivo: `src/worker/telephony/plivo.ts`
  - Asterisk: `src/worker/telephony/asterisk.ts`
  - SignalWire: inherits from Twilio
  - Verify each returns correct provider response (accept/reject TwiML/NCCO/PXML)
- [x] Read `src/worker/telephony/base-adapter.ts` or the `TelephonyAdapter` interface
  - Confirm `handleIncomingCall()` signature includes access to spam settings (captchaEnabled flag)

---

## Phase 2: Challenge Generation & Storage

### 2.1 CAPTCHA challenge service method
- [x] Add `generateCaptchaChallenge(callSid: string): Promise<{ digits: string, expiresAt: number }>` to `SettingsService` (or SettingsDO handler):
  - Generate 4 random digits: `Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => (b % 9) + 1).join('')`
  - Store in DB (or KV): `{ digits, expiresAt: Date.now() + 120_000, attempts: 0 }`
  - Key: `captcha:${callSid}`
  - Return `{ digits, expiresAt }`
- [x] Add Zod schema for CAPTCHA storage: `CaptchaChallenge = z.object({ digits: z.string().length(4), expiresAt: z.number(), attempts: z.number() })`

### 2.2 CAPTCHA verification service method
- [x] Add `verifyCaptchaChallenge(callSid: string, submittedDigits: string): Promise<'pass' | 'fail' | 'expired' | 'retry'>` to `SettingsService`:
  - Fetch stored challenge by `captcha:${callSid}`
  - If not found or `expiresAt < Date.now()`: return `'expired'`
  - If `submittedDigits === challenge.digits`: delete challenge, return `'pass'`
  - Increment `challenge.attempts`
  - If `challenge.attempts >= captchaMaxAttempts` (from SpamSettings): delete challenge, return `'fail'`
  - Otherwise: update stored challenge (incremented attempts), return `'retry'`

### 2.3 Add `captchaMaxAttempts` to SpamSettings
- [x] Add `captchaMaxAttempts: number` (default: 2) to `SpamSettings` type in `src/worker/types.ts`
- [x] Add to Zod schema and DB column / JSON storage
- [x] Add to settings UI (see Phase 5)

---

## Phase 3: Wire CAPTCHA into Inbound Call Handler

### 3.1 Update `handleIncomingCall()` in adapters
- [x] For **Twilio adapter** (`src/worker/telephony/twilio.ts`):
  - `handleIncomingCall()` currently checks ban list and rate limit
  - Add check: `if (spamSettings.captchaEnabled) { const challenge = await generateCaptchaChallenge(callSid); return speakCaptchaChallenge(challenge.digits, callerLanguage); }`
  - `speakCaptchaChallenge()` returns TwiML with `<Gather>` for DTMF input, pointing to `/api/telephony/captcha?callSid={callSid}`
  - If `!captchaEnabled`: proceed to enqueue call (existing path)
- [x] Apply same change to **Vonage**, **Plivo**, **Asterisk** adapters (using their respective DSLs: NCCO, PXML, AMI)
- [x] SignalWire inherits from Twilio — verify it works without changes

### 3.2 TTS challenge script
- [x] Add CAPTCHA challenge TTS helper `buildCaptchaTwiml(digits: string, language: string): string`:
  - Uses the adapter's TTS voice for the caller's language
  - Script: "To reach our team, please press [d1], [d2], [d3], [d4] on your keypad, then press pound. Again: [d1], [d2], [d3], [d4], then pound."
  - Uses `<Pause>` between digits for clarity
  - Gathers 4 digits + `#` (or timeout after 15 seconds)
  - `action` URL: `${baseUrl}/api/telephony/captcha?callSid=${callSid}`
- [x] Add equivalent for Vonage (NCCO `input` action), Plivo (PXML `GetDigits`), Asterisk (AGI `GET DATA`)
- [x] Add CAPTCHA TTS strings to IVR language store (all supported languages in `src/shared/voice-prompts.ts`)

### 3.3 CAPTCHA webhook route
- [x] Verify or add `POST /api/telephony/captcha` route in `src/worker/routes/telephony.ts` (or server equivalent):
  ```typescript
  telephony.post('/captcha', async (c) => {
    const adapter = getAdapter(c.env)
    return adapter.handleCaptchaResponse(c)
  })
  ```
- [x] `handleCaptchaResponse(c)` in each adapter:
  - Parse DTMF digits from webhook payload (provider-specific field)
  - Extract `callSid` from query params or body
  - Call `verifyCaptchaChallenge(callSid, submittedDigits)`
  - `'pass'` → enqueue call, ring volunteers (same as non-CAPTCHA path)
  - `'retry'` → speak "Incorrect, please try again" + repeat `<Gather>`
  - `'fail'` / `'expired'` → speak "We're unable to connect your call" + `<Hangup>`

---

## Phase 4: Admin Settings UI

- [x] Open CAPTCHA / spam settings component in admin settings page
- [x] Add `captchaMaxAttempts` number input (label: "Max CAPTCHA attempts before rejection", range 1–5, default 2)
- [x] Add save button and wire to `PATCH /api/settings/spam`
- [x] Add i18n keys to all 13 locale files
- [ ] Add real-time preview (optional): "Callers will hear: 'Press 7, 3, 9, 2'"

---

## Phase 5: E2E Tests

- [x] Create `tests/voice-captcha.spec.ts`:

### Test 5.1: CAPTCHA disabled — call routes directly
```
Given: captchaEnabled = false (default)
When: Simulate inbound call
Then: Call appears in active calls immediately (no CAPTCHA step)
```

### Test 5.2: CAPTCHA enabled — challenge presented
```
Given: Admin enables CAPTCHA via settings UI
When: Simulate inbound call
Then: API returns CAPTCHA challenge TwiML/NCCO (contains "gather" or equivalent)
Then: Challenge stored with correct expiry
```

### Test 5.3: Correct DTMF passes CAPTCHA
```
Given: CAPTCHA enabled, challenge generated for callSid "test-captcha-001" with digits "7392"
When: Simulate DTMF webhook to /api/telephony/captcha with digits "7392"
Then: API returns call-enqueue response (not reject)
Then: Call appears in active calls
```

### Test 5.4: Incorrect DTMF triggers retry, then rejection
```
Given: CAPTCHA enabled, captchaMaxAttempts = 2
When: First DTMF attempt with "0000" (wrong)
Then: API returns retry response (re-gather)
When: Second DTMF attempt with "0000" (wrong again)
Then: API returns rejection response (hangup)
Then: Call does NOT appear in active calls
```

### Test 5.5: Expired challenge rejects
```
Given: CAPTCHA challenge stored with expiresAt = past
When: Any DTMF submitted
Then: API returns rejection response
```

---

## Completion Checklist

- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] CAPTCHA challenge generation returns 4 digits (1-9)
- [x] Challenge stored in DB / KV with correct TTL
- [x] Correct DTMF → call enqueued for volunteers
- [x] Incorrect DTMF → retry up to `captchaMaxAttempts`, then reject
- [x] All 5 telephony adapters handle CAPTCHA response
- [x] Admin can toggle CAPTCHA + set max attempts in UI
- [x] E2E tests written: `bunx playwright test tests/voice-captcha.spec.ts`
