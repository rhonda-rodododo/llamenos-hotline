# Provider Simulation Suite — Design Spec

**Goal:** Add a realistic webhook simulation infrastructure to v1 that mirrors v2's test simulation endpoints, but routes payloads through the full adapter parsing and validation stack rather than bypassing it. This closes the gap where v1 has only database-reset endpoints and no way to simulate telephony or messaging events in E2E tests.

---

## Background

v1 currently has three dev endpoints (`/api/test-reset`, `/api/test-reset-no-admin`, `/api/test-reset-records`) and no simulation infrastructure. v2 (`~/projects/llamenos`) has a full `/api/dev/test-simulate/*` suite that injects state directly into Durable Objects.

This spec defines a more rigorous approach: simulation endpoints generate correct provider-formatted payloads (exact field names, encoding, headers) and POST them to the real webhook endpoints. The full adapter path (webhook validation bypass in dev, payload parsing, routing, service layer) executes on every simulated event.

---

## Architecture

### Layer 1 — Payload Factory

**File:** `src/worker/lib/test-payload-factory.ts`

Pure functions that return `{ body: string | Record<string, string>, contentType: string, headers: Record<string, string>, path: string }` for any provider × event combination.

This module is the single source of truth for "what does provider X's webhook payload actually look like". It is:
- Imported from dev-gated routes only (never from production code paths)
- Self-documenting: each provider's factory function is annotated with the field names and formats from that provider's documentation

**Note on tree-shaking:** The Bun server is not bundled and Wrangler bundles the entire worker entry point unconditionally. The factory is always included in the built artifact. The constraint to only import from dev-gated routes is for code clarity, not build-time elimination. The runtime `ENVIRONMENT !== 'development'` guard in dev.ts ensures factory code is never reachable in production.

Signature generation is omitted by default — see "Signature Handling" below. The factory accepts an optional `sign: boolean` param (with `secret: string`) for explicit signature generation when testing the validation rejection path.

### Layer 2 — Simulation Endpoints

**File:** `src/worker/routes/dev.ts` (extended, not replaced)

Six new endpoints added under the existing dev route, behind the same `ENVIRONMENT !== 'development'` and `X-Test-Secret` guards. Dev routes are mounted at `/api/` (via `api.route('/', devRoutes)` in `app.ts`), so endpoints are reachable at:

```
POST /api/test-simulate/incoming-call
POST /api/test-simulate/answer-call
POST /api/test-simulate/end-call
POST /api/test-simulate/voicemail
POST /api/test-simulate/incoming-message
POST /api/test-simulate/delivery-status
```

Each endpoint:
1. Reads `?provider=` query param (required)
2. Reads `?channel=` query param (required for messaging endpoints)
3. Parses JSON body for simulation params
4. Calls the payload factory for `provider × event`
5. POSTs the generated payload to the real webhook URL on the same origin, with `CF-Connecting-IP: 127.0.0.1` header set (required for dev bypass — see below)
6. Returns the webhook handler's response (TwiML XML, NCCO JSON, Asterisk ARI command JSON, or 200 status for messaging)

Returning the webhook response lets Playwright tests assert on adapter output (e.g. "Asterisk received a `queue` command"), not just downstream side effects.

### Layer 3 — Playwright Helpers

**File:** `tests/helpers/simulation.ts`

This file is part of the `tests/helpers/` directory created by the shared test helpers migration (renaming `tests/helpers.ts` → `tests/helpers/index.ts`). That migration is a prerequisite; if not yet done, create `tests/helpers/simulation.ts` as part of this plan's first step.

Thin wrappers around the simulation endpoints. Exported functions:

```typescript
simulateIncomingCall(request: APIRequestContext, params: SimulateCallParams): Promise<Response>
simulateAnswerCall(request: APIRequestContext, params: SimulateCallParams): Promise<Response>
simulateEndCall(request: APIRequestContext, params: SimulateCallParams): Promise<Response>
simulateVoicemail(request: APIRequestContext, params: SimulateCallParams): Promise<Response>
simulateIncomingMessage(request: APIRequestContext, params: SimulateMessageParams): Promise<Response>
simulateDeliveryStatus(request: APIRequestContext, params: SimulateMessageParams): Promise<Response>
```

