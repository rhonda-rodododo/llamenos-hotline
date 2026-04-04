# Design: Telnyx Telephony Adapter (Call Control API)

**Date:** 2026-04-03
**Status:** Approved

## Overview

Implement a full `TelephonyAdapter` for Telnyx using their **Call Control API** — an event-driven REST model where the adapter receives webhook events and issues commands via REST API calls, rather than returning XML/JSON response bodies.

## Architecture

### Event-Driven Model

Unlike Twilio (return TwiML XML) or Vonage (return NCCO JSON), Telnyx Call Control works by:

1. Receiving webhook events (JSON POST with `data.event_type`)
2. Issuing REST commands to `https://api.telnyx.com/v2/calls/{call_control_id}/actions/{command}`
3. Returning empty `200 OK` to acknowledge the webhook

The adapter methods call the Telnyx API internally and return an empty `TelephonyResponse` to the route handler.

### Authentication

- **Outbound (API calls):** `Authorization: Bearer {apiKey}`
- **Inbound (webhooks):** Ed25519 signature verification using `telnyx-signature-ed25519` and `telnyx-timestamp` headers

### Key Identifiers

| Telnyx | Llamenos Equivalent | Purpose |
|--------|-------------------|---------|
| `call_control_id` | `callSid` | Unique per call, used for all commands |
| `call_session_id` | — | Groups related call legs |
| `connection_id` | — | Call Control App ID (from config) |

### State Passing via `client_state`

Telnyx supports a `client_state` field (base64-encoded string) that persists across webhook events for a call. We encode call context as base64 JSON:

```typescript
{ hubId?: string, lang: string, callSid: string }
```

This eliminates server-side state for multi-step flows (language menu → CAPTCHA → enqueue).

## Call Flow Mapping

### Incoming Call (`call.initiated`)

```
Telnyx webhook: call.initiated (direction: "incoming")
  → adapter.answer(call_control_id)  
  → adapter.gather_using_speak(language menu prompt, max_digits: 1)
  → return empty response
```

### Language Selection (`call.gather.ended`)

```
Telnyx webhook: call.gather.ended (digits from language menu)
  → Parse digit → determine language
  → If CAPTCHA enabled: gather_using_speak(CAPTCHA prompt, max_digits: 4)
  → If no CAPTCHA: playback_start(hold music, loop: infinity)
  → return empty response
```

### CAPTCHA (`call.gather.ended` with CAPTCHA context)

```
Telnyx webhook: call.gather.ended (digits from CAPTCHA)
  → Verify digits via settings.verifyCaptcha()
  → If correct: playback_start(hold music) → trigger parallel ring
  → If wrong + retries left: gather_using_speak(retry prompt)
  → If wrong + no retries: hangup
```

### Parallel Ring (Volunteer Outbound)

```
For each on-shift volunteer:
  → POST /v2/calls { to: volunteer_phone, from: hotline_number, connection_id }
  → Returns call_control_id per leg
```

### Volunteer Answers (`call.answered` on outbound leg)

```
Telnyx webhook: call.answered (outbound leg)
  → bridge(caller_call_control_id, volunteer_call_control_id)
  → Cancel other ringing legs: hangup(other_call_control_ids)
  → record_start(call_control_id) for call recording
```

### Voicemail (timeout, no volunteers answer)

```
Timer expires → speak(voicemail prompt)
  → record_start with beep
  → On call.recording.saved webhook: download + store recording
```

### Hangup

```
POST /v2/calls/{call_control_id}/actions/hangup
```

## Telnyx API Commands Used

| Command | Endpoint | Purpose |
|---------|----------|---------|
| `answer` | `POST /actions/answer` | Accept incoming call |
| `hangup` | `POST /actions/hangup` | End call |
| `speak` | `POST /actions/speak` | TTS playback |
| `playback_start` | `POST /actions/playback_start` | Play audio URL |
| `gather` | `POST /actions/gather` | Collect DTMF digits |
| `gather_using_speak` | `POST /actions/gather_using_speak` | TTS + DTMF collection |
| `record_start` | `POST /actions/record_start` | Start recording |
| `record_stop` | `POST /actions/record_stop` | Stop recording |
| `bridge` | `POST /actions/bridge` | Connect two call legs |
| `transfer` | `POST /actions/transfer` | Transfer to destination |
| `POST /v2/calls` | Top-level | Create outbound call |

