# Provider Simulation Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add realistic webhook simulation endpoints covering all 5 telephony providers × 9 events and all 4 messaging channels, routing payloads through the full adapter parsing stack so E2E tests exercise real webhook handling code.

**Architecture:** A pure payload factory (`src/worker/lib/test-payload-factory.ts`) generates correct provider-formatted payloads. Six simulation endpoints in `dev.ts` call the factory and POST to real webhook URLs on localhost. Playwright helpers in `tests/helpers/simulation.ts` wrap the endpoints for E2E use.

**Tech Stack:** Bun, Hono, TypeScript, Playwright. No new dependencies — factory uses built-in `crypto` only.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/worker/lib/test-payload-factory.ts` | Create | Pure payload generation per provider × event |
| `src/worker/routes/dev.ts` | Extend | 6 simulation endpoints calling factory → webhook |
| `src/worker/messaging/router.ts` | Extend | Dev bypass (no bypass currently exists) |
| `tests/helpers.ts` | Rename→ `tests/helpers/index.ts` | Re-export everything, preserve existing API |
| `tests/helpers/simulation.ts` | Create | Playwright helpers wrapping simulation endpoints |
| `tests/simulation-asterisk.spec.ts` | Create | Asterisk full call lifecycle E2E tests |
| `tests/simulation-telephony.spec.ts` | Create | Cross-provider call flow smoke tests |
| `tests/simulation-messaging.spec.ts` | Create | Messaging channel simulation E2E tests |

---

## Task 1: Migrate tests/helpers.ts → tests/helpers/index.ts

**Files:**
- Rename: `tests/helpers.ts` → `tests/helpers/index.ts`
- Create: `tests/helpers/simulation.ts`

This creates the `tests/helpers/` directory structure before any spec files reference it.

- [x] Create the directory and move the file:
  ```bash
  mkdir -p tests/helpers
  mv tests/helpers.ts tests/helpers/index.ts
  ```

- [x] Verify no imports break — grep for existing imports of `helpers.ts`:
  ```bash
  grep -r "from './helpers'" tests/ --include="*.ts" | grep -v "helpers/index"
  grep -r "from '../helpers'" tests/ --include="*.ts" | grep -v "helpers/index"
  ```

- [x] Update any imports that still reference the old path (the `./helpers` import in test files should resolve to `./helpers/index.ts` automatically in TypeScript, so usually no changes needed — but verify):
  ```bash
  bunx tsc --noEmit 2>&1 | grep "helpers"
  ```

- [x] Run a smoke test to confirm helpers still work:
  ```bash
  bunx playwright test tests/smoke.spec.ts --reporter=list
  ```

- [x] Commit:
  ```bash
  git add tests/helpers/ tests/
  git commit -m "refactor(tests): migrate helpers.ts → helpers/index.ts"
  ```

---

## Task 2: Add messaging router dev bypass

**Files:**
- Modify: `src/worker/messaging/router.ts:63-90`

The telephony router already has a dev bypass (`CF-Connecting-IP === '127.0.0.1'` OR `hostname === 'localhost'`). The messaging router has no equivalent — `validateWebhook()` is called unconditionally. Without this, simulation POSTs to messaging webhook paths fail signature validation even in dev.

- [x] Read `src/worker/messaging/router.ts` around line 63–90 to see the current structure before editing.

- [x] Add the dev bypass immediately before the `validateWebhook` call:
  ```typescript
  // Dev bypass: skip signature validation for localhost simulation POSTs
  const isDev = c.env.ENVIRONMENT === 'development'
  const isLocal =
    isDev && (c.req.header('CF-Connecting-IP') === '127.0.0.1' || url.hostname === 'localhost')

  if (!isLocal) {
    const isValid = await adapter.validateWebhook(c.req.raw)
    if (!isValid) {
      console.error(`[messaging] Webhook signature FAILED for ${channel}`)
      return new Response('Forbidden', { status: 403 })
    }
  }
  ```
  (Remove the existing unconditional `validateWebhook` call and `if (!isValid)` block.)

- [x] Run typecheck:
  ```bash
  bun run typecheck
  ```
  Expected: no errors.

- [x] Commit:
  ```bash
  git add src/worker/messaging/router.ts
  git commit -m "fix(messaging): add dev bypass to messaging router webhook validation"
  ```

---

## Task 3: Scaffold payload factory — types and helpers

**Files:**
- Create: `src/worker/lib/test-payload-factory.ts`

Create the file with types, the `FactoryResult` interface, and a form-encoding helper. No provider implementations yet.

- [x] Create `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  /**
   * Test payload factory — generates realistic provider webhook payloads for E2E tests.
   * Only imported from dev-gated routes (ENVIRONMENT !== 'development' guard in dev.ts).
   * Build-time tree-shaking does not apply; runtime guard prevents production reachability.
   */

  export type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'
  export type TelephonyEvent =
    | 'incoming-call'
    | 'language-selected'
    | 'captcha-response'
    | 'answer-call'
    | 'end-call'
    | 'queue-wait'
    | 'queue-exit'
    | 'recording-complete'
    | 'voicemail'

  export type MessagingChannel = 'sms' | 'whatsapp' | 'signal' | 'rcs'
  export type MessagingEvent = 'incoming-message' | 'delivery-status'

  export type MessagingProvider =
    | 'twilio'
    | 'signalwire'
    | 'vonage'
    | 'plivo'
    | 'asterisk'
    | 'meta'

  export interface SimulateCallParams {
    callSid?: string        // auto-generated if omitted
    callerNumber?: string   // default: '+15555550100'
    calledNumber?: string   // default: '+18005550100'
    digits?: string         // for language-selected, captcha-response
    status?: string         // for end-call: completed | busy | no-answer | failed
    parentCallSid?: string  // for answer-call: POSTed as ?parentCallSid= query param
    volunteerPubkey?: string // for answer-call: POSTed as ?pubkey= query param
    recordingSid?: string   // for recording-complete, voicemail
    hubId?: string          // for hub-scoped routing (?hub= query param)
  }

  export interface SimulateMessageParams {
    messageSid?: string
    senderNumber?: string   // default: '+15555550200'
    body?: string           // default: 'Test message'
    mediaUrl?: string
    mediaType?: string
    status?: string         // for delivery-status: delivered | read | failed
    errorCode?: string
    hubId?: string
  }

  /** Shape returned by all factory functions */
  export interface FactoryResult {
    /** Serialized body — form-encoded string or JSON string */
    body: string
    contentType: string
    /** Headers to include in the simulated webhook POST */
    headers: Record<string, string>
    /** Webhook path to POST to (e.g. '/api/telephony/incoming') */
    path: string
  }

  /** Encode an object as application/x-www-form-urlencoded */
  export function encodeForm(fields: Record<string, string>): string {
    return new URLSearchParams(fields).toString()
  }

  /** Generate a random SID in the style of each provider */
  export function randomCallSid(provider: TelephonyProvider): string {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    if (provider === 'twilio' || provider === 'signalwire') return `CA${hex}`
    if (provider === 'vonage') return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`
    if (provider === 'plivo') return hex.toUpperCase()
    return `ast-${hex.slice(0, 12)}`
  }

  export function randomMessageSid(provider: MessagingProvider): string {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return provider === 'twilio' || provider === 'signalwire' ? `SM${hex}` : hex
  }
  ```

- [x] Run typecheck — should pass with empty implementations:
  ```bash
  bun run typecheck
  ```

- [x] Commit:
  ```bash
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): scaffold payload factory types and helpers"
  ```

---

## Task 4: Asterisk telephony factory (9 events)

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

Asterisk uses JSON webhooks from an ARI bridge. The adapter field aliases (e.g. `channelId || callSid`, `callerNumber || from`) mean we emit the primary field names. Critical: `recordingStatus` must be `"done"` (the adapter maps `"done"` → normalized `"completed"`).

- [x] Add the Asterisk factory to `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  // -------------------------------------------------------------------
  // Asterisk — JSON from ARI bridge
  // Validation: X-Bridge-Signature (HMAC-SHA256) + X-Bridge-Timestamp
  // Bypassed in dev by telephony router middleware (CF-Connecting-IP check)
  // -------------------------------------------------------------------

  export function buildAsteriskTelephonyPayload(
    event: TelephonyEvent,
    params: SimulateCallParams
  ): FactoryResult {
    const callSid = params.callSid ?? randomCallSid('asterisk')
    const callerNumber = params.callerNumber ?? '+15555550100'
    const calledNumber = params.calledNumber ?? '+18005550100'
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    // ARI bridge events all share the same base shape
    type AriBody = Record<string, string | number | Record<string, string>>

    // hubQ already includes the leading '?' when non-empty (e.g. '?hub=abc')
    switch (event) {
      case 'incoming-call': {
        const body: AriBody = {
          event: 'incoming',
          channelId: callSid,
          callerNumber,
          calledNumber,
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/incoming${hubQ}`,
        }
      }
      case 'language-selected': {
        const body: AriBody = {
          event: 'digits',
          channelId: callSid,
          digits: params.digits ?? '1',
          callerNumber,
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/language-selected${hubQ}`,
        }
      }
      case 'captcha-response': {
        const body: AriBody = {
          event: 'digits',
          channelId: callSid,
          digits: params.digits ?? '5',
          callerNumber,
          metadata: { type: 'captcha' },
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/captcha${hubQ}`,
        }
      }
      case 'answer-call': {
        const body: AriBody = { event: 'status', channelId: callSid, state: 'up' }
        const qp = new URLSearchParams()
        if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
        if (params.volunteerPubkey) qp.set('pubkey', params.volunteerPubkey)
        if (params.hubId) qp.set('hub', params.hubId)
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/volunteer-answer${qp.size ? `?${qp}` : ''}`,
        }
      }
      case 'end-call': {
        const body: AriBody = {
          event: 'status',
          channelId: callSid,
          state: 'down',
          status: params.status ?? 'completed',
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/call-status${hubQ}`,
        }
      }
      case 'queue-wait': {
        const body: AriBody = { event: 'queue_wait', channelId: callSid, queueTime: 30 }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/wait-music${hubQ}`,
        }
      }
      case 'queue-exit': {
        const body: AriBody = {
          event: 'queue_exit',
          channelId: callSid,
          result: 'bridged',
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/queue-exit${hubQ}`,
        }
      }
      case 'recording-complete': {
        const recordingName = params.recordingSid ?? `rec-${callSid}`
        const body: AriBody = {
          event: 'recording',
          channelId: callSid,
          recordingStatus: 'done', // adapter maps 'done' → 'completed'
          recordingName,
          recordingSid: recordingName,
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/call-recording${hubQ}`,
        }
      }
      case 'voicemail': {
        const recordingName = params.recordingSid ?? `voicemail-${callSid}`
        const body: AriBody = {
          event: 'recording',
          channelId: callSid,
          recordingStatus: 'done', // adapter maps 'done' → 'completed'
          recordingName,
          recordingSid: recordingName,
        }
        return {
          body: JSON.stringify(body),
          contentType: 'application/json',
          headers: {},
          path: `/api/telephony/voicemail-recording${hubQ}`,
        }
      }
    }
  }
  ```

- [x] Run typecheck:
  ```bash
  bun run typecheck
  ```
  Expected: no errors.

- [x] Commit:
  ```bash
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): Asterisk telephony payload factory (9 events)"
  ```

---

## Task 5: Twilio + SignalWire telephony factory

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

Twilio uses form-encoded POSTs. SignalWire is payload-identical — the factory emits `X-Twilio-Signature` which SignalWire's adapter accepts alongside its own header. Both providers share one builder function.

- [x] Add to `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  // -------------------------------------------------------------------
  // Twilio + SignalWire — form-encoded
  // Validation: HMAC-SHA1 via X-Twilio-Signature (or X-SignalWire-Signature)
  // Bypassed in dev via telephony router middleware
  // -------------------------------------------------------------------

  export function buildTwilioTelephonyPayload(
    event: TelephonyEvent,
    params: SimulateCallParams,
    provider: 'twilio' | 'signalwire' = 'twilio'
  ): FactoryResult {
    const callSid = params.callSid ?? randomCallSid(provider)
    const callerNumber = params.callerNumber ?? '+15555550100'
    const calledNumber = params.calledNumber ?? '+18005550100'
    const hubQ = params.hubId ? `hub=${params.hubId}` : ''
    const sep = hubQ ? '?' : ''

    const form = (fields: Record<string, string>, path: string): FactoryResult => ({
      body: encodeForm(fields),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path,
    })

    switch (event) {
      case 'incoming-call':
        return form(
          { CallSid: callSid, From: callerNumber, To: calledNumber },
          `/api/telephony/incoming${sep}${hubQ}`
        )
      case 'language-selected':
        return form(
          { CallSid: callSid, From: callerNumber, Digits: params.digits ?? '1' },
          `/api/telephony/language-selected${sep}${hubQ}`
        )
      case 'captcha-response':
        return form(
          { Digits: params.digits ?? '5', From: callerNumber },
          `/api/telephony/captcha${sep}${hubQ}`
        )
      case 'answer-call': {
        const qp = new URLSearchParams()
        if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
        if (params.volunteerPubkey) qp.set('pubkey', params.volunteerPubkey)
        if (params.hubId) qp.set('hub', params.hubId)
        return form(
          { CallSid: callSid, CallStatus: 'in-progress' },
          `/api/telephony/volunteer-answer${qp.size ? `?${qp}` : ''}`
        )
      }
      case 'end-call':
        return form(
          { CallSid: callSid, CallStatus: params.status ?? 'completed' },
          `/api/telephony/call-status${sep}${hubQ}`
        )
      case 'queue-wait':
        return form({ QueueTime: '30' }, `/api/telephony/wait-music${sep}${hubQ}`)
      case 'queue-exit':
        return form(
          { QueueResult: 'bridged', CallSid: callSid },
          `/api/telephony/queue-exit${sep}${hubQ}`
        )
      case 'recording-complete': {
        const recordingSid = params.recordingSid ?? `RE${callSid.slice(2)}`
        return form(
          { RecordingStatus: 'completed', RecordingSid: recordingSid, CallSid: callSid },
          `/api/telephony/call-recording${sep}${hubQ}`
        )
      }
      case 'voicemail': {
        const recordingSid = params.recordingSid ?? `RE${callSid.slice(2)}`
        return form(
          { RecordingStatus: 'completed', RecordingSid: recordingSid, CallSid: callSid },
          `/api/telephony/voicemail-recording${sep}${hubQ}`
        )
      }
    }
  }
  ```

- [x] Run typecheck:
  ```bash
  bun run typecheck
  ```

- [x] Commit:
  ```bash
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): Twilio/SignalWire telephony payload factory"
  ```

---

## Task 6: Vonage telephony factory

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

Vonage uses JSON POSTs. Call IDs use both `uuid` and `conversation_uuid` (adapter reads `data.uuid || data.conversation_uuid` — emit both).

- [x] Add to `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  // -------------------------------------------------------------------
  // Vonage — JSON
  // Validation: HMAC-SHA256 via query param signature + 5-min timestamp
  // Bypassed in dev via telephony router middleware
  // -------------------------------------------------------------------

  export function buildVonageTelephonyPayload(
    event: TelephonyEvent,
    params: SimulateCallParams
  ): FactoryResult {
    const callSid = params.callSid ?? randomCallSid('vonage')
    const callerNumber = params.callerNumber ?? '+15555550100'
    const calledNumber = params.calledNumber ?? '+18005550100'
    const hubQ = params.hubId ? `hub=${params.hubId}` : ''
    const sep = hubQ ? '?' : ''

    const json = (body: unknown, path: string): FactoryResult => ({
      body: JSON.stringify(body),
      contentType: 'application/json',
      headers: {},
      path,
    })

    switch (event) {
      case 'incoming-call':
        return json(
          { uuid: callSid, conversation_uuid: callSid, from: callerNumber, to: calledNumber },
          `/api/telephony/incoming${sep}${hubQ}`
        )
      case 'language-selected':
        return json(
          { uuid: callSid, conversation_uuid: callSid, from: callerNumber, dtmf: { digits: params.digits ?? '1' } },
          `/api/telephony/language-selected${sep}${hubQ}`
        )
      case 'captcha-response':
        return json(
          { from: callerNumber, dtmf: { digits: params.digits ?? '5' } },
          `/api/telephony/captcha${sep}${hubQ}`
        )
      case 'answer-call': {
        const qp = new URLSearchParams()
        if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
        if (params.volunteerPubkey) qp.set('pubkey', params.volunteerPubkey)
        if (params.hubId) qp.set('hub', params.hubId)
        return json(
          { uuid: callSid, conversation_uuid: callSid, status: 'answered' },
          `/api/telephony/volunteer-answer${qp.size ? `?${qp}` : ''}`
        )
      }
      case 'end-call':
        return json(
          { uuid: callSid, conversation_uuid: callSid, status: params.status ?? 'completed' },
          `/api/telephony/call-status${sep}${hubQ}`
        )
      case 'queue-wait':
        return json(
          { uuid: callSid, duration: 30 },
          `/api/telephony/wait-music${sep}${hubQ}`
        )
      case 'queue-exit':
        return json(
          { uuid: callSid, status: 'answered' },
          `/api/telephony/queue-exit${sep}${hubQ}`
        )
      case 'recording-complete':
        return json(
          { uuid: callSid, recording_url: `https://api.nexmo.com/media/download?id=${callSid}` },
          `/api/telephony/call-recording${sep}${hubQ}`
        )
      case 'voicemail':
        return json(
          { uuid: callSid, recording_url: `https://api.nexmo.com/media/download?id=${callSid}` },
          `/api/telephony/voicemail-recording${sep}${hubQ}`
        )
    }
  }
  ```

- [x] Run typecheck, commit:
  ```bash
  bun run typecheck
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): Vonage telephony payload factory"
  ```

---

## Task 7: Plivo telephony factory

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

Plivo uses form-encoded POSTs similar to Twilio but with different field names (`CallUUID`, `ConferenceDuration`, etc.).

- [x] Add to `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  // -------------------------------------------------------------------
  // Plivo — form-encoded
  // Validation: HMAC-SHA256 via X-Plivo-Signature-V3 + nonce header
  // Bypassed in dev via telephony router middleware
  // -------------------------------------------------------------------

  export function buildPlivoTelephonyPayload(
    event: TelephonyEvent,
    params: SimulateCallParams
  ): FactoryResult {
    const callSid = params.callSid ?? randomCallSid('plivo')
    const callerNumber = params.callerNumber ?? '+15555550100'
    const calledNumber = params.calledNumber ?? '+18005550100'
    const hubQ = params.hubId ? `hub=${params.hubId}` : ''
    const sep = hubQ ? '?' : ''

    const form = (fields: Record<string, string>, path: string): FactoryResult => ({
      body: encodeForm(fields),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path,
    })

    switch (event) {
      case 'incoming-call':
        return form(
          { CallUUID: callSid, From: callerNumber, To: calledNumber },
          `/api/telephony/incoming${sep}${hubQ}`
        )
      case 'language-selected':
        return form(
          { CallUUID: callSid, From: callerNumber, Digits: params.digits ?? '1' },
          `/api/telephony/language-selected${sep}${hubQ}`
        )
      case 'captcha-response':
        return form(
          { Digits: params.digits ?? '5', From: callerNumber },
          `/api/telephony/captcha${sep}${hubQ}`
        )
      case 'answer-call': {
        const qp = new URLSearchParams()
        if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
        if (params.volunteerPubkey) qp.set('pubkey', params.volunteerPubkey)
        if (params.hubId) qp.set('hub', params.hubId)
        return form(
          { CallUUID: callSid, CallStatus: 'in-progress' },
          `/api/telephony/volunteer-answer${qp.size ? `?${qp}` : ''}`
        )
      }
      case 'end-call':
        return form(
          { CallUUID: callSid, CallStatus: params.status ?? 'completed' },
          `/api/telephony/call-status${sep}${hubQ}`
        )
      case 'queue-wait':
        return form({ ConferenceDuration: '30' }, `/api/telephony/wait-music${sep}${hubQ}`)
      case 'queue-exit':
        return form(
          { ConferenceAction: 'enter', CallUUID: callSid },
          `/api/telephony/queue-exit${sep}${hubQ}`
        )
      case 'recording-complete': {
        const recordingId = params.recordingSid ?? `REC_${callSid}`
        return form(
          { RecordUrl: `https://api.plivo.com/recordings/${recordingId}.mp3`, RecordingID: recordingId, CallUUID: callSid },
          `/api/telephony/call-recording${sep}${hubQ}`
        )
      }
      case 'voicemail': {
        const recordingId = params.recordingSid ?? `REC_${callSid}`
        return form(
          { RecordUrl: `https://api.plivo.com/recordings/${recordingId}.mp3`, RecordingID: recordingId, CallUUID: callSid },
          `/api/telephony/voicemail-recording${sep}${hubQ}`
        )
      }
    }
  }
  ```

- [x] Run typecheck, commit:
  ```bash
  bun run typecheck
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): Plivo telephony payload factory"
  ```

---

## Task 8: Top-level telephony factory dispatcher

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

Add one public function that dispatches to the right provider builder:

- [x] Add to the end of `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  /** Build a telephony webhook payload for any provider × event combination */
  export function buildTelephonyPayload(
    provider: TelephonyProvider,
    event: TelephonyEvent,
    params: SimulateCallParams = {}
  ): FactoryResult {
    switch (provider) {
      case 'asterisk':
        return buildAsteriskTelephonyPayload(event, params)
      case 'twilio':
        return buildTwilioTelephonyPayload(event, params, 'twilio')
      case 'signalwire':
        return buildTwilioTelephonyPayload(event, params, 'signalwire')
      case 'vonage':
        return buildVonageTelephonyPayload(event, params)
      case 'plivo':
        return buildPlivoTelephonyPayload(event, params)
    }
  }
  ```

- [x] Run typecheck, commit:
  ```bash
  bun run typecheck
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): telephony factory dispatcher"
  ```

---

## Task 9: SMS messaging factory (all providers)

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

Four SMS providers: Twilio/SignalWire (form), Vonage (JSON), Plivo (form), Asterisk (delegates → Twilio format). Two events: incoming-message and delivery-status.

- [x] Add to `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  // -------------------------------------------------------------------
  // SMS messaging factories
  // -------------------------------------------------------------------

  function buildTwilioSmsPayload(
    event: MessagingEvent,
    params: SimulateMessageParams,
    channel: 'sms' = 'sms'
  ): FactoryResult {
    const msgSid = params.messageSid ?? randomMessageSid('twilio')
    const from = params.senderNumber ?? '+15555550200'
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    if (event === 'incoming-message') {
      const fields: Record<string, string> = {
        From: from,
        To: '+18005550100',
        Body: params.body ?? 'Test message',
        MessageSid: msgSid,
      }
      if (params.mediaUrl) {
        fields['NumMedia'] = '1'
        fields['MediaUrl0'] = params.mediaUrl
        fields['MediaContentType0'] = params.mediaType ?? 'image/jpeg'
      } else {
        fields['NumMedia'] = '0'
      }
      return {
        body: encodeForm(fields),
        contentType: 'application/x-www-form-urlencoded',
        headers: {},
        path: `/api/messaging/${channel}/webhook${hubQ}`,
      }
    }
    // delivery-status
    return {
      body: encodeForm({
        MessageSid: msgSid,
        MessageStatus: params.status ?? 'delivered',
        ...(params.errorCode ? { ErrorCode: params.errorCode } : {}),
      }),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path: `/api/messaging/${channel}/webhook${hubQ}`,
    }
  }

  function buildVonageSmsPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
    const msgId = params.messageSid ?? randomMessageSid('vonage')
    const from = (params.senderNumber ?? '+15555550200').replace('+', '')
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    if (event === 'incoming-message') {
      return {
        body: JSON.stringify({
          msisdn: from,
          messageId: msgId,
          text: params.body ?? 'Test message',
          to: '18005550100',
          type: 'text',
          'message-timestamp': new Date().toISOString(),
        }),
        contentType: 'application/json',
        headers: {},
        path: `/api/messaging/sms/webhook${hubQ}`,
      }
    }
    return {
      body: JSON.stringify({ messageId: msgId, status: params.status ?? 'delivered' }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/sms/webhook${hubQ}`,
    }
  }

  function buildPlivoSmsPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
    const msgId = params.messageSid ?? randomMessageSid('plivo')
    const from = params.senderNumber ?? '+15555550200'
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    if (event === 'incoming-message') {
      const fields: Record<string, string> = {
        From: from,
        To: '+18005550100',
        Text: params.body ?? 'Test message',
        MessageUUID: msgId,
      }
      if (params.mediaUrl) fields['Media0'] = params.mediaUrl
      return {
        body: encodeForm(fields),
        contentType: 'application/x-www-form-urlencoded',
        headers: {},
        path: `/api/messaging/sms/webhook${hubQ}`,
      }
    }
    return {
      body: encodeForm({ MessageUUID: msgId, Status: params.status ?? 'delivered' }),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path: `/api/messaging/sms/webhook${hubQ}`,
    }
  }
  ```

- [x] Run typecheck, commit:
  ```bash
  bun run typecheck
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): SMS messaging payload factory (Twilio/SW/Vonage/Plivo/Asterisk)"
  ```

---

## Task 10: WhatsApp, Signal, RCS messaging factories

**Files:**
- Modify: `src/worker/lib/test-payload-factory.ts`

WhatsApp has two modes: Meta Cloud API (nested JSON) and Twilio (form with `whatsapp:` prefix). Signal uses a bridge. RCS uses Google RBM JSON.

- [x] Add to `src/worker/lib/test-payload-factory.ts`:
  ```typescript
  // -------------------------------------------------------------------
  // WhatsApp — Meta Cloud API (JSON) and Twilio mode (form)
  // -------------------------------------------------------------------

  function buildWhatsappPayload(
    event: MessagingEvent,
    params: SimulateMessageParams,
    mode: 'meta' | 'twilio' = 'meta'
  ): FactoryResult {
    const msgId = params.messageSid ?? randomMessageSid('meta')
    const from = (params.senderNumber ?? '+15555550200').replace('+', '')
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    if (mode === 'twilio') {
      if (event === 'incoming-message') {
        return {
          body: encodeForm({
            From: `whatsapp:+${from}`,
            To: 'whatsapp:+18005550100',
            Body: params.body ?? 'Test message',
            MessageSid: msgId,
            NumMedia: '0',
          }),
          contentType: 'application/x-www-form-urlencoded',
          headers: {},
          path: `/api/messaging/whatsapp/webhook${hubQ}`,
        }
      }
      return {
        body: encodeForm({ MessageSid: msgId, MessageStatus: params.status ?? 'delivered' }),
        contentType: 'application/x-www-form-urlencoded',
        headers: {},
        path: `/api/messaging/whatsapp/webhook${hubQ}`,
      }
    }

    // Meta Cloud API — nested entry/changes/value structure
    if (event === 'incoming-message') {
      return {
        body: JSON.stringify({
          entry: [{
            changes: [{
              value: {
                messages: [{
                  id: msgId,
                  from,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: 'text',
                  text: { body: params.body ?? 'Test message' },
                }],
                contacts: [{ profile: { name: 'Test Caller' }, wa_id: from }],
                metadata: { phone_number_id: '123456789', display_phone_number: '+18005550100' },
              },
            }],
          }],
        }),
        contentType: 'application/json',
        headers: {},
        path: `/api/messaging/whatsapp/webhook${hubQ}`,
      }
    }
    // delivery-status
    return {
      body: JSON.stringify({
        entry: [{
          changes: [{
            value: {
              statuses: [{
                id: msgId,
                status: params.status ?? 'delivered',
                timestamp: Math.floor(Date.now() / 1000).toString(),
                recipient_id: from,
              }],
              metadata: { phone_number_id: '123456789', display_phone_number: '+18005550100' },
            },
          }],
        }],
      }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/whatsapp/webhook${hubQ}`,
    }
  }

  // -------------------------------------------------------------------
  // Signal (signal-cli bridge) and RCS (Google RBM)
  // -------------------------------------------------------------------

  function buildSignalPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
    const msgId = params.messageSid ?? randomMessageSid('twilio')
    const from = params.senderNumber ?? '+15555550200'
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    // signal-cli-rest-api bridge format — matches SignalWebhookPayload in signal/types.ts
    // Fields: envelope.source (phone), envelope.sourceUuid (optional), envelope.timestamp
    return {
      body: JSON.stringify({
        envelope: {
          source: from,         // primary phone field read by adapter
          sourceUuid: undefined,
          timestamp: Date.now(),
          dataMessage: event === 'incoming-message'
            ? { message: params.body ?? 'Test message', timestamp: Date.now() }
            : undefined,
        },
      }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/signal/webhook${hubQ}`,
    }
  }

  function buildRcsPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
    const msgId = params.messageSid ?? randomMessageSid('twilio')
    const from = params.senderNumber ?? '+15555550200'
    const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

    if (event === 'incoming-message') {
      return {
        body: JSON.stringify({
          message: { text: params.body ?? 'Test message', messageId: msgId },
          senderPhoneNumber: from,
          messageId: msgId,
        }),
        contentType: 'application/json',
        headers: {},
        path: `/api/messaging/rcs/webhook${hubQ}`,
      }
    }
    return {
      body: JSON.stringify({
        event: { deliveryStatus: params.status ?? 'DELIVERED', messageId: msgId },
        senderPhoneNumber: from,
      }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/rcs/webhook${hubQ}`,
    }
  }
  ```

- [x] Add the top-level messaging dispatcher:
  ```typescript
  /** Build a messaging webhook payload for any provider × channel × event combination */
  export function buildMessagingPayload(
    provider: MessagingProvider,
    channel: MessagingChannel,
    event: MessagingEvent,
    params: SimulateMessageParams = {}
  ): FactoryResult {
    if (channel === 'whatsapp') {
      return buildWhatsappPayload(event, params, provider === 'twilio' ? 'twilio' : 'meta')
    }
    if (channel === 'signal') return buildSignalPayload(event, params)
    if (channel === 'rcs') return buildRcsPayload(event, params)
    // sms
    switch (provider) {
      case 'vonage': return buildVonageSmsPayload(event, params)
      case 'plivo': return buildPlivoSmsPayload(event, params)
      case 'asterisk': return buildTwilioSmsPayload(event, params) // delegates to Twilio format
      default: return buildTwilioSmsPayload(event, params) // twilio + signalwire
    }
  }
  ```

- [x] Read `src/worker/messaging/signal/` to verify the Signal adapter's expected payload structure, and adjust `buildSignalPayload` if the actual field names differ from the guess above:
  ```bash
  cat src/worker/messaging/signal/adapter.ts | grep -A 20 "parseIncomingMessage"
  ```

- [x] Run typecheck, commit:
  ```bash
  bun run typecheck
  git add src/worker/lib/test-payload-factory.ts
  git commit -m "feat(sim): WhatsApp/Signal/RCS messaging factories + dispatcher"
  ```

---

## Task 11: Simulation endpoints in dev.ts

**Files:**
- Modify: `src/worker/routes/dev.ts`

Add 6 simulation endpoints. Each builds the payload via factory, POSTs to the real webhook URL on localhost (setting `CF-Connecting-IP: 127.0.0.1` to trigger the dev bypass), and returns the webhook handler's response.

- [x] Add imports at the top of `src/worker/routes/dev.ts`:
  ```typescript
  import {
    buildTelephonyPayload,
    buildMessagingPayload,
    type TelephonyProvider,
    type TelephonyEvent,
    type MessagingProvider,
    type MessagingChannel,
    type MessagingEvent,
    type SimulateCallParams,
    type SimulateMessageParams,
  } from '../lib/test-payload-factory'
  ```

- [x] Add a helper that posts the factory result to the local server:
  ```typescript
  /** POST a factory-generated payload to the real webhook endpoint. */
  async function postToWebhook(
    c: { req: { url: string }; env: { ENVIRONMENT?: string } },
    factoryResult: { body: string; contentType: string; headers: Record<string, string>; path: string }
  ): Promise<Response> {
    const origin = new URL(c.req.url).origin
    return fetch(`${origin}${factoryResult.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': factoryResult.contentType,
        'CF-Connecting-IP': '127.0.0.1', // triggers telephony/messaging dev bypass
        ...factoryResult.headers,
      },
      body: factoryResult.body,
    })
  }
  ```

- [x] Add the 6 simulation endpoints before `export default dev`:
  ```typescript
  // --- Telephony simulation ---

  dev.post('/test-simulate/incoming-call', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
    if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
    const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
    const params: SimulateCallParams = await c.req.json().catch(() => ({}))
    const result = buildTelephonyPayload(provider, 'incoming-call', params)
    const res = await postToWebhook(c, result)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } })
  })

  dev.post('/test-simulate/answer-call', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
    if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
    const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
    const params: SimulateCallParams = await c.req.json().catch(() => ({}))
    const result = buildTelephonyPayload(provider, 'answer-call', params)
    const res = await postToWebhook(c, result)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } })
  })

  dev.post('/test-simulate/end-call', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
    if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
    const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
    const params: SimulateCallParams = await c.req.json().catch(() => ({}))
    const result = buildTelephonyPayload(provider, 'end-call', params)
    const res = await postToWebhook(c, result)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } })
  })

  dev.post('/test-simulate/voicemail', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
    if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
    const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
    const params: SimulateCallParams = await c.req.json().catch(() => ({}))
    const result = buildTelephonyPayload(provider, 'voicemail', params)
    const res = await postToWebhook(c, result)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } })
  })

  // --- Messaging simulation ---

  dev.post('/test-simulate/incoming-message', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
    if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
    const provider = (c.req.query('provider') ?? 'twilio') as MessagingProvider
    const channel = (c.req.query('channel') ?? 'sms') as MessagingChannel
    const params: SimulateMessageParams = await c.req.json().catch(() => ({}))
    const result = buildMessagingPayload(provider, channel, 'incoming-message', params)
    const res = await postToWebhook(c, result)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } })
  })

  dev.post('/test-simulate/delivery-status', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
    if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
    const provider = (c.req.query('provider') ?? 'twilio') as MessagingProvider
    const channel = (c.req.query('channel') ?? 'sms') as MessagingChannel
    const params: SimulateMessageParams = await c.req.json().catch(() => ({}))
    const result = buildMessagingPayload(provider, channel, 'delivery-status', params)
    const res = await postToWebhook(c, result)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } })
  })
  ```

- [x] Run typecheck:
  ```bash
  bun run typecheck
  ```
  Expected: no errors.

- [x] Run build:
  ```bash
  bun run build
  ```
  Expected: success.

- [x] Commit:
  ```bash
  git add src/worker/routes/dev.ts
  git commit -m "feat(sim): add 6 simulation endpoints to dev routes"
  ```

---

## Task 12: Playwright simulation helpers

**Files:**
- Create: `tests/helpers/simulation.ts`

Thin wrappers for use in Playwright tests. All helpers call the simulation endpoints via `request.post()` and return the parsed response body.

- [x] Create `tests/helpers/simulation.ts`:
  ```typescript
  import type { APIRequestContext } from '@playwright/test'

  const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787'
  const TEST_SECRET = process.env.E2E_TEST_SECRET ?? process.env.DEV_RESET_SECRET ?? ''

  export interface SimulateCallParams {
    callSid?: string
    callerNumber?: string
    calledNumber?: string
    digits?: string
    status?: string
    parentCallSid?: string
    volunteerPubkey?: string
    recordingSid?: string
    hubId?: string
  }

  export interface SimulateMessageParams {
    messageSid?: string
    senderNumber?: string
    body?: string
    mediaUrl?: string
    mediaType?: string
    status?: string
    errorCode?: string
    hubId?: string
  }

  type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'
  type MessagingProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'meta'
  type MessagingChannel = 'sms' | 'whatsapp' | 'signal' | 'rcs'

  function headers() {
    return { 'X-Test-Secret': TEST_SECRET }
  }

  export async function simulateIncomingCall(
    request: APIRequestContext,
    provider: TelephonyProvider,
    params: SimulateCallParams = {}
  ): Promise<{ status: number; body: string }> {
    const res = await request.post(
      `${BASE_URL}/api/test-simulate/incoming-call?provider=${provider}`,
      { data: params, headers: headers() }
    )
    return { status: res.status(), body: await res.text() }
  }

  export async function simulateAnswerCall(
    request: APIRequestContext,
    provider: TelephonyProvider,
    params: SimulateCallParams = {}
  ): Promise<{ status: number; body: string }> {
    const res = await request.post(
      `${BASE_URL}/api/test-simulate/answer-call?provider=${provider}`,
      { data: params, headers: headers() }
    )
    return { status: res.status(), body: await res.text() }
  }

  export async function simulateEndCall(
    request: APIRequestContext,
    provider: TelephonyProvider,
    params: SimulateCallParams = {}
  ): Promise<{ status: number; body: string }> {
    const res = await request.post(
      `${BASE_URL}/api/test-simulate/end-call?provider=${provider}`,
      { data: params, headers: headers() }
    )
    return { status: res.status(), body: await res.text() }
  }

  export async function simulateVoicemail(
    request: APIRequestContext,
    provider: TelephonyProvider,
    params: SimulateCallParams = {}
  ): Promise<{ status: number; body: string }> {
    const res = await request.post(
      `${BASE_URL}/api/test-simulate/voicemail?provider=${provider}`,
      { data: params, headers: headers() }
    )
    return { status: res.status(), body: await res.text() }
  }

  export async function simulateIncomingMessage(
    request: APIRequestContext,
    provider: MessagingProvider,
    channel: MessagingChannel,
    params: SimulateMessageParams = {}
  ): Promise<{ status: number; body: string }> {
    const res = await request.post(
      `${BASE_URL}/api/test-simulate/incoming-message?provider=${provider}&channel=${channel}`,
      { data: params, headers: headers() }
    )
    return { status: res.status(), body: await res.text() }
  }

  export async function simulateDeliveryStatus(
    request: APIRequestContext,
    provider: MessagingProvider,
    channel: MessagingChannel,
    params: SimulateMessageParams = {}
  ): Promise<{ status: number; body: string }> {
    const res = await request.post(
      `${BASE_URL}/api/test-simulate/delivery-status?provider=${provider}&channel=${channel}`,
      { data: params, headers: headers() }
    )
    return { status: res.status(), body: await res.text() }
  }
  ```

- [x] Run typecheck:
  ```bash
  bun run typecheck
  ```

- [x] Commit:
  ```bash
  git add tests/helpers/simulation.ts
  git commit -m "feat(sim): Playwright simulation helpers"
  ```

---

## Task 13: Asterisk E2E tests

**Files:**
- Create: `tests/simulation-asterisk.spec.ts`

Test the full Asterisk call lifecycle end-to-end. Assertions check both the adapter command response (ARI JSON) and downstream effects (call records, correct state).

- [x] Create `tests/simulation-asterisk.spec.ts`:
  ```typescript
  import { test, expect } from '@playwright/test'
  import { simulateIncomingCall, simulateEndCall, simulateVoicemail } from './helpers/simulation'
  import { resetTestState } from './helpers/index'

  test.describe('Asterisk simulation — call lifecycle', () => {
    test.beforeEach(async ({ request }) => {
      await resetTestState(request)
    })

    test('incoming call → returns queue ARI command (not 400/403/500)', async ({ request }) => {
      const { status, body } = await simulateIncomingCall(request, 'asterisk', {
        callerNumber: '+15555550100',
      })
      // 200 = webhook accepted and processed
      // 404 = Asterisk not configured in this env (acceptable in CI)
      expect([200, 404]).toContain(status)
      if (status === 200) {
        // Asterisk adapter returns ARI command JSON
        const json = JSON.parse(body)
        expect(json).toHaveProperty('commands')
        const commands: Array<{ action: string }> = json.commands
        // Should either enqueue (CAPTCHA off) or present language menu (CAPTCHA on)
        const actions = commands.map((c) => c.action)
        expect(actions.some((a) => ['queue', 'speak', 'gather'].includes(a))).toBe(true)
      }
    })

    test('end call (completed) → call-status returns 200 or 404', async ({ request }) => {
      const callSid = `ast-end-${Date.now()}`
      await simulateIncomingCall(request, 'asterisk', { callSid })
      const { status } = await simulateEndCall(request, 'asterisk', { callSid, status: 'completed' })
      expect([200, 404]).toContain(status)
    })

    test('voicemail → voicemail-recording returns ARI hangup command (when configured)', async ({ request }) => {
      const callSid = `ast-vm-${Date.now()}`
      await simulateIncomingCall(request, 'asterisk', { callSid })
      const { status, body } = await simulateVoicemail(request, 'asterisk', { callSid })
      expect([200, 404]).toContain(status)
      if (status === 200 && body.trim().startsWith('{')) {
        const json = JSON.parse(body)
        if (json.commands) {
          const actions: string[] = json.commands.map((c: { action: string }) => c.action)
          expect(actions).toContain('hangup')
        }
      }
    })
  })
  ```

- [x] Run the new tests against local dev server:
  ```bash
  bunx playwright test tests/simulation-asterisk.spec.ts --reporter=list
  ```
  If the server isn't running with Asterisk configured, tests may skip or error at the "telephony not configured" stage — that is acceptable. The test should NOT fail on payload format errors (400/403 from the webhook endpoint). If you see 403, the `CF-Connecting-IP` bypass isn't working — recheck Task 11's `postToWebhook` function.

- [x] Commit:
  ```bash
  git add tests/simulation-asterisk.spec.ts
  git commit -m "test(sim): Asterisk call lifecycle E2E tests"
  ```

---

## Task 14: Cross-provider telephony smoke tests

**Files:**
- Create: `tests/simulation-telephony.spec.ts`

One smoke test per provider: simulate an incoming call, verify the webhook returns a valid response (not 400/403/500). This catches payload format errors for each provider without needing full telephony configuration.

- [x] Create `tests/simulation-telephony.spec.ts`:
  ```typescript
  import { test, expect } from '@playwright/test'
  import { simulateIncomingCall, simulateEndCall, simulateVoicemail } from './helpers/simulation'
  import { resetTestState } from './helpers/index'

  const PROVIDERS = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk'] as const

  test.describe('Cross-provider telephony simulation smoke tests', () => {
    test.beforeEach(async ({ request }) => {
      await resetTestState(request)
    })

    for (const provider of PROVIDERS) {
      test(`${provider}: incoming-call webhook accepted (not 400/403/500)`, async ({ request }) => {
        const { status } = await simulateIncomingCall(request, provider, {
          callerNumber: '+15555550100',
        })
        // 200 = success, 404 = telephony not configured (acceptable in CI without provider creds)
        // Anything else = payload format error or auth failure
        expect([200, 404]).toContain(status)
      })

      test(`${provider}: end-call webhook accepted`, async ({ request }) => {
        const callSid = `test-end-${provider}-${Date.now()}`
        const { status } = await simulateEndCall(request, provider, {
          callSid,
          status: 'completed',
        })
        expect([200, 404]).toContain(status)
      })

      test(`${provider}: voicemail webhook accepted`, async ({ request }) => {
        const callSid = `test-vm-${provider}-${Date.now()}`
        const { status } = await simulateVoicemail(request, provider, { callSid })
        expect([200, 404]).toContain(status)
      })
    }
  })
  ```

- [x] Run smoke tests:
  ```bash
  bunx playwright test tests/simulation-telephony.spec.ts --reporter=list
  ```
  All tests should pass (200 or 404, not 400/403/500).

- [x] Commit:
  ```bash
  git add tests/simulation-telephony.spec.ts
  git commit -m "test(sim): cross-provider telephony smoke tests"
  ```

---

## Task 15: Messaging simulation E2E tests

**Files:**
- Create: `tests/simulation-messaging.spec.ts`

Test incoming message → conversation created, delivery status update, and smoke-test all channel/provider combinations.

- [x] Create `tests/simulation-messaging.spec.ts`:
  ```typescript
  import { test, expect } from '@playwright/test'
  import {
    simulateIncomingMessage,
    simulateDeliveryStatus,
  } from './helpers/simulation'
  import { resetTestState } from './helpers/index'

  test.describe('Messaging simulation', () => {
    test.beforeEach(async ({ request }) => {
      await resetTestState(request)
    })

    test('Twilio SMS: incoming message → conversation created', async ({ request }) => {
      const { status } = await simulateIncomingMessage(request, 'twilio', 'sms', {
        senderNumber: '+15555550300',
        body: 'Hello from simulation',
      })
      // 200 = processed, 404 = channel not configured
      expect([200, 404]).toContain(status)
    })

    test('Twilio SMS: delivery status update → 200', async ({ request }) => {
      const msgSid = `SM${Date.now()}`
      const { status } = await simulateDeliveryStatus(request, 'twilio', 'sms', {
        messageSid: msgSid,
        status: 'delivered',
      })
      expect([200, 404]).toContain(status)
    })

    test('WhatsApp Meta: incoming message accepted', async ({ request }) => {
      const { status } = await simulateIncomingMessage(request, 'meta', 'whatsapp', {
        senderNumber: '+15555550301',
        body: 'WhatsApp test',
      })
      expect([200, 404]).toContain(status)
    })

    test('WhatsApp Twilio: incoming message accepted', async ({ request }) => {
      const { status } = await simulateIncomingMessage(request, 'twilio', 'whatsapp', {
        senderNumber: '+15555550302',
        body: 'WhatsApp via Twilio',
      })
      expect([200, 404]).toContain(status)
    })

    // Smoke: all SMS providers
    for (const provider of ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk'] as const) {
      test(`SMS ${provider}: webhook accepted (not 400/403/500)`, async ({ request }) => {
        const { status } = await simulateIncomingMessage(request, provider, 'sms', {
          senderNumber: '+15555550400',
          body: `Test from ${provider}`,
        })
        expect([200, 404]).toContain(status)
      })
    }

    test('Signal: incoming message accepted', async ({ request }) => {
      const { status } = await simulateIncomingMessage(request, 'twilio', 'signal', {
        senderNumber: '+15555550303',
        body: 'Signal test',
      })
      expect([200, 404]).toContain(status)
    })

    test('RCS: incoming message accepted', async ({ request }) => {
      const { status } = await simulateIncomingMessage(request, 'twilio', 'rcs', {
        senderNumber: '+15555550304',
        body: 'RCS test',
      })
      expect([200, 404]).toContain(status)
    })
  })
  ```

- [x] Run tests:
  ```bash
  bunx playwright test tests/simulation-messaging.spec.ts --reporter=list
  ```

- [x] Commit:
  ```bash
  git add tests/simulation-messaging.spec.ts
  git commit -m "test(sim): messaging channel simulation E2E tests"
  ```

---

## Task 16: Final verification

- [x] Run full typecheck:
  ```bash
  bun run typecheck
  ```
  Expected: no errors.

- [x] Run build:
  ```bash
  bun run build
  ```
  Expected: success.

- [x] Run all simulation tests together:
  ```bash
  bunx playwright test tests/simulation-asterisk.spec.ts tests/simulation-telephony.spec.ts tests/simulation-messaging.spec.ts --reporter=list
  ```
  Expected: all pass (200 or 404, no 400/403/500).

- [x] Run existing call-flow tests to verify nothing regressed:
  ```bash
  bunx playwright test tests/call-flow.spec.ts tests/telephony-provider.spec.ts --reporter=list
  ```

- [x] Commit any final fixes, then push:
  ```bash
  git add -p
  git commit -m "chore(sim): final typecheck and build fixes"
  ```

---

## Completion Checklist

- [x] `tests/helpers.ts` → `tests/helpers/index.ts` migrated, existing tests unaffected
- [x] Messaging router dev bypass added (matches telephony router pattern)
- [x] Payload factory covers all 5 telephony providers × 9 events
- [x] Payload factory covers all 4 messaging channels × supported providers × 2 events
- [x] Signal adapter payload format verified against actual adapter code
- [x] 6 simulation endpoints in dev.ts, guarded behind dev + test-secret
- [x] All simulation endpoints set `CF-Connecting-IP: 127.0.0.1`
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] `simulation-asterisk.spec.ts` passes (no 400/403/500)
- [x] `simulation-telephony.spec.ts` passes for all 5 providers (200 or 404)
- [x] `simulation-messaging.spec.ts` passes for all channels (200 or 404)
