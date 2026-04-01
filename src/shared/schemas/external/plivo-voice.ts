/**
 * Zod schemas for Plivo Voice webhook payloads.
 *
 * Plivo sends form-encoded (application/x-www-form-urlencoded) POST requests
 * to your configured webhook URLs (answer_url, hangup_url, fallback_url, etc.).
 * All values arrive as strings; numeric fields are transformed where appropriate.
 *
 * Reference: https://www.plivo.com/docs/voice/concepts/callbacks
 *            https://www.plivo.com/docs/voice/xml/getdigits
 *            https://www.plivo.com/docs/voice/api/call/
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Shared / reusable sub-schemas
// ---------------------------------------------------------------------------

/**
 * All possible CallStatus values across Plivo voice webhooks.
 * - queued:      Call is queued and waiting to be initiated
 * - ringing:     Destination is currently ringing
 * - in-progress: Call was answered and is active
 * - completed:   Call ended normally
 * - busy:        Destination was busy
 * - no-answer:   Call was not answered within the timeout period
 * - cancel:      Call was cancelled before being answered
 * - failed:      Call could not be completed (carrier / network error)
 */
export const PlivoCallStatusSchema = z.enum([
  'queued',
  'ringing',
  'in-progress',
  'completed',
  'busy',
  'no-answer',
  'cancel',
  'failed',
])
export type PlivoCallStatus = z.infer<typeof PlivoCallStatusSchema>

/**
 * Call direction as reported by Plivo.
 * - inbound:  Call arrived at your Plivo number
 * - outbound: Call was initiated via the REST API or XML <Dial>
 */
export const PlivoCallDirectionSchema = z.enum(['inbound', 'outbound'])
export type PlivoCallDirection = z.infer<typeof PlivoCallDirectionSchema>

// ---------------------------------------------------------------------------
// Section 1: Incoming call webhook (answer_url / fallback_url)
// Triggered when Plivo receives an inbound call. The server must respond
// with Plivo XML to control the call.
// ---------------------------------------------------------------------------

export const PlivoIncomingCallSchema = z.looseObject({
  /** Unique call identifier (UUID format) */
  CallUUID: z.string(),
  /** Plivo auth ID of the account */
  AuthID: z.string().optional(),
  /** Caller's phone number (E.164, no leading '+' in some cases) */
  From: z.string(),
  /** Dialed / destination phone number */
  To: z.string(),
  /** Current call status */
  CallStatus: PlivoCallStatusSchema,
  /** Direction of the call */
  Direction: PlivoCallDirectionSchema,
  /** Plivo API version in use */
  ApiVersion: z.string().optional(),
  /** The caller's country code (ISO 3166-1 alpha-2) */
  CallerCountry: z.string().optional(),
  /** The called number's country code */
  ToCountry: z.string().optional(),
  /** Network / carrier information for the caller */
  FromNetwork: z.string().optional(),
  /** SIP URI of the caller (SIP calls only) */
  SipUri: z.string().optional(),
  /** Custom SIP headers passed by the caller */
  SipHeaders: z.string().optional(),
  /** Whether call is from a SIP endpoint: '1' or '0' */
  From_sip: z.string().optional(),
})
export type PlivoIncomingCall = z.infer<typeof PlivoIncomingCallSchema>

// ---------------------------------------------------------------------------
// Section 2: DTMF / GetDigits result webhook (action URL in <GetDigits>)
// Triggered when a <GetDigits> verb completes. The caller's digit input is
// sent to the action URL configured on the element.
// ---------------------------------------------------------------------------

export const PlivoGetDigitsResultSchema = z.looseObject({
  /** Unique call identifier */
  CallUUID: z.string(),
  /** Caller's phone number */
  From: z.string(),
  /** Dialed number */
  To: z.string().optional(),
  /** Current call status */
  CallStatus: PlivoCallStatusSchema.optional(),
  /** Direction of the call */
  Direction: PlivoCallDirectionSchema.optional(),
  /**
   * Digits collected by <GetDigits>. Empty string if the timeout
   * elapsed with no input.
   */
  Digits: z.string(),
  /**
   * 'true' if the digit collection was terminated by the finishOnKey
   * key; 'false' otherwise.
   */
  isTimeout: z.string().optional(),
})
export type PlivoGetDigitsResult = z.infer<typeof PlivoGetDigitsResultSchema>

