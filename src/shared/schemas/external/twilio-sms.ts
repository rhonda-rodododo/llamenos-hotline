import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Twilio SMS / MMS Webhook Schemas
//
// Twilio posts form-encoded data to your webhook URL.
// SignalWire uses the same payload format (Twilio-compatible).
//
// Reference: https://www.twilio.com/docs/messaging/guides/webhook-request
// ---------------------------------------------------------------------------

/**
 * Sent by Twilio when an inbound SMS or MMS arrives on your number.
 * Triggered by: POST to the "A Message Comes In" webhook URL on your
 * Twilio phone number / Messaging Service configuration.
 */
export const TwilioInboundSMSSchema = z.looseObject({
  /** Unique 34-character identifier for this message */
  MessageSid: z.string(),
  /** Deprecated alias for MessageSid — still sent for backwards compatibility */
  SmsSid: z.string().optional(),
  /** Deprecated alias for MessageSid */
  SmsMessageSid: z.string().optional(),
  /** Your Twilio Account SID */
  AccountSid: z.string(),
  /** Messaging Service SID (present when message is associated with a Messaging Service) */
  MessagingServiceSid: z.string().optional(),
  /** Sender phone number in E.164 format, or channel address */
  From: z.string(),
  /** Your Twilio number that received the message */
  To: z.string(),
  /** The text body of the message (up to 1600 characters) */
  Body: z.string(),
  /** Number of media attachments (0 for plain SMS) */
  NumMedia: z.string(),
  /** Number of message segments (SMS: 1+, MMS/non-SMS channels: always "1") */
  NumSegments: z.string(),
  /** Twilio API version used */
  ApiVersion: z.string().optional(),

  // --- Geographic enrichment (best-effort, may be empty strings) ---
  FromCity: z.string().optional(),
  FromState: z.string().optional(),
  FromZip: z.string().optional(),
  FromCountry: z.string().optional(),
  ToCity: z.string().optional(),
  ToState: z.string().optional(),
  ToZip: z.string().optional(),
  ToCountry: z.string().optional(),

  // --- WhatsApp-specific fields ---
  ProfileName: z.string().optional(),
  WaId: z.string().optional(),
  /** "true" if the message was forwarded */
  Forwarded: z.string().optional(),
  FrequentlyForwarded: z.string().optional(),

  // --- Location share (WhatsApp) ---
  Latitude: z.string().optional(),
  Longitude: z.string().optional(),
  Address: z.string().optional(),
  Label: z.string().optional(),

  // --- Interactive message responses (WhatsApp) ---
  ButtonPayload: z.string().optional(),
  ButtonText: z.string().optional(),
  ButtonType: z.string().optional(),
  InteractiveData: z.string().optional(),

  // --- Click-to-WhatsApp ad referral fields ---
  ReferralBody: z.string().optional(),
  ReferralHeadline: z.string().optional(),
  ReferralSourceId: z.string().optional(),
  ReferralSourceType: z.string().optional(),
  ReferralMediaContentType: z.string().optional(),
  ReferralCtwaClid: z.string().optional(),

  // --- Reply threading ---
  OriginalRepliedMessageSender: z.string().optional(),
  OriginalRepliedMessageSid: z.string().optional(),
})

export type TwilioInboundSMS = z.infer<typeof TwilioInboundSMSSchema>

// ---------------------------------------------------------------------------
// Dynamic media fields helper
// Twilio sends MediaUrl0, MediaUrl1, ... and MediaContentType0, MediaContentType1, ...
// These are indexed dynamically; use this helper to extract them from a parsed
// looseObject result.
// ---------------------------------------------------------------------------

/** Extract indexed MediaUrl{N} and MediaContentType{N} values from a parsed webhook body */
export function extractTwilioMedia(
  body: TwilioInboundSMS & Record<string, string | undefined>,
  numMedia: number
): Array<{ url: string; contentType: string }> {
  const media: Array<{ url: string; contentType: string }> = []
  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`]
    const contentType = body[`MediaContentType${i}`]
    if (url) {
      media.push({ url, contentType: contentType ?? 'application/octet-stream' })
    }
  }
  return media
}

// ---------------------------------------------------------------------------
// Status callback (delivery receipt)
// Triggered by: MessageStatus change events POSTed to StatusCallback URL.
// Twilio sends a subset of message fields plus MessageStatus + optional ErrorCode.
// ---------------------------------------------------------------------------

export const TwilioMessageStatusSchema = z.enum([
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'read',
  'receiving',
  'received',
  'canceled',
])

export type TwilioMessageStatus = z.infer<typeof TwilioMessageStatusSchema>

/**
 * Sent by Twilio on each status transition for an outbound message.
 * Triggered by: POST to the StatusCallback URL specified when sending the message,
 * or the default status callback configured on your Messaging Service.
 */
export const TwilioStatusCallbackSchema = z.looseObject({
  MessageSid: z.string(),
  SmsSid: z.string().optional(),
  AccountSid: z.string(),
  /** The current status of the message at the time this callback was fired */
  MessageStatus: TwilioMessageStatusSchema,
  /** Twilio error code — only present when MessageStatus is "failed" or "undelivered" */
  ErrorCode: z.string().optional(),
  /** Human-readable description of the error */
  ErrorMessage: z.string().optional(),
  /** Your Twilio number */
  To: z.string().optional(),
  /** Sender phone number or Messaging Service SID */
  From: z.string().optional(),
  ApiVersion: z.string().optional(),
})

export type TwilioStatusCallback = z.infer<typeof TwilioStatusCallbackSchema>
