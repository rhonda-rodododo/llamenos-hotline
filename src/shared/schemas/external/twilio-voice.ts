/**
 * Zod schemas for Twilio Voice webhook payloads.
 *
 * Twilio sends form-encoded (application/x-www-form-urlencoded) POST requests
 * to your webhook URLs. All values arrive as strings; numeric fields are
 * transformed to numbers where appropriate.
 *
 * Reference: https://www.twilio.com/docs/voice/twiml
 *            https://www.twilio.com/docs/voice/api/recording
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Shared / reusable sub-schemas
// ---------------------------------------------------------------------------

/**
 * All possible CallStatus values across Twilio voice webhooks.
 * - queued:      Call is queued (not yet initiated)
 * - initiated:   Twilio has started the call but the phone is not yet ringing
 * - ringing:     Destination is ringing
 * - in-progress: Call was answered and is in progress
 * - completed:   Call ended normally
 * - busy:        Destination returned a busy signal
 * - no-answer:   Destination did not answer within the ringing timeout
 * - canceled:    Call was canceled before it was answered (REST API cancel)
 * - failed:      Call could not be completed as dialed (carrier error)
 */
export const TwilioCallStatusSchema = z.enum([
  'queued',
  'initiated',
  'ringing',
  'in-progress',
  'completed',
  'busy',
  'no-answer',
  'canceled',
  'failed',
])
export type TwilioCallStatus = z.infer<typeof TwilioCallStatusSchema>

/**
 * Direction of the call leg.
 * - inbound:      Caller dialed the Twilio number
 * - outbound-api: Call was initiated via the REST API
 * - outbound-dial: Call was initiated via TwiML <Dial>
 */
export const TwilioCallDirectionSchema = z.enum(['inbound', 'outbound-api', 'outbound-dial'])
export type TwilioCallDirection = z.infer<typeof TwilioCallDirectionSchema>

// ---------------------------------------------------------------------------
// Section 1: Incoming call webhook
// Triggered when Twilio receives an inbound call on a number and hits the
// Voice webhook URL configured on the IncomingPhoneNumber resource.
// ---------------------------------------------------------------------------

export const TwilioIncomingCallSchema = z.looseObject({
  /** Unique call identifier (CA...) */
  CallSid: z.string(),
  /** Twilio account SID (AC...) */
  AccountSid: z.string(),
  /** Caller's phone number or client identifier */
  From: z.string(),
  /** Dialed number or client identifier */
  To: z.string(),
  /** Call status at the time this webhook fires (typically 'ringing') */
  CallStatus: TwilioCallStatusSchema,
  /** Twilio API version in use (e.g. '2010-04-01') */
  ApiVersion: z.string(),
  /** Always 'inbound' for incoming call webhooks */
  Direction: TwilioCallDirectionSchema,
  /** Forwarding number if the call was forwarded by the carrier */
  ForwardedFrom: z.string().optional(),
  /** Caller's name from CNAM lookup (requires VoiceCallerIdLookup on the number) */
  CallerName: z.string().optional(),
  /** Geographic info about the caller's city */
  FromCity: z.string().optional(),
  /** Geographic info about the caller's state/region */
  FromState: z.string().optional(),
  /** Geographic info about the caller's ZIP code */
  FromZip: z.string().optional(),
  /** Caller's country code (ISO 3166-1 alpha-2) */
  FromCountry: z.string().optional(),
  /** Geographic info about the called number's city */
  ToCity: z.string().optional(),
  /** Geographic info about the called number's state/region */
  ToState: z.string().optional(),
  /** Geographic info about the called number's ZIP code */
  ToZip: z.string().optional(),
  /** Called number's country code (ISO 3166-1 alpha-2) */
  ToCountry: z.string().optional(),
  /** SIP response code when the call is from a SIP endpoint */
  SipResponseCode: z.string().optional(),
})
export type TwilioIncomingCall = z.infer<typeof TwilioIncomingCallSchema>

// ---------------------------------------------------------------------------
// Section 2: DTMF / Gather result webhook
// Triggered when a <Gather> verb completes (caller pressed digits or timed out).
// ---------------------------------------------------------------------------

export const TwilioGatherResultSchema = z.looseObject({
  /** Unique call identifier */
  CallSid: z.string(),
  /** Twilio account SID */
  AccountSid: z.string(),
  /** Caller's phone number or client identifier */
  From: z.string(),
  /** Dialed number or client identifier */
  To: z.string().optional(),
  /** Current call status */
  CallStatus: TwilioCallStatusSchema.optional(),
  /** API version */
  ApiVersion: z.string().optional(),
  /**
   * Digits the caller pressed. Empty string if the Gather timed out
   * without input.
   */
  Digits: z.string().optional(),
  /**
   * The key that ended the Gather (e.g. '#'). Present when finishOnKey
   * is set and the caller pressed that key to submit.
   */
  FinishedOnKey: z.string().optional(),
  /** Speech recognition result (when input="speech" or input="dtmf speech") */
  SpeechResult: z.string().optional(),
  /** Confidence score for speech recognition (0.0–1.0 as a string) */
  Confidence: z.string().optional(),
})
export type TwilioGatherResult = z.infer<typeof TwilioGatherResultSchema>

// ---------------------------------------------------------------------------
// Section 3: Call status callback
// Triggered asynchronously by Twilio at each StatusCallbackEvent (initiated,
// ringing, answered, completed) or at the StatusCallback URL on hangup.
// Also fired for outbound legs created via the REST API.
// ---------------------------------------------------------------------------

