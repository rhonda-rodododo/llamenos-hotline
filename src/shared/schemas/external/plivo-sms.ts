import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Plivo SMS / MMS Webhook Schemas
//
// Plivo posts form-encoded data to your webhook URL for both inbound messages
// and delivery reports. Field names use PascalCase.
//
// Reference: https://www.plivo.com/docs/messaging/api/message/
// ---------------------------------------------------------------------------

/**
 * Sent by Plivo when an inbound SMS or MMS arrives on your Plivo number.
 * Triggered by: POST to the "message_url" configured on your Plivo number
 * (via the API or dashboard). For MMS, additional Media{N} fields are included.
 */
export const PlivoInboundSMSSchema = z.looseObject({
  /** Sender's phone number in E.164 format */
  From: z.string(),
  /** Your Plivo phone number that received the message */
  To: z.string(),
  /** The text body of the message */
  Text: z.string().optional(),
  /** Unique identifier for this message */
  MessageUUID: z.string(),
  /** Message channel type */
  Type: z.enum(['sms', 'mms', 'whatsapp']),
  /** Per-unit rate charged for this message */
  TotalRate: z.string().optional(),
  /** Number of billing segments (SMS: 1 per 160 chars; MMS: always 1) */
  Units: z.string().optional(),
  /** Number of media attachments (MMS only) */
  NumMedia: z.string().optional(),
  /** Your Plivo auth ID (present on some webhook versions) */
  AccountID: z.string().optional(),
})

export type PlivoInboundSMS = z.infer<typeof PlivoInboundSMSSchema>

/**
 * Extract indexed Media{N} and MediaContentType{N} values from a parsed
 * inbound MMS webhook body (Plivo sends Media0, Media1, ...).
 */
export function extractPlivoMedia(
  body: PlivoInboundSMS & Record<string, string | undefined>,
  numMedia: number
): Array<{ url: string; contentType: string }> {
  const media: Array<{ url: string; contentType: string }> = []
  for (let i = 0; i < numMedia; i++) {
    const url = body[`Media${i}`]
    const contentType = body[`MediaContentType${i}`]
    if (url) {
      media.push({ url, contentType: contentType ?? 'application/octet-stream' })
    }
  }
  return media
}

// ---------------------------------------------------------------------------
// Delivery report (status callback)
// Triggered by: POST to the "url" parameter specified when sending a message
// via the Plivo Messages API, on each status transition.
// ---------------------------------------------------------------------------

export const PlivoMessageStatusSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'rejected',
  'read',
])

export type PlivoMessageStatus = z.infer<typeof PlivoMessageStatusSchema>

/**
 * Sent by Plivo when the delivery status of an outbound message changes.
 * Triggered by: POST to the callback URL provided in the send-message API call.
 */
export const PlivoDeliveryReportSchema = z.looseObject({
  /** Unique identifier for this message */
  MessageUUID: z.string(),
  /** Current delivery status */
  Status: PlivoMessageStatusSchema,
  /** Destination phone number */
  To: z.string().optional(),
  /** Source phone number / sender ID */
  From: z.string().optional(),
  /**
   * Plivo error code. "000" means success.
   * Reference: https://www.plivo.com/docs/messaging/concepts/errors/
   */
  ErrorCode: z.string().optional(),
  /** Per-segment rate charged */
  TotalRate: z.string().optional(),
  /** Total cost for this message */
  TotalAmount: z.string().optional(),
  /** Number of billing segments */
  Units: z.string().optional(),
  /** Mobile Country Code */
  MCC: z.string().optional(),
  /** Mobile Network Code */
  MNC: z.string().optional(),
})

export type PlivoDeliveryReport = z.infer<typeof PlivoDeliveryReportSchema>