These call the simulation endpoints via Playwright's `APIRequestContext` using the test secret from the environment. All auto-generate IDs if not provided.

---

## Signature Handling

### Telephony webhook bypass

The dev bypass for telephony signature validation lives in the **telephony router middleware** (`src/worker/routes/telephony.ts`), NOT in the adapter `validateWebhook()` methods. The bypass condition is:

```typescript
const isDev = env.ENVIRONMENT === 'development'
const isLocal = isDev && (
  c.req.header('CF-Connecting-IP') === '127.0.0.1' ||
  url.hostname === 'localhost'
)
```

When simulation endpoints make server-to-server POSTs to telephony webhook paths, they **must** set the `CF-Connecting-IP: 127.0.0.1` header on the outgoing request, or use `http://localhost/...` as the target URL. Without this, the adapter's HMAC validation will reject the request even in development.

The payload factory does not generate signature headers by default for telephony events.

### Messaging webhook — no bypass exists

The messaging router (`src/worker/messaging/router.ts`) calls `adapter.validateWebhook()` directly with **no dev bypass guard**. Simulation POSTs to `/api/messaging/{channel}/webhook` will fail signature validation.

Two options for the implementation plan to choose from:
- **Option A (preferred):** Add a dev bypass to the messaging router, identical to the telephony router pattern. Guard behind `ENVIRONMENT === 'development'` + `CF-Connecting-IP: 127.0.0.1`.
- **Option B:** Have the factory generate real HMAC signatures for messaging payloads, using test secrets from env vars.

The implementation plan should pick Option A for consistency.

### Signature rejection tests (future)

For testing that invalid signatures are correctly rejected, the factory exports `buildInvalidSignatureHeaders(provider)` returning deliberately wrong headers. These tests POST directly to webhook endpoints and must force signature checking (bypass the localhost guard). This is out of scope for the initial implementation — document as a known gap.

---

## Endpoint API

### Common params

All endpoints accept JSON body. All fields optional with sensible defaults.

**`?provider=`** values: `twilio | signalwire | vonage | plivo | asterisk`
**`?channel=`** values (messaging only): `sms | whatsapp | signal | rcs`

### Telephony simulation params

```typescript
interface SimulateCallParams {
  callSid?: string           // auto-generated UUID if omitted
  callerNumber?: string      // default: "+15555550100"
  calledNumber?: string      // default: hub's configured hotline number
  digits?: string            // for language-selected, captcha-response
  status?: string            // for call-status / end-call: completed | busy | no-answer | failed
  volunteerPhones?: string[] // for answer-call: phones to ring (Asterisk bridge)
  parentCallSid?: string     // for answer-call: required — the inbound call SID (appended as ?parentCallSid= query param)
  volunteerPubkey?: string   // for answer-call: required — the answering volunteer's pubkey (appended as ?pubkey= query param)
  recordingSid?: string      // for recording-complete, voicemail-recording
  recordingStatus?: string   // default: provider-specific "done" value (see Asterisk note)
  hubId?: string             // default: primary hub
}
```

### Messaging simulation params

```typescript
interface SimulateMessageParams {
  messageSid?: string
  senderNumber?: string      // default: "+15555550200"
  body?: string              // default: "Test message"
  mediaUrl?: string          // optional; triggers MMS/media message path
  mediaType?: string         // e.g. "image/jpeg"
  status?: string            // for delivery-status: delivered | read | failed
  errorCode?: string         // for failed delivery status
  hubId?: string             // default: primary hub
}
```

---

## Provider × Event Coverage

### Telephony payload formats and webhook paths

| Simulation endpoint | Telephony webhook path | Notes |
|---|---|---|
| `incoming-call` | `POST /api/telephony/incoming` | |
| `language-selected` | `POST /api/telephony/language-selected` | |
| `captcha-response` | `POST /api/telephony/captcha` | |
| `answer-call` | `POST /api/telephony/volunteer-answer` | Provider notifies that a volunteer's phone was answered. The handler reads `parentCallSid` and `pubkey` from URL **query params** (not the body) — simulation endpoint must append `?parentCallSid=&pubkey=` from `SimulateCallParams`. |
| `end-call` | `POST /api/telephony/call-status` | Send completed/busy/no-answer status |
| `queue-wait` | `POST /api/telephony/wait-music` | |
| `queue-exit` | `POST /api/telephony/queue-exit` | |
| `recording-complete` | `POST /api/telephony/call-recording` | |
| `voicemail` | `POST /api/telephony/voicemail-recording` | |

