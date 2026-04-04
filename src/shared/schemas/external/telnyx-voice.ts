/**
 * Zod schemas for Telnyx Call Control API webhook event payloads.
 *
 * Telnyx Call Control uses an event-driven REST model: the server receives
 * webhook events as JSON POST requests and issues commands via REST API calls.
 * Unlike Twilio (TwiML) or Vonage (NCCO), no instruction document is returned.
 *
 * All webhook events share a common envelope: `{ data: { record_type, event_type, id, occurred_at, payload } }`.
 * The `client_state` field (base64 JSON) persists application context across webhook events.
 *
 * Reference: https://developers.telnyx.com/docs/v2/call-control/receiving-webhooks
 *            https://developers.telnyx.com/docs/v2/call-control/api-reference
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Client state — base64-encoded JSON for stateless context passing
// ---------------------------------------------------------------------------

export const TelnyxClientStateSchema = z.object({
  hubId: z.string().optional(),
  lang: z.string(),
  callSid: z.string(),
  phase: z.enum(['language', 'captcha', 'queue']).optional(),
})
export type TelnyxClientState = z.infer<typeof TelnyxClientStateSchema>

/** Encode client state as base64 JSON string for Telnyx API calls */
export function encodeTelnyxClientState(state: TelnyxClientState): string {
  return btoa(JSON.stringify(state))
}

/** Decode base64 client_state from Telnyx webhook payload */
export function decodeTelnyxClientState(raw: string): TelnyxClientState {
  try {
    const json = JSON.parse(atob(raw))
    return TelnyxClientStateSchema.parse(json)
  } catch {
    // Return safe defaults if decode fails
    return { lang: 'en', callSid: '' }
  }
}

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

/**
 * Telnyx Call Control event types handled by the adapter.
 */
export const TelnyxEventTypeSchema = z.enum([
  'call.initiated',
  'call.answered',
  'call.hangup',
  'call.gather.ended',
  'call.recording.saved',
  'call.speak.ended',
  'call.playback.ended',
  'call.bridged',
])
export type TelnyxEventType = z.infer<typeof TelnyxEventTypeSchema>

/**
 * Hangup cause codes from Telnyx.
 * Maps to SIP response codes and network-level causes.
 */
export const TelnyxHangupCauseSchema = z.enum([
  'normal_clearing',
  'originator_cancel',
  'timeout',
  'busy',
  'call_rejected',
  'unallocated_number',
  'normal_unspecified',
  'user_busy',
  'no_user_response',
  'no_answer',
  'subscriber_absent',
  'network_out_of_order',
  'recovery_on_timer_expire',
  'interworking',
])
export type TelnyxHangupCause = z.infer<typeof TelnyxHangupCauseSchema>

/**
 * Gather status values from call.gather.ended events.
 */
export const TelnyxGatherStatusSchema = z.enum(['valid', 'call_hangup', 'timeout', 'invalid'])
export type TelnyxGatherStatus = z.infer<typeof TelnyxGatherStatusSchema>

// ---------------------------------------------------------------------------
// Section 1: call.initiated — Incoming or outgoing call started
// ---------------------------------------------------------------------------

export const TelnyxCallInitiatedPayloadSchema = z.looseObject({
  call_control_id: z.string(),
  connection_id: z.string(),
  call_leg_id: z.string(),
  call_session_id: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['incoming', 'outgoing']),
  state: z.string(),
  start_time: z.string().optional(),
  client_state: z.string().optional(),
})
export type TelnyxCallInitiatedPayload = z.infer<typeof TelnyxCallInitiatedPayloadSchema>

// ---------------------------------------------------------------------------
// Section 2: call.answered — Call was answered
// ---------------------------------------------------------------------------

export const TelnyxCallAnsweredPayloadSchema = z.looseObject({
  call_control_id: z.string(),
  connection_id: z.string(),
  call_leg_id: z.string(),
  call_session_id: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['incoming', 'outgoing']),
  state: z.string(),
  client_state: z.string().optional(),
})
export type TelnyxCallAnsweredPayload = z.infer<typeof TelnyxCallAnsweredPayloadSchema>

// ---------------------------------------------------------------------------
// Section 3: call.hangup — Call ended
// ---------------------------------------------------------------------------

export const TelnyxCallHangupPayloadSchema = z.looseObject({
  call_control_id: z.string(),
  connection_id: z.string().optional(),
  call_leg_id: z.string(),
  call_session_id: z.string(),
  from: z.string(),
  to: z.string(),
  hangup_cause: z.string(),
  hangup_source: z.string().optional(),
  sip_hangup_cause: z.string().optional(),
  client_state: z.string().optional(),
})
export type TelnyxCallHangupPayload = z.infer<typeof TelnyxCallHangupPayloadSchema>

// ---------------------------------------------------------------------------
// Section 4: call.gather.ended — DTMF digit collection completed
// ---------------------------------------------------------------------------

export const TelnyxGatherEndedPayloadSchema = z.looseObject({
  call_control_id: z.string(),
  connection_id: z.string().optional(),
  call_leg_id: z.string(),
  call_session_id: z.string(),
  from: z.string(),
  to: z.string(),
  digits: z.string(),
  status: TelnyxGatherStatusSchema,
  client_state: z.string().optional(),
})
export type TelnyxGatherEndedPayload = z.infer<typeof TelnyxGatherEndedPayloadSchema>

// ---------------------------------------------------------------------------
// Section 5: call.recording.saved — Recording is available for download
// ---------------------------------------------------------------------------

export const TelnyxRecordingSavedPayloadSchema = z.looseObject({
  call_control_id: z.string().optional(),
  call_leg_id: z.string(),
  call_session_id: z.string(),
  recording_started_at: z.string().optional(),
  recording_ended_at: z.string().optional(),
  channels: z.string().optional(),
  recording_urls: z.looseObject({
    mp3: z.string(),
    wav: z.string(),
  }),
  public_recording_urls: z
    .looseObject({
      mp3: z.string(),
      wav: z.string(),
    })
    .optional(),
  client_state: z.string().optional(),
})
export type TelnyxRecordingSavedPayload = z.infer<typeof TelnyxRecordingSavedPayloadSchema>

// ---------------------------------------------------------------------------
// Common webhook event envelope
// ---------------------------------------------------------------------------

export const TelnyxWebhookEventSchema = z.looseObject({
  data: z.looseObject({
    record_type: z.string(),
    event_type: z.string(),
    id: z.string(),
    occurred_at: z.string(),
    payload: z.looseObject({
      call_control_id: z.string().optional(),
      call_leg_id: z.string().optional(),
      call_session_id: z.string().optional(),
      connection_id: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      direction: z.string().optional(),
      state: z.string().optional(),
      start_time: z.string().optional(),
      client_state: z.string().optional(),
      digits: z.string().optional(),
      status: z.string().optional(),
      hangup_cause: z.string().optional(),
      hangup_source: z.string().optional(),
      sip_hangup_cause: z.string().optional(),
      recording_urls: z
        .looseObject({
          mp3: z.string(),
          wav: z.string(),
        })
        .optional(),
      public_recording_urls: z
        .looseObject({
          mp3: z.string(),
          wav: z.string(),
        })
        .optional(),
      recording_started_at: z.string().optional(),
      recording_ended_at: z.string().optional(),
      channels: z.string().optional(),
    }),
  }),
})
export type TelnyxWebhookEvent = z.infer<typeof TelnyxWebhookEventSchema>
