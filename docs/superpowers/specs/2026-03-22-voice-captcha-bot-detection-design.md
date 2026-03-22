# Voice CAPTCHA & Bot Detection — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

CLAUDE.md lists "CAPTCHA-like voice bot detection (randomized digit input)" as a non-negotiable security requirement for call spam mitigation. The infrastructure is partially in place (SettingsDO has CAPTCHA storage endpoints, all telephony adapters implement `handleCaptchaResponse()`), but the end-to-end flow has gaps.

This spec covers the complete voice CAPTCHA flow and ensures it is properly wired from inbound call through to result verification.

---

## Current State

### What exists:
- `TelephonyAdapter.handleCaptchaResponse()` — all 5 adapters implement DTMF collection and verification
- `SettingsDO` has `/captcha/store` and `/captcha/verify` routes (storage implemented)
- `SpamSettings` type includes `captchaEnabled: boolean` toggle
- Admin settings UI has a CAPTCHA enable/disable toggle
- Rate limiting helper exists in SettingsDO (`checkRateLimit()`)

### What is missing / unverified:
1. **CAPTCHA challenge generation**: Where are the random digits generated and stored per-call? No evidence of `generateCaptchaChallenge(callSid)` in the inbound call path.
2. **Challenge delivery**: When `captchaEnabled=true`, the inbound call handler must speak the digit challenge *before* enqueuing the call. This may not be wired.
3. **DTMF collection routing**: The telephony webhook for DTMF input (`/api/telephony/captcha`) must route to the adapter's `handleCaptchaResponse()`. Verify this exists.
4. **Failure path**: If the caller fails the CAPTCHA (wrong digits or timeout), the call should be rejected. Verify this rejection is implemented.
5. **Settings-DO verification endpoint**: `storeCaptcha` and `verifyCaptcha` are referenced but handler implementations need verification.

---

## Complete Voice CAPTCHA Flow

```
Inbound call
    │
    ▼
[1] handleIncomingCall()
    ├── Check ban list → reject if banned
    ├── Check rate limit → reject if over limit
    └── Check captchaEnabled
         ├── FALSE → enqueue call, ring volunteers
         └── TRUE →
              │
              ▼
         [2] generateCaptchaChallenge(callSid)
              → Random 4-digit code (e.g. "7-3-9-2")
              → Store challenge: POST /captcha/store { callSid, digits, expiresAt: now+120s }
              │
              ▼
         [3] speakCaptchaChallenge(twiml/ncco/pxml)
              → TTS: "To connect, press [7], [3], [9], [2] on your keypad, then press pound"
              → Repeat once
              → Gather DTMF input (timeout: 15 seconds)
              │
              ▼
         [4] DTMF webhook → POST /api/telephony/captcha
              │
              ▼
         [5] handleCaptchaResponse()
              → Retrieve stored challenge for callSid
              → Compare submitted digits to stored digits
              ├── MATCH → delete challenge, enqueue call, ring volunteers
              └── NO MATCH / TIMEOUT →
                    ├── Increment failure counter (stored per callSid)
                    ├── Count < maxAttempts (2) → repeat challenge
                    └── Count >= maxAttempts → reject call (play rejection message, hangup)
```

---

## Challenge Generation

### Random digit generation
- 4 digits, each 1–9 (exclude 0 to avoid confusion with "press zero")
- `crypto.getRandomValues(new Uint8Array(4)).map(b => (b % 9) + 1)`
- Store as string `"7392"` (no separators)

### Storage key
- Key: `captcha:${callSid}` in SettingsDO (or SettingsService)
- Value: `{ digits: "7392", expiresAt: unixTimestamp, attempts: 0 }`
- TTL: 120 seconds (caller must complete within 2 minutes)
- Expiry enforced by checking `expiresAt` on verify

### Maximum attempts
- Configurable in SpamSettings: `captchaMaxAttempts: number` (default: 2)
- After max attempts, call is rejected with a polite goodbye message

---

## TTS Script (per locale)

The challenge must be spoken in the caller's selected IVR language. The `languages.ts` file already has per-language Twilio voice IDs.

**English template:**
> "To speak with someone, please press the following keys: [digit], [digit], [digit], [digit]. Then press pound."
> (Repeated once)

Add translation strings to `src/shared/languages.ts` or the IVR text store in SettingsDO.

---

## DTMF Webhook Routing

The telephony provider sends DTMF input to:
```
POST /api/telephony/captcha
```

This route must:
1. Parse the provider-specific webhook (using `adapter.parseWebhook()`)
2. Extract the `callSid` and `digits` submitted
3. Call `handleCaptchaResponse({ callSid, digits })`
4. Return the correct TwiML/NCCO/PXML response

---

## Spam Settings UI

Admin settings panel (already has CAPTCHA toggle) must also expose:
- `captchaEnabled: boolean` — toggle (already exists)
- `captchaMaxAttempts: number` — slider/select (new)
- Live preview of what the caller will hear (optional, future)

---

## Security Considerations

- Challenges must be single-use (deleted after first successful verification)
- Expired challenges are treated as failures
- The callSid → challenge mapping must be stored in SettingsDO/SettingsService (not shared state) to prevent cross-call replay
- CAPTCHA bypass must not be possible by knowing a previous callSid's digits (challenges are per-call random)
- If the relay between challenge generation and DTMF verification uses the callSid as identifier, ensure this is not spoofable (callSid comes from the provider's signed webhook — already validated by `validateWebhook()`)

---

## Dependencies

- All 5 telephony adapters: `handleCaptchaResponse()` (verify implementations are correct)
- `SettingsDO` / `SettingsService`: `/captcha/store`, `/captcha/verify` endpoints
- `SpamSettings` type: add `captchaMaxAttempts` field
- `src/worker/routes/telephony.ts`: verify `/captcha` route exists and is wired
- IVR language system: add CAPTCHA prompt translations

---

## Out of Scope

- Visual CAPTCHA for the web app (not applicable — this is a phone system)
- ML-based voice fingerprinting (future, Epic 91 area)
- Biometric voice analysis (not in scope for this platform)

> **Note:** Implement after Drizzle migration (`cf-removal-drizzle-migration-plan.md`) or in parallel using DO patterns. The telephony adapter interface does not change.