### Telephony payload fields per provider

| Event | Twilio/SignalWire (form) | Vonage (JSON) | Plivo (form) | Asterisk (JSON) |
|---|---|---|---|---|
| incoming-call | `CallSid`, `From`, `To` | `uuid`, `conversation_uuid`, `from`, `to` | `CallUUID`, `From`, `To` | `event:"incoming"`, `channelId`, `callerNumber`, `calledNumber` |
| language-selected | `CallSid`, `From`, `Digits` | `uuid`, `from`, `dtmf.digits` | `CallUUID`, `From`, `Digits` | `event:"digits"`, `channelId`, `digits`, `callerNumber` |
| captcha-response | `Digits`, `From` | `from`, `dtmf.digits` | `Digits`, `From` | `event:"digits"`, `channelId`, `digits`, `metadata.type:"captcha"` |
| answer-call | `CallSid`, `CallStatus:"in-progress"` | `uuid`, `status:"answered"` | `CallUUID`, `CallStatus:"in-progress"` | `event:"status"`, `channelId`, `state:"up"` |
| end-call | `CallSid`, `CallStatus:"completed"` | `uuid`, `status:"completed"` | `CallUUID`, `CallStatus:"completed"` | `event:"status"`, `channelId`, `state:"down"` |
| queue-wait | `QueueTime` | `duration` | `ConferenceDuration` | `event:"queue_wait"`, `channelId`, `queueTime` |
| queue-exit | `QueueResult` | `status` | `ConferenceAction` | `event:"queue_exit"`, `channelId`, `result` |
| recording-complete | `RecordingStatus:"completed"`, `RecordingSid`, `CallSid` | `recording_url` | `RecordUrl`, `RecordingID`, `CallUUID` | `event:"recording"`, `channelId`, `recordingStatus:"done"`, `recordingName` |
| voicemail | same as recording-complete | same as recording-complete | same as recording-complete | `event:"recording"`, `channelId`, `recordingStatus:"done"`, `recordingName` |

**Asterisk `recordingStatus` note:** The Asterisk adapter maps `"done"` → normalized `"completed"`. The factory must emit `recordingStatus: "done"` (not `"completed"`) to correctly trigger the completed recording path.

