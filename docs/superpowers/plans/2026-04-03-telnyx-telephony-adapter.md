# Telnyx Telephony Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a full TelephonyAdapter for Telnyx using the Call Control API (event-driven REST model).

**Architecture:** Adapter receives JSON webhook events, issues REST API commands to Telnyx internally, returns empty TelephonyResponse to route handler. Uses `client_state` (base64 JSON) for stateless context passing between webhook events. Ed25519 webhook signature verification.

**Tech Stack:** Bun, Hono, Zod, @noble/ed25519 (for webhook verification), Telnyx Call Control API v2

---

### Task 1: Webhook Event Schemas

**Files:**
- Create: `src/shared/schemas/external/telnyx-voice.ts`

- [ ] Create Zod schemas for all Telnyx Call Control webhook event types:
  - `TelnyxWebhookEventSchema` — common wrapper: `{ data: { record_type, event_type, id, occurred_at, payload } }`
  - `TelnyxCallInitiatedPayload` — `call_control_id, connection_id, call_leg_id, call_session_id, from, to, direction, state, start_time`
  - `TelnyxCallAnsweredPayload` — same core fields + `state: 'answered'`
  - `TelnyxCallHangupPayload` — core fields + `hangup_cause, hangup_source, sip_hangup_cause`
  - `TelnyxGatherEndedPayload` — core fields + `digits, status ('valid' | 'call_hangup' | 'timeout' | 'invalid')`
  - `TelnyxRecordingSavedPayload` — `call_leg_id, call_session_id, recording_started_at, recording_ended_at, channels, recording_urls: { mp3, wav }, public_recording_urls`
  - `TelnyxClientState` — `{ hubId?: string, lang: string, callSid: string, phase?: 'language' | 'captcha' | 'queue' }`
  - Helper: `decodeTelnyxClientState(raw: string): TelnyxClientState` — base64 decode + JSON parse
  - Helper: `encodeTelnyxClientState(state: TelnyxClientState): string` — JSON stringify + base64 encode
- [ ] Export all from barrel: add to `src/shared/schemas/external/index.ts` (if exists) or import directly
- [ ] `bun run typecheck`

### Task 2: API Client Helper

**Files:**
- Create: `src/server/telephony/telnyx-api.ts`

- [ ] Create a thin Telnyx Call Control API client:

```typescript
export class TelnyxCallControlClient {
  constructor(private apiKey: string) {}

  async command(callControlId: string, action: string, body?: Record<string, unknown>): Promise<void>
  async createCall(params: { to: string; from: string; connection_id: string; webhook_url?: string; client_state?: string }): Promise<{ call_control_id: string; call_leg_id: string; call_session_id: string }>
  async getRecording(url: string): Promise<ArrayBuffer>
  async deleteRecording(recordingId: string): Promise<void>
}
```

- [ ] `command()` POSTs to `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}` with Bearer auth
- [ ] `createCall()` POSTs to `https://api.telnyx.com/v2/calls`
- [ ] Error handling: throw `AppError` with Telnyx error details
- [ ] Write tests in `src/server/telephony/telnyx-api.test.ts` — mock fetch, test command/createCall/errors
- [ ] `bun run typecheck && bun test src/server/telephony/telnyx-api.test.ts`

### Task 3: TelnyxAdapter — IVR Methods

**Files:**
- Create: `src/server/telephony/telnyx.ts`

- [ ] Create `TelnyxAdapter implements TelephonyAdapter` class:
  - Constructor: `(apiKey: string, connectionId: string, phoneNumber: string)`
  - Private: `client: TelnyxCallControlClient`, `emptyTelephonyResponse()` helper

- [ ] Implement `handleLanguageMenu(params)`:
  1. `client.command(params.callSid, 'answer', { client_state: encode({ hubId, lang: 'en', callSid, phase: 'language' }) })`
  2. `client.command(params.callSid, 'gather_using_speak', { payload: IVR prompts, language, voice, min: 1, max: 1, ... })`
  3. Return `emptyTelephonyResponse()`

- [ ] Implement `handleIncomingCall(params)`:
  - If `rateLimited`: `client.command(callSid, 'hangup')` → return empty
  - If `voiceCaptchaEnabled`: `client.command(callSid, 'gather_using_speak', { captcha prompt, max: 4 })`
  - Else: `client.command(callSid, 'playback_start', { audio_url: hold_music, loop: 'infinity' })` → return empty

- [ ] Implement `handleCaptchaResponse(params)`:
  - If digits match: enqueue (playback hold music)
  - If wrong + retries: `gather_using_speak` with new digits
  - If wrong + no retries: `hangup`

