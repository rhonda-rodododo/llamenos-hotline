# Plan: Incomplete Adapter Completion

**Spec:** `docs/specs/2026-04-02-adapter-completion.md`
**Date:** 2026-04-02
**Estimated effort:** 3-4 sessions (~10-14 hours)
**Priority:** Medium

---

## Phase 1: SignalWire WebRTC Token (Smallest, Quickest Win)

### Step 1.1: Add Token Generation
- [ ] **File:** `src/server/telephony/webrtc-tokens.ts`
- [ ] Add `generateSignalWireToken()` — copy `generateTwilioToken()` logic
- [ ] Adapt config extraction for SignalWire's space-based auth
- [ ] Replace `throw` at line 24 with call to new function

### Step 1.2: Enable WebRTC Config Check
- [ ] Update `isWebRtcConfigured()` — change SignalWire case from `return false` to actual config check

### Step 1.3: Write Tests
- [ ] **File:** `src/server/telephony/webrtc-tokens.test.ts` (create or extend)
- [ ] Test JWT structure: header, payload, grants
- [ ] Test token expiry (3600s default)
- [ ] Verify HS256 signing

### Step 1.4: Verify
- [ ] `bun run typecheck`
- [ ] `bun run test:unit`

---

## Phase 2: Telnyx SMS Adapter

### Step 2.1: Research Telnyx SMS API
- [ ] Use context7 to look up current Telnyx Messaging API docs
- [ ] Document: webhook format (JSON), auth method, endpoint URLs, status values

### Step 2.2: Implement Adapter
- [ ] **File:** `src/server/messaging/sms/telnyx.ts` (create)
- [ ] Implement `MessagingAdapter` interface
- [ ] `parseIncomingMessage` — parse Telnyx JSON webhook payload
- [ ] `validateWebhook` — verify Telnyx webhook signature
- [ ] `sendMessage` — POST to Telnyx Messages API
- [ ] `sendMediaMessage` — include media_urls in API call
- [ ] `getChannelStatus` — test API connectivity
- [ ] `parseStatusWebhook` — map Telnyx status to normalized enum

### Step 2.3: Register in Factory
- [ ] **File:** `src/server/messaging/sms/factory.ts`
- [ ] Replace `throw` at line 86-88 with `new TelnyxSMSAdapter(config)`

### Step 2.4: Add Webhook Schema
- [ ] **File:** `src/shared/schemas/external/telnyx.ts` (create or extend)
- [ ] Zod schema for Telnyx inbound message webhook
- [ ] Zod schema for Telnyx message status webhook

### Step 2.5: Write Tests
- [ ] **File:** `src/server/messaging/sms/telnyx.test.ts` (create)
- [ ] Test webhook parsing with sample payloads
- [ ] Test message sending API construction
- [ ] Test status mapping
- [ ] Mock HTTP client

### Step 2.6: Verify
- [ ] `bun run typecheck`
- [ ] `bun run test:unit`

---

## Phase 3: Telnyx Telephony Adapter

### Step 3.1: Research Telnyx TeXML API
- [ ] Use context7 to look up Telnyx TeXML docs and Call Control API
- [ ] Document key differences from Twilio TwiML
- [ ] Identify all TeXML verbs needed (Gather, Say, Play, Record, Dial, Redirect, Hangup, Queue)

### Step 3.2: Create Adapter Class
- [ ] **File:** `src/server/telephony/telnyx.ts` (create)
- [ ] Extend or mirror `TwilioAdapter` structure (TeXML is very similar to TwiML)
- [ ] Implement all 23 `TelephonyAdapter` methods

### Step 3.3: IVR Methods (5)
- [ ] `handleLanguageMenu` — TeXML Gather with Say/Play
- [ ] `handleIncomingCall` — TeXML IVR flow
- [ ] `handleCaptchaResponse` — Digit verification + retry
- [ ] `handleCallAnswered` — Conference/bridge setup
- [ ] `handleVoicemail` — Record verb

### Step 3.4: Call Control Methods (5)
- [ ] `handleWaitMusic` — TeXML Play loop
- [ ] `rejectCall` — TeXML Reject
- [ ] `hangupCall` — Telnyx Call Control API: hangup
- [ ] `ringUsers` — Telnyx Call Control API: create outbound calls
- [ ] `cancelRinging` — Telnyx Call Control API: hangup legs

### Step 3.5: Webhook Methods (11)
- [ ] `validateWebhook` — Telnyx webhook signature verification
- [ ] All 7 webhook parsers — extract call info from Telnyx event payloads
- [ ] `getCallRecording` / `getRecordingAudio` / `deleteRecording` — Telnyx Recordings API

### Step 3.6: Health Methods (2)
- [ ] `testConnection` — Telnyx API credential test
- [ ] `verifyWebhookConfig` — Check TeXML application webhook URLs

### Step 3.7: Register Adapter
- [ ] **File:** `src/server/lib/adapters.ts`
- [ ] Replace `throw` at line 195-199 with `new TelnyxAdapter(config)`

### Step 3.8: Add Webhook Schemas
- [ ] **File:** `src/shared/schemas/external/telnyx.ts`
- [ ] Zod schemas for all Telnyx webhook event types (call.initiated, call.answered, call.hangup, etc.)

### Step 3.9: Update WebRTC Tokens
- [ ] **File:** `src/server/telephony/webrtc-tokens.ts`
- [ ] Replace `throw` at line 32 with proper Telnyx WebRTC token generation

### Step 3.10: Write Tests
- [ ] **File:** `src/server/telephony/telnyx.test.ts` (create)
- [ ] Test TeXML output for all IVR methods
- [ ] Test webhook parsing for all event types
- [ ] Test API call construction for call control
- [ ] Mock HTTP client

### Step 3.11: Verify
- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] `bun run test:unit`

---

## Phase 4: Vonage Webhook Verification

### Step 4.1: Research Vonage Application API
- [ ] Use context7 to look up Vonage Application API docs
- [ ] Document: JWT signing format (RS256), endpoint URL, response schema

### Step 4.2: Implement Verification
- [ ] **File:** `src/server/telephony/vonage.ts`
- [ ] Replace warning-only implementation at lines 594-607
- [ ] Sign JWT with RS256 using stored private key
- [ ] Query `GET /v1/applications/{applicationId}`
- [ ] Extract and compare voice webhook URLs

### Step 4.3: Write Tests
- [ ] **File:** `src/server/telephony/vonage.test.ts` (create or extend)
- [ ] Test JWT construction
- [ ] Test API response parsing
- [ ] Test URL comparison logic

### Step 4.4: Verify
- [ ] `bun run typecheck`
- [ ] `bun run test:unit`

---

## Commit Strategy

- Phase 1 (SignalWire WebRTC): standalone commit — small, self-contained
- Phase 2 (Telnyx SMS): standalone commit
- Phase 3 (Telnyx telephony): standalone commit — largest piece
- Phase 4 (Vonage verification): standalone commit