**SignalWire note:** Payload fields are identical to Twilio. Signature header accepts either `X-SignalWire-Signature` or `X-Twilio-Signature`. The factory emits `X-Twilio-Signature` (which SignalWire's adapter accepts). Factory output for SignalWire can reuse Twilio's form builder.

**Vonage note:** Factory should emit both `uuid` and `conversation_uuid` (same value) since the adapter reads `data.uuid || data.conversation_uuid`.

### Messaging payloads

| Channel | Provider | Incoming fields | Status fields |
|---|---|---|---|
| sms | Twilio/SignalWire | form: `From`, `Body`, `MessageSid`, `To` | form: `MessageSid`, `MessageStatus` |
| sms | Vonage | JSON: `msisdn`, `text`, `messageId`, `to`, `type:"text"` | JSON: `messageId`, `status` |
| sms | Plivo | form: `From`, `Text`, `MessageUUID`, `To` | form: `MessageUUID`, `Status` |
| sms | Asterisk | delegates to Twilio SMS format | delegates to Twilio SMS format |
| whatsapp | Meta direct | JSON: `entry[0].changes[0].value.messages[0]` nested structure with `id`, `from`, `timestamp`, `text.body` | JSON: `entry[0].changes[0].value.statuses[0]` |
| whatsapp | Twilio | form: `From:"whatsapp:+..."`, `Body`, `MessageSid` | form: `MessageSid`, `MessageStatus` |
| signal | signal-cli bridge | JSON bridge format (match adapter's `parseIncomingMessage`) | N/A |
| rcs | Google RBM | JSON: `message.text`, `senderPhoneNumber`, `messageId` | JSON: `event.deliveryStatus` |

Messaging webhook path: `POST /api/messaging/{channel}/webhook?hub={hubId}`

---

## Asterisk Priority

Asterisk is the first provider to implement because:
1. It uses a custom ARI bridge (not a standard provider API) — most likely to have untested gaps
2. Its JSON payload format is unique; all other providers use known REST conventions
3. Asterisk SMS delegates — once telephony is verified, SMS simulation falls through to Twilio payload format automatically

**Asterisk ARI bridge payload format** (from `src/worker/telephony/asterisk.ts`):

```json
{
  "event": "incoming | digits | status | queue_wait | queue_exit | recording",
  "channelId": "ast-abc123",
  "callSid": "ast-abc123",
  "callerNumber": "+15555550100",
  "calledNumber": "+18005551234",
  "digits": "1",
  "state": "ring | up | down",
  "status": "ringing | answered | completed",
  "queueTime": 45,
  "result": "bridged | leave | queue-full | error | hangup",
  "reason": "hangup",
  "recordingStatus": "done | failed",
  "recordingName": "voicemail-ast-abc123",
  "recordingSid": "voicemail-ast-abc123"
}
```

Validation header: `X-Bridge-Signature` (HMAC-SHA256) + `X-Bridge-Timestamp`. Bypassed in dev via the telephony router middleware when `CF-Connecting-IP: 127.0.0.1` is set.

---

## Build Order

1. **Messaging router dev bypass** — add `ENVIRONMENT=development` + `CF-Connecting-IP` guard to `src/worker/messaging/router.ts` (prerequisite for messaging simulation)
2. **Asterisk telephony** — all 9 events, full payload factory coverage
3. **Twilio telephony** — all 9 events (SignalWire reuses Twilio factory with aliased header)
4. **Vonage + Plivo telephony** — all 9 events
5. **SMS messaging** — all provider variants
6. **WhatsApp** — Meta direct + Twilio mode
7. **Signal + RCS messaging**

E2E tests are written alongside each provider group, not deferred to the end.

---

## E2E Test Coverage

- `tests/call-flow.spec.ts` — already exists; extend with `simulateIncomingCall` for Asterisk + Twilio
- `tests/simulation-asterisk.spec.ts` — Asterisk-specific: full call lifecycle (incoming → language → queue → answer → end), voicemail path, recording callback; assert on ARI command JSON returned
- `tests/simulation-telephony.spec.ts` — Cross-provider smoke test: one full call flow per provider
- `tests/simulation-messaging.spec.ts` — Incoming message → conversation created, delivery status update, all channel variants

Test assertions for telephony simulations should verify:
- Correct adapter command response returned (e.g. Asterisk `{ commands: [{ action: 'queue', ... }] }`)
- Downstream effect (call record created, correct state in DB)

---

## Files Created / Modified

| File | Action |
|---|---|
| `src/worker/lib/test-payload-factory.ts` | Create |
| `src/worker/routes/dev.ts` | Extend (add 6 simulation endpoints) |
| `src/worker/messaging/router.ts` | Extend (add dev bypass matching telephony router pattern) |
| `tests/helpers/simulation.ts` | Create (prerequisite: `tests/helpers/` directory from helpers migration) |
| `tests/simulation-asterisk.spec.ts` | Create |
| `tests/simulation-telephony.spec.ts` | Create |
| `tests/simulation-messaging.spec.ts` | Create |
| `tests/call-flow.spec.ts` | Extend |

---

## Constraints

- `test-payload-factory.ts` must only be imported from dev-gated routes — never from production code paths. Runtime protection: `ENVIRONMENT !== 'development'` guard in dev.ts. Build-time tree-shaking does not apply (Bun/Wrangler bundles unconditionally).
- No new dependencies required; factory uses only built-in `crypto` for optional HMAC generation
- Simulation endpoints must remain behind the existing `ENVIRONMENT !== 'development'` + `X-Test-Secret` guard
- Asterisk SMS simulation uses `provider=asterisk&channel=sms` → factory emits Twilio SMS format (matching the delegation wrapper behaviour)
- Factory functions are pure — no side effects, no DB or network calls
- All simulation-to-webhook POSTs must set `CF-Connecting-IP: 127.0.0.1` to trigger the telephony router dev bypass