// ---------------------------------------------------------------------------
// Section 3: Call status / hangup callback (hangup_url / callback_url)
// Triggered asynchronously when the call ends or at each status change if
// hangup_url is configured. Contains billing and duration data.
// ---------------------------------------------------------------------------

export const PlivoCallStatusCallbackSchema = z.looseObject({
  /** Unique call identifier */
  CallUUID: z.string(),
  /** Plivo auth ID */
  AuthID: z.string().optional(),
  /** Caller's phone number */
  From: z.string(),
  /** Destination phone number */
  To: z.string(),
  /** Final call status */
  CallStatus: PlivoCallStatusSchema,
  /** Call direction */
  Direction: PlivoCallDirectionSchema.optional(),
  /**
   * Total call duration in seconds (wall-clock, includes ringing time).
   * Present on 'completed' events.
   */
  Duration: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /**
   * Billable duration in seconds (answered time only).
   * Present on 'completed' events.
   */
  BillDuration: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Cost per minute for this call (string, e.g. '0.01400') */
  BillRate: z.string().optional(),
  /** Total amount charged for the call */
  TotalAmount: z.string().optional(),
  /** ISO-8601 / RFC 2822 timestamp of the event */
  Timestamp: z.string().optional(),
  /** Plivo API version */
  ApiVersion: z.string().optional(),
  /** Caller's country */
  CallerCountry: z.string().optional(),
  /** Called country */
  ToCountry: z.string().optional(),
  /** Hangup cause (e.g. 'NORMAL_CLEARING', 'USER_BUSY') */
  HangupCause: z.string().optional(),
  /** Numeric SIP response code at hangup */
  HangupSource: z.string().optional(),
})
export type PlivoCallStatusCallback = z.infer<typeof PlivoCallStatusCallbackSchema>

// ---------------------------------------------------------------------------
// Section 4: Recording callback (action URL in <Record>)
// Triggered when Plivo finishes processing a recording from a <Record> verb.
// ---------------------------------------------------------------------------

export const PlivoRecordingCallbackSchema = z.looseObject({
  /** Unique call identifier */
  CallUUID: z.string(),
  /** Plivo auth ID */
  AuthID: z.string().optional(),
  /** Caller's phone number */
  From: z.string().optional(),
  /** Dialed number */
  To: z.string().optional(),
  /** HTTPS URL to download the recorded audio file */
  RecordUrl: z.string(),
  /** Unique identifier for the recording resource */
  RecordingID: z.string().optional(),
  /**
   * Duration of the recording in seconds.
   */
  RecordingDuration: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /**
   * Duration of the recording in milliseconds.
   */
  RecordingDurationMs: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** ISO-8601 start time of the recording */
  RecordingStartMs: z.string().optional(),
  /** ISO-8601 end time of the recording */
  RecordingEndMs: z.string().optional(),
  /** Current call status at the time the recording completed */
  CallStatus: PlivoCallStatusSchema.optional(),
  /** Plivo API version */
  ApiVersion: z.string().optional(),
})
export type PlivoRecordingCallback = z.infer<typeof PlivoRecordingCallbackSchema>

// ---------------------------------------------------------------------------
// Section 5: Conference wait / event callback
// Triggered for conference-related events (member join, leave, etc.).
// ---------------------------------------------------------------------------

export const PlivoConferenceEventSchema = z.looseObject({
  /** Unique call identifier of the member */
  CallUUID: z.string(),
  /** Conference name / room */
  ConferenceName: z.string().optional(),
  /** Plivo conference UUID */
  ConferenceUUID: z.string().optional(),
  /** Number of members currently in the conference */
  ConferenceMemberCount: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  /** Member ID within the conference */
  MemberID: z.string().optional(),
  /** Event type (e.g. 'ConferenceEnter', 'ConferenceExit') */
  EventName: z.string().optional(),
  /** Caller's phone number */
  From: z.string().optional(),
  /** Dialed number */
  To: z.string().optional(),
  /** Current call status */
  CallStatus: PlivoCallStatusSchema.optional(),
  /** API version */
  ApiVersion: z.string().optional(),
})
export type PlivoConferenceEvent = z.infer<typeof PlivoConferenceEventSchema>