## Webhook Events Handled

| Event | When | Handler |
|-------|------|---------|
| `call.initiated` | Incoming call arrives | Answer + language menu |
| `call.answered` | Outbound leg answered | Bridge calls |
| `call.gather.ended` | DTMF digits collected | Language/CAPTCHA routing |
| `call.hangup` | Call ended | Cleanup |
| `call.recording.saved` | Recording available | Download + store |
| `call.speak.ended` | TTS finished | Continue flow |
| `call.playback.ended` | Audio finished | Continue flow |

## Webhook Validation

Ed25519 signature verification:
1. Get `telnyx-signature-ed25519` and `telnyx-timestamp` headers
2. Construct signing payload: `{timestamp}|{raw_body}`
3. Verify Ed25519 signature against Telnyx's public key
4. Reject if timestamp is >5 minutes old

Telnyx's public key is fetched from `https://api.telnyx.com/v2/public_key` and cached.

## TelephonyAdapter Method Implementations

### IVR Methods (return empty response, issue commands internally)

- **handleLanguageMenu:** `answer` → `gather_using_speak` with language prompts
- **handleIncomingCall:** Parse gather result → CAPTCHA or enqueue flow
- **handleCaptchaResponse:** Verify digits → retry/enqueue/reject
- **handleCallAnswered:** `bridge` caller and volunteer + `record_start`
- **handleVoicemail:** `speak` prompt → `record_start`
- **handleWaitMusic:** `playback_start` with hold music URL, `loop: infinity`
- **handleVoicemailComplete:** `speak` thank you → `hangup`
- **handleUnavailable:** `speak` unavailable message → `hangup`
- **rejectCall:** `reject` command (or `hangup` if already answered)
- **emptyResponse:** Return `{ contentType: 'application/json', body: '{}' }`

### Call Control Methods

- **hangupCall:** `POST /actions/hangup`
- **ringUsers:** `POST /v2/calls` per volunteer with `link_to` for session correlation
- **cancelRinging:** `POST /actions/hangup` for each ringing leg

### Recording Methods

- **getCallRecording:** Fetch from `recording_urls.mp3` (from webhook payload, cached)
- **getRecordingAudio:** Same
- **deleteRecording:** `DELETE /v2/recordings/{recording_id}`

### Webhook Parsing Methods

All parse the common Telnyx JSON structure `{ data: { event_type, payload: { ... } } }`:
- **parseIncomingWebhook:** Extract `from`, `to`, `call_control_id` from `call.initiated`
- **parseLanguageWebhook:** Extract digits from `call.gather.ended`
- **parseCaptchaWebhook:** Extract digits + caller number from `call.gather.ended`
- **parseCallStatusWebhook:** Map `call.hangup` to status
- **parseQueueWaitWebhook:** Extract queue duration (from client_state timer)
- **parseQueueExitWebhook:** Extract exit reason
- **parseRecordingWebhook:** Extract `recording_urls` from `call.recording.saved`

### Health Methods

- **testConnection:** `GET /v2/messaging_profiles` (or `/v2/connections`) with Bearer auth
- **verifyWebhookConfig:** Query TeXML/Call Control App config and compare webhook URLs

## Config Schema

Uses existing `TelnyxConfigSchema` from `src/shared/schemas/providers.ts`:
```typescript
{
  type: 'telnyx',
  apiKey: string,       // Bearer token for API calls
  texmlAppId?: string,  // Call Control App ID (connection_id)
  phoneNumber: string,
}
```

The `texmlAppId` field serves as the `connection_id` for Call Control (name is legacy from TeXML era).

## Files

| File | Action | Description |
|------|--------|-------------|
| `src/server/telephony/telnyx.ts` | Create | TelnyxAdapter class (~500 lines) |
| `src/shared/schemas/external/telnyx-voice.ts` | Create | Zod schemas for webhook events |
| `src/server/lib/adapters.ts` | Modify | Register adapter in switch statement |
| `src/server/telephony/telnyx.test.ts` | Create | Unit tests |

## Testing

- Unit tests mock `fetch` for API calls
- Test each IVR flow (language menu, CAPTCHA, enqueue)
- Test webhook parsing for all event types
- Test Ed25519 signature validation
- Test error handling (API failures, network errors)
- Live testing requires Telnyx account + Call Control App (deferred)
