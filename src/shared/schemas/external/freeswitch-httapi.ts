/**
 * Zod schemas for FreeSWITCH mod_httapi webhook payloads.
 *
 * FreeSWITCH's mod_httapi module POSTs channel variables as form-encoded or
 * JSON data to an HTTP endpoint. The app returns XML documents that control
 * call flow (<document type="xml/freeswitch-httapi">).
 *
 * These schemas validate the inbound webhook data before it reaches the
 * FreeSwitchAdapter's parse*Webhook() methods.
 *
 * Reference: https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Modules/mod_httapi_3966423/
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Section 1: FreeSWITCH Channel States
// ---------------------------------------------------------------------------

/**
 * FreeSWITCH channel state enum. These map to the internal channel state
 * machine in FreeSWITCH core.
 */
export const FreeSwitchChannelStateSchema = z.enum([
  'CS_NEW',
  'CS_INIT',
  'CS_ROUTING',
  'CS_SOFT_EXECUTE',
  'CS_EXECUTE',
  'CS_EXCHANGE_MEDIA',
  'CS_PARK',
  'CS_CONSUME_MEDIA',
  'CS_HIBERNATE',
  'CS_RESET',
  'CS_HANGUP',
  'CS_REPORTING',
  'CS_DESTROY',
])
export type FreeSwitchChannelState = z.infer<typeof FreeSwitchChannelStateSchema>

// ---------------------------------------------------------------------------
// Section 2: mod_httapi POST payload
// ---------------------------------------------------------------------------

/**
 * Raw POST data from FreeSWITCH mod_httapi.
 *
 * mod_httapi sends channel variables as a flat key-value map. Variable names
 * use FreeSWITCH's header-style naming (e.g., "Channel-Call-UUID") and
 * custom variables are prefixed with "variable_".
 *
 * Using looseObject because FreeSWITCH sends many more variables than we need.
 */
export const FreeSwitchHttapiPostSchema = z.looseObject({
  /** The call's UUID — primary identifier for a call leg */
  'Channel-Call-UUID': z.string().optional(),
  /** Unique ID for this specific channel (may differ from call UUID for bridged legs) */
  'Unique-ID': z.string().optional(),
  /** Caller's phone number (ANI / caller ID) */
  'Caller-Caller-ID-Number': z.string().optional(),
  /** Automatic Number Identification — usually same as caller ID */
  'Caller-ANI': z.string().optional(),
  /** The number the caller dialed */
  'Caller-Destination-Number': z.string().optional(),
  /** Current channel state (CS_NEW through CS_DESTROY) */
  'Channel-State': FreeSwitchChannelStateSchema.optional(),
  /** Call direction: inbound or outbound */
  'Call-Direction': z.enum(['inbound', 'outbound']).optional(),
  /** DTMF digits collected by a bind_digit_action or play_and_get_digits */
  variable_digits: z.string().optional(),
  /** Data passed back from an exiting application (e.g., digits from bind) */
  exiting_data: z.string().optional(),
  /** Custom variable: hub ID for multi-hub routing */
  variable_hub_id: z.string().optional(),
  /** Custom variable: detected caller language */
  variable_caller_lang: z.string().optional(),
  /** Custom variable: current IVR call phase (language_select, captcha, queue, voicemail) */
  variable_call_phase: z.string().optional(),
  /** Hangup cause (e.g., NORMAL_CLEARING, ORIGINATOR_CANCEL, CALL_REJECTED) */
  'Hangup-Cause': z.string().optional(),
  /** SIP termination status code (e.g., "200", "486") */
  variable_sip_term_status: z.string().optional(),
  /** Path to the recorded file on the FreeSWITCH server */
  variable_record_file_path: z.string().optional(),
  /** Duration of the recording in seconds */
  variable_record_seconds: z.coerce.number().optional(),
  /** Seconds the caller spent in the queue */
  variable_queue_time: z.coerce.number().optional(),
})
export type FreeSwitchHttapiPost = z.infer<typeof FreeSwitchHttapiPostSchema>

// ---------------------------------------------------------------------------
// Section 3: Parsed call info (normalized from raw POST)
// ---------------------------------------------------------------------------

/**
 * Normalized call information extracted from FreeSWITCH mod_httapi POST data.
 * Used by the adapter after parsing the raw webhook payload.
 */
export const FreeSwitchCallInfoSchema = z.object({
  /** Channel UUID — used as callSid throughout the adapter */
  channelId: z.string(),
  /** Caller's phone number */
  callerNumber: z.string(),
  /** The dialed number */
  calledNumber: z.string(),
  /** DTMF digits collected (from variable_digits or exiting_data) */
  digits: z.string(),
  /** Current channel state */
  channelState: FreeSwitchChannelStateSchema.optional(),
  /** Hangup cause string */
  hangupCause: z.string().optional(),
  /** Hub ID for multi-hub routing */
  hubId: z.string().optional(),
  /** Detected caller language */
  callerLang: z.string().optional(),
  /** Current IVR call phase */
  callPhase: z.string().optional(),
  /** Queue wait time in seconds */
  queueTime: z.number().optional(),
  /** Path to recording file on the FreeSWITCH server */
  recordingPath: z.string().optional(),
  /** Recording duration in seconds */
  recordingDuration: z.number().optional(),
})
export type FreeSwitchCallInfo = z.infer<typeof FreeSwitchCallInfoSchema>