export const TwilioCallStatusCallbackSchema = z.looseObject({
  /** Unique call identifier */
  CallSid: z.string(),
  /** Twilio account SID */
  AccountSid: z.string(),
  /** Originating phone number or client */
  From: z.string(),
  /** Destination phone number or client */
  To: z.string(),
  /** Current status of the call */
  CallStatus: TwilioCallStatusSchema,
  /** API version */
  ApiVersion: z.string(),
  /** Direction of this call leg */
  Direction: TwilioCallDirectionSchema,
  /** Duration of the call in seconds (only present on 'completed') */
  CallDuration: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** ISO-8601 / RFC 2822 timestamp of the event */
  Timestamp: z.string().optional(),
  /** The SID of the call leg that created this leg via <Dial> */
  ParentCallSid: z.string().optional(),
  /** Forwarded-from number if applicable */
  ForwardedFrom: z.string().optional(),
  /** SIP response code (SIP calls only) */
  SipResponseCode: z.string().optional(),
  /** Machine detection result: 'human', 'machine_start', 'fax', 'unknown' */
  AnsweredBy: z.string().optional(),
})
export type TwilioCallStatusCallback = z.infer<typeof TwilioCallStatusCallbackSchema>

// ---------------------------------------------------------------------------
// Section 4: Recording status callback
// Triggered when a recording's status changes (RecordingStatusCallbackEvent).
// Sent to the RecordingStatusCallback URL, separate from the call status URL.
// ---------------------------------------------------------------------------

export const TwilioRecordingStatusSchema = z.enum(['in-progress', 'completed', 'absent', 'failed'])
export type TwilioRecordingStatus = z.infer<typeof TwilioRecordingStatusSchema>

export const TwilioRecordingStatusCallbackSchema = z.looseObject({
  /** Twilio account SID */
  AccountSid: z.string(),
  /** The call SID the recording belongs to */
  CallSid: z.string(),
  /** Unique recording SID (RE...) */
  RecordingSid: z.string(),
  /** HTTPS URL to fetch the recorded audio */
  RecordingUrl: z.string(),
  /** Current status of the recording */
  RecordingStatus: TwilioRecordingStatusSchema,
  /**
   * Length of the recording in seconds.
   * Only present when RecordingStatus is 'completed'.
   */
  RecordingDuration: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Number of audio channels: '1' (mono) or '2' (dual) */
  RecordingChannels: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** RFC 2822 timestamp of when recording started */
  RecordingStartTime: z.string().optional(),
  /** Source of the recording (e.g. 'StartCallRecordingAPI', 'RecordVerb') */
  RecordingSource: z.string().optional(),
  /** Which audio track was recorded: 'inbound', 'outbound', 'both' */
  RecordingTrack: z.string().optional(),
  /** Error code if recording failed */
  ErrorCode: z.string().optional(),
})
export type TwilioRecordingStatusCallback = z.infer<typeof TwilioRecordingStatusCallbackSchema>

// ---------------------------------------------------------------------------
// Section 5: Queue wait webhook (waitUrl)
// Triggered on each polling interval while a call is waiting in an <Enqueue>
// queue. The response TwiML controls the hold experience.
// ---------------------------------------------------------------------------

export const TwilioQueueWaitSchema = z.looseObject({
  /** The call SID of the enqueued caller */
  CallSid: z.string(),
  /** Queue SID (QE...) */
  QueueSid: z.string(),
  /** Number of seconds this caller has been waiting in the queue */
  QueueTime: z.string().transform((v) => Number.parseInt(v, 10)),
  /** Average wait time (seconds) across all currently-enqueued callers */
  AvgQueueTime: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Current number of callers enqueued */
  CurrentQueueSize: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Maximum allowed queue depth */
  MaxQueueSize: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Caller's 1-based position in the queue */
  QueuePosition: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Caller's phone number */
  From: z.string().optional(),
  /** Called number */
  To: z.string().optional(),
  /** API version */
  ApiVersion: z.string().optional(),
  /** Twilio account SID */
  AccountSid: z.string().optional(),
})
export type TwilioQueueWait = z.infer<typeof TwilioQueueWaitSchema>

// ---------------------------------------------------------------------------
// Section 6: Queue exit webhook (action URL)
// Triggered when a call leaves the queue — either because it was bridged to
// an agent, timed out, was full, the caller hung up, or an error occurred.
// ---------------------------------------------------------------------------

/**
 * Why the call left the queue.
 * - bridged:       A dequeuing party accepted the call
 * - redirected:    Redirected out of the queue via REST API
 * - queue-full:    Queue has reached its MaxQueueSize
 * - system-error:  Twilio internal error
 * - hangup:        Caller hung up while waiting
 * - leave:         <Leave> verb was executed in the waitUrl TwiML
 * - callback:      Caller requested a callback (TaskRouter)
 */
export const TwilioQueueResultSchema = z.enum([
  'bridged',
  'redirected',
  'queue-full',
  'system-error',
  'hangup',
  'leave',
  'callback',
  'error',
])
export type TwilioQueueResult = z.infer<typeof TwilioQueueResultSchema>

export const TwilioQueueExitSchema = z.looseObject({
  /** The enqueued caller's SID */
  CallSid: z.string(),
  /** Queue SID */
  QueueSid: z.string().optional(),
  /** Reason the call left the queue */
  QueueResult: TwilioQueueResultSchema,
  /** Total seconds the caller spent in the queue */
  QueueTime: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Twilio account SID */
  AccountSid: z.string().optional(),
  /** API version */
  ApiVersion: z.string().optional(),
  /** Caller's phone number */
  From: z.string().optional(),
  /** Called number */
  To: z.string().optional(),
})
export type TwilioQueueExit = z.infer<typeof TwilioQueueExitSchema>
