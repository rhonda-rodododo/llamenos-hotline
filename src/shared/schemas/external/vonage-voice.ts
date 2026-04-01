/**
 * Zod schemas for Vonage (formerly Nexmo) Voice API webhook payloads.
 *
 * Vonage sends JSON (application/json) POST requests to the answer_url and
 * event_url configured on your Vonage Application. All timestamps are ISO-8601
 * strings unless noted otherwise.
 *
 * Reference: https://developer.vonage.com/en/voice/voice-api/webhook-reference
 *            https://developer.vonage.com/en/voice/voice-api/concepts/dtmf
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Shared / reusable sub-schemas
// ---------------------------------------------------------------------------

/**
 * Vonage call status values, as sent in event webhooks.
 * - started:     Call has been created
 * - ringing:     Destination phone is ringing
 * - answered:    Call was answered
 * - machine:     Call was answered by a machine (AMD result)
 * - completed:   Call ended normally
 * - timeout:     Call timed out before being answered
 * - failed:      Call failed (carrier / network error)
 * - rejected:    Call was rejected by the destination
 * - cancelled:   Caller cancelled before the call was answered
 * - busy:        Destination returned a busy signal
 * - unanswered:  Call rang but was not picked up (no explicit timeout)
 */
export const VonageCallStatusSchema = z.enum([
  'started',
  'ringing',
  'answered',
  'machine',
  'completed',
  'timeout',
  'failed',
  'rejected',
  'cancelled',
  'busy',
  'unanswered',
])
export type VonageCallStatus = z.infer<typeof VonageCallStatusSchema>

/**
 * Endpoint type descriptor used in 'from' and 'to' objects.
 * - phone:   PSTN telephone number
 * - app:     Vonage Client SDK (in-app calling)
 * - websocket: WebSocket endpoint
 * - sip:     SIP URI
 */
export const VonageEndpointTypeSchema = z.enum(['phone', 'app', 'websocket', 'sip'])
export type VonageEndpointType = z.infer<typeof VonageEndpointTypeSchema>

/**
 * Endpoint object — describes one side of a call.
 * The 'number' field holds the E.164 number (phone), app user ID (app),
 * WebSocket URI (websocket), or SIP URI (sip).
 */
export const VonageEndpointSchema = z.looseObject({
  type: VonageEndpointTypeSchema,
  number: z.string().optional(),
  user: z.string().optional(),
  uri: z.string().optional(),
})
export type VonageEndpoint = z.infer<typeof VonageEndpointSchema>

/**
 * DTMF input sub-object, present on input event webhooks.
 */
export const VonageDtmfSchema = z.looseObject({
  /** The digit(s) the caller pressed (empty string if timed out) */
  digits: z.string(),
  /** True if the gather timed out without any input */
  timed_out: z.boolean(),
})
export type VonageDtmf = z.infer<typeof VonageDtmfSchema>

// ---------------------------------------------------------------------------
// Section 1: Incoming call webhook (answer_url)
// Triggered when Vonage receives an inbound call on a number linked to a
// Vonage Application. The server must respond with an NCCO array.
// ---------------------------------------------------------------------------

export const VonageIncomingCallSchema = z.looseObject({
  /** Unique leg/call UUID (used for all subsequent API calls about this leg) */
  uuid: z.string(),
  /** Unique conversation UUID (ties together all legs of a call) */
  conversation_uuid: z.string(),
  /** Calling party endpoint info */
  from: z.union([z.string(), VonageEndpointSchema]),
  /** Called party endpoint info */
  to: z.union([z.string(), VonageEndpointSchema]),
  /** Call status at webhook fire time (typically 'ringing') */
  status: VonageCallStatusSchema.optional(),
  /** Call direction: 'inbound' or 'outbound' */
  direction: z.enum(['inbound', 'outbound']).optional(),
  /** ISO-8601 timestamp of the event */
  timestamp: z.string().optional(),
})
export type VonageIncomingCall = z.infer<typeof VonageIncomingCallSchema>

