/**
 * Zod schemas for Bandwidth Voice API v2 webhook event payloads.
 *
 * Bandwidth uses BXML (Bandwidth XML) — similar to Twilio's TwiML.
 * The adapter returns BXML in response to webhook callbacks (JSON POST).
 *
 * Webhook events are JSON POST payloads sent to callback URLs configured
 * per-application or per-BXML verb.
 *
 * Reference: https://dev.bandwidth.com/apis/voice/
 *            https://dev.bandwidth.com/docs/voice/webhooks/
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Section 1: Initiate callback — New inbound call
// ---------------------------------------------------------------------------

export const BandwidthInitiateEventSchema = z.looseObject({
  eventType: z.literal('initiate'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  callUrl: z.string().optional(),
  startTime: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthInitiateEvent = z.infer<typeof BandwidthInitiateEventSchema>

// ---------------------------------------------------------------------------
// Section 2: Answer callback — Call answered
// ---------------------------------------------------------------------------

export const BandwidthAnswerEventSchema = z.looseObject({
  eventType: z.literal('answer'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  callUrl: z.string().optional(),
  startTime: z.string().optional(),
  answerTime: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthAnswerEvent = z.infer<typeof BandwidthAnswerEventSchema>

// ---------------------------------------------------------------------------
// Section 3: Disconnect callback — Call ended
// ---------------------------------------------------------------------------

export const BandwidthDisconnectEventSchema = z.looseObject({
  eventType: z.literal('disconnect'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  callUrl: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  cause: z.string().optional(),
  errorMessage: z.string().optional(),
  errorId: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthDisconnectEvent = z.infer<typeof BandwidthDisconnectEventSchema>

// ---------------------------------------------------------------------------
// Section 4: Gather callback — DTMF digits collected
// ---------------------------------------------------------------------------

export const BandwidthGatherEventSchema = z.looseObject({
  eventType: z.literal('gather'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string(),
  to: z.string(),
  digits: z.string(),
  terminatingDigit: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthGatherEvent = z.infer<typeof BandwidthGatherEventSchema>

// ---------------------------------------------------------------------------
// Section 5: Recording callbacks
// ---------------------------------------------------------------------------

export const BandwidthRecordingAvailableEventSchema = z.looseObject({
  eventType: z.literal('recordingAvailable'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  recordingId: z.string(),
  mediaUrl: z.string(),
  duration: z.string().optional(),
  fileFormat: z.string().optional(),
  channels: z.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  tag: z.string().optional(),
  status: z.string().optional(),
})
export type BandwidthRecordingAvailableEvent = z.infer<
  typeof BandwidthRecordingAvailableEventSchema
>

export const BandwidthRecordingCompleteEventSchema = z.looseObject({
  eventType: z.literal('recordComplete'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  recordingId: z.string(),
  mediaUrl: z.string().optional(),
  duration: z.string().optional(),
  fileFormat: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthRecordingCompleteEvent = z.infer<typeof BandwidthRecordingCompleteEventSchema>

// ---------------------------------------------------------------------------
// Section 6: Transfer/Bridge callbacks
// ---------------------------------------------------------------------------

export const BandwidthTransferCompleteEventSchema = z.looseObject({
  eventType: z.literal('transferComplete'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  cause: z.string().optional(),
  errorMessage: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthTransferCompleteEvent = z.infer<typeof BandwidthTransferCompleteEventSchema>

export const BandwidthTransferDisconnectEventSchema = z.looseObject({
  eventType: z.literal('transferDisconnect'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  cause: z.string().optional(),
  tag: z.string().optional(),
})
export type BandwidthTransferDisconnectEvent = z.infer<
  typeof BandwidthTransferDisconnectEventSchema
>

// ---------------------------------------------------------------------------
// Section 7: Redirect callback
// ---------------------------------------------------------------------------

export const BandwidthRedirectEventSchema = z.looseObject({
  eventType: z.literal('redirect'),
  accountId: z.string(),
  applicationId: z.string(),
  callId: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  tag: z.string().optional(),
})
export type BandwidthRedirectEvent = z.infer<typeof BandwidthRedirectEventSchema>

// ---------------------------------------------------------------------------
// Generic webhook envelope — used for initial parsing before event dispatch
// ---------------------------------------------------------------------------

export const BandwidthWebhookEventSchema = z.looseObject({
  eventType: z.string(),
  accountId: z.string().optional(),
  applicationId: z.string().optional(),
  callId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.string().optional(),
  digits: z.string().optional(),
  cause: z.string().optional(),
  errorMessage: z.string().optional(),
  tag: z.string().optional(),
  recordingId: z.string().optional(),
  mediaUrl: z.string().optional(),
  duration: z.string().optional(),
  fileFormat: z.string().optional(),
  channels: z.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  answerTime: z.string().optional(),
  terminatingDigit: z.string().optional(),
  status: z.string().optional(),
})
export type BandwidthWebhookEvent = z.infer<typeof BandwidthWebhookEventSchema>

// ---------------------------------------------------------------------------
// Disconnect cause mapping
// ---------------------------------------------------------------------------

/**
 * Map Bandwidth disconnect cause to normalized call status.
 * Reference: https://dev.bandwidth.com/docs/voice/webhooks/disconnect/
 */
export function mapBandwidthDisconnectCause(
  cause: string
): 'completed' | 'busy' | 'no-answer' | 'failed' {
  const CAUSE_MAP: Record<string, 'completed' | 'busy' | 'no-answer' | 'failed'> = {
    hangup: 'completed',
    busy: 'busy',
    timeout: 'no-answer',
    cancel: 'failed',
    rejected: 'failed',
    'callback-error': 'failed',
    'invalid-bxml': 'failed',
    'application-error': 'failed',
    'account-limit': 'failed',
    'node-capacity-exceeded': 'failed',
    error: 'failed',
    unknown: 'failed',
  }
  return CAUSE_MAP[cause] ?? 'failed'
}