- [ ] Implement `handleCallAnswered(params)`:
  1. `client.command(parentCallSid, 'bridge', { call_control_id: volunteerCallControlId })`
  2. `client.command(parentCallSid, 'record_start', { format: 'mp3', channels: 'single' })`
  3. Return empty

- [ ] Implement `handleVoicemail(params)`:
  1. `client.command(callSid, 'speak', { payload: voicemail prompt, voice, language })`
  2. `client.command(callSid, 'record_start', { format: 'mp3', play_beep: true })`
  3. Return empty

- [ ] Implement `handleWaitMusic(lang, audioUrls, queueTime, queueTimeout)`:
  - If `queueTime >= queueTimeout`: return signal to trigger voicemail
  - Else: `client.command(callSid, 'playback_start', { audio_url, loop: 'infinity' })` → empty

- [ ] Implement `handleVoicemailComplete`, `handleUnavailable`, `rejectCall`, `emptyResponse`

- [ ] `bun run typecheck`

### Task 4: TelnyxAdapter — Call Control & Recording Methods

**Files:**
- Modify: `src/server/telephony/telnyx.ts`

- [ ] Implement `hangupCall(callSid)`: `client.command(callSid, 'hangup')`
- [ ] Implement `ringUsers(params)`: For each volunteer with phone, `client.createCall({ to, from, connection_id, client_state, webhook_url })` — return array of call_control_ids
- [ ] Implement `cancelRinging(callSids, exceptSid)`: hangup each except `exceptSid`
- [ ] Implement `getCallRecording(callSid)`: Fetch from cached recording URL
- [ ] Implement `getRecordingAudio(recordingSid)`: `client.getRecording(url)`
- [ ] Implement `deleteRecording(recordingSid)`: `client.deleteRecording(recordingSid)`
- [ ] `bun run typecheck`

### Task 5: TelnyxAdapter — Webhook Methods

**Files:**
- Modify: `src/server/telephony/telnyx.ts`

- [ ] Implement `validateWebhook(request)`:
  1. Get `telnyx-signature-ed25519` and `telnyx-timestamp` headers
  2. Verify timestamp within 5 minutes
  3. Construct payload: `${timestamp}|${rawBody}`
  4. Verify Ed25519 signature (use `@noble/ed25519` or basic crypto.subtle)
  5. Cache Telnyx public key from `https://api.telnyx.com/v2/public_key`

- [ ] Implement all parse methods using Zod schemas from Task 1:
  - `parseIncomingWebhook`: parse `call.initiated` → `{ callSid: payload.call_control_id, callerNumber: payload.from, calledNumber: payload.to }`
  - `parseLanguageWebhook`: parse `call.gather.ended` → `{ callSid, callerNumber, digits }`
  - `parseCaptchaWebhook`: parse `call.gather.ended` → `{ digits, callerNumber }`
  - `parseCallStatusWebhook`: map `call.hangup` `hangup_cause` → normalized status
  - `parseQueueWaitWebhook`: extract queue duration from client_state
  - `parseQueueExitWebhook`: map hangup cause → queue result
  - `parseRecordingWebhook`: extract `recording_urls` → `{ status: 'completed', recordingSid }`

- [ ] Implement `testConnection()` and `verifyWebhookConfig()`
- [ ] `bun run typecheck`

### Task 6: Register Adapter & Write Tests

**Files:**
- Modify: `src/server/lib/adapters.ts`
- Create: `src/server/telephony/telnyx.test.ts`

- [ ] Register in `adapters.ts`: replace `throw new AppError(501, ...)` with `new TelnyxAdapter(config.apiKey, config.texmlAppId ?? '', config.phoneNumber)`
- [ ] Write unit tests (mock fetch):
  - Test `handleLanguageMenu` calls answer + gather_using_speak
  - Test `handleIncomingCall` with CAPTCHA enabled/disabled
  - Test `handleCaptchaResponse` correct/wrong/retry
  - Test `ringUsers` creates outbound calls
  - Test `cancelRinging` hangups all except one
  - Test all webhook parsers with sample payloads
  - Test `validateWebhook` signature verification
  - Test error handling on API failures
- [ ] `bun run typecheck && bun run build && bun run test:unit`

### Task 7: Commit & Verify

- [ ] `bun run typecheck && bun run build && bun run test:unit`
- [ ] Commit: `feat: implement Telnyx telephony adapter (Call Control API)`
- [ ] Update NEXT_BACKLOG.md to mark Telnyx adapter as complete