// ---------------------------------------------------------------------------
// Section 2: DTMF input event (event_url, type="input")
// Triggered when a caller submits DTMF input after an NCCO 'input' action.
// ---------------------------------------------------------------------------

export const VonageDtmfInputSchema = z.looseObject({
  /** Call leg UUID */
  uuid: z.string(),
  /** Conversation UUID */
  conversation_uuid: z.string(),
  /** DTMF input details */
  dtmf: VonageDtmfSchema,
  /** Speech recognition result (when speech input is enabled) */
  speech: z
    .looseObject({
      results: z
        .array(
          z.looseObject({
            confidence: z.string().optional(),
            text: z.string().optional(),
          })
        )
        .optional(),
      timeout_reason: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  /** Caller endpoint info */
  from: z.union([z.string(), VonageEndpointSchema]).optional(),
  /** Called endpoint info */
  to: z.union([z.string(), VonageEndpointSchema]).optional(),
  /** ISO-8601 timestamp */
  timestamp: z.string().optional(),
})
export type VonageDtmfInput = z.infer<typeof VonageDtmfInputSchema>

// ---------------------------------------------------------------------------
// Section 3: Call status event (event_url)
// Triggered at each stage of the call lifecycle. The payload contains the
// current status and call metadata at that moment.
// ---------------------------------------------------------------------------

export const VonageCallStatusEventSchema = z.looseObject({
  /** Call leg UUID */
  uuid: z.string(),
  /** Conversation UUID */
  conversation_uuid: z.string(),
  /** Current status of the call */
  status: VonageCallStatusSchema,
  /** Call direction */
  direction: z.enum(['inbound', 'outbound']).optional(),
  /** Total call duration in seconds (only present on 'completed') */
  duration: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Network / carrier of the caller (MSISDN analysis) */
  network: z.string().optional(),
  /** Rate per minute charged (string, e.g. '0.01200000') */
  rate: z.string().optional(),
  /** Total price charged for the call */
  price: z.string().optional(),
  /** ISO-8601 start time */
  start_time: z.string().optional(),
  /** ISO-8601 end time (only present on 'completed') */
  end_time: z.string().optional(),
  /** ISO-8601 timestamp of the event */
  timestamp: z.string().optional(),
  /** Caller endpoint */
  from: z.union([z.string(), VonageEndpointSchema]).optional(),
  /** Called endpoint */
  to: z.union([z.string(), VonageEndpointSchema]).optional(),
})
export type VonageCallStatusEvent = z.infer<typeof VonageCallStatusEventSchema>

// ---------------------------------------------------------------------------
// Section 4: Recording event (event_url, status="recording")
// Triggered when a recording created by the 'record' NCCO action is available.
// ---------------------------------------------------------------------------

export const VonageRecordingEventSchema = z.looseObject({
  /** Conversation UUID this recording belongs to */
  conversation_uuid: z.string(),
  /** The leg UUID that triggered the recording (if available) */
  uuid: z.string().optional(),
  /** HTTPS URL to download the recording audio (MP3 or WAV) */
  recording_url: z.string(),
  /** UUID of the recording resource itself */
  recording_uuid: z.string().optional(),
  /** ISO-8601 time the recording started */
  start_time: z.string(),
  /** ISO-8601 time the recording ended */
  end_time: z.string(),
  /** Size of the recording file in bytes */
  size: z.number().optional(),
  /** ISO-8601 timestamp of the event */
  timestamp: z.string().optional(),
})
export type VonageRecordingEvent = z.infer<typeof VonageRecordingEventSchema>

// ---------------------------------------------------------------------------
// Section 5: Transfer event (event_url, status="transfer")
// Triggered when a call leg is transferred to a different conversation.
// ---------------------------------------------------------------------------

export const VonageTransferEventSchema = z.looseObject({
  /** The UUID of the call leg being transferred */
  uuid: z.string(),
  /** Original conversation UUID */
  conversation_uuid_from: z.string(),
  /** New conversation UUID */
  conversation_uuid_to: z.string(),
  /** ISO-8601 timestamp */
  timestamp: z.string().optional(),
})
export type VonageTransferEvent = z.infer<typeof VonageTransferEventSchema>
