import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Vonage SMS Webhook Schemas
//
// Vonage (formerly Nexmo) can send webhooks as JSON or form-encoded depending
// on your account's "HTTP Method" setting. Fields use snake_case / kebab-case.
// Note: several field names contain hyphens (e.g. "message-timestamp") which
// are valid JSON keys but require bracket notation in JS/TS.
//
// Reference: https://developer.vonage.com/en/api/sms
// ---------------------------------------------------------------------------

/**
 * Sent by Vonage when an inbound SMS arrives on your virtual number.
 * Triggered by: POST to the "Inbound SMS" webhook URL configured in your
 * Vonage API dashboard (Dashboard → Your numbers → Manage → Messages).
 *
 * Concatenated (multi-part) messages include concat-ref / concat-part / concat-total.
 */
export const VonageInboundSMSSchema = z.looseObject({
  /** Your Vonage API key */
  'api-key': z.string().optional(),
  /** Sender phone number (MSISDN) in international format without leading + */
  msisdn: z.string(),
  /** Your Vonage virtual number that received the message */
  to: z.string(),
  /** Vonage message ID */
  messageId: z.string(),
  /** The text body of the message */
  text: z.string(),
  /** Message encoding type */
  type: z.enum(['text', 'unicode', 'binary']),
  /** First word of the message body, upper-cased (useful for keyword routing) */
  keyword: z.string().optional(),
  /** ISO 8601 / RFC 2822 timestamp of when Vonage received the message */
  'message-timestamp': z.string().optional(),
  /** Unix epoch timestamp as a string */
  timestamp: z.string().optional(),
  /** Random hex string for replay-attack prevention */
  nonce: z.string().optional(),

  // --- Concatenation (multi-part SMS) ---
  /** "true" if this is part of a concatenated message */
  concat: z.string().optional(),
  /** Concatenation reference number (same for all parts of one logical message) */
  'concat-ref': z.string().optional(),
  /** Total number of parts in this concatenated message */
  'concat-total': z.string().optional(),
  /** Which part this message represents (1-indexed) */
  'concat-part': z.string().optional(),

  // --- Binary message fields ---
  /** Hex-encoded binary message data (type === "binary") */
  data: z.string().optional(),
  /** Hex-encoded User Data Header (type === "binary") */
  udh: z.string().optional(),
})

export type VonageInboundSMS = z.infer<typeof VonageInboundSMSSchema>

// ---------------------------------------------------------------------------
// Delivery receipt (DLR)
// Triggered by: POST to the "Delivery Receipts" webhook URL configured in
// your Vonage account settings whenever a sent message changes status.
// ---------------------------------------------------------------------------

export const VonageDeliveryStatusSchema = z.enum([
  'delivered',
  'expired',
  'failed',
  'rejected',
  'accepted',
  'buffered',
  'unknown',
])

export type VonageDeliveryStatus = z.infer<typeof VonageDeliveryStatusSchema>

/**
 * Sent by Vonage when a delivery receipt (DLR) arrives from the carrier.
 * Triggered by: POST to the "Delivery Receipts" webhook URL in your account.
 */
export const VonageDeliveryReceiptSchema = z.looseObject({
  /** Recipient phone number (MSISDN) */
  msisdn: z.string(),
  /** SenderID / your Vonage number that sent the message */
  to: z.string(),
  /** Mobile Country Code + Mobile Network Code of the recipient's carrier */
  'network-code': z.string().optional(),
  /** Vonage message ID */
  messageId: z.string(),
  /** Cost of the message in EUR (or account currency) */
  price: z.string().optional(),
  /** Delivery status */
  status: VonageDeliveryStatusSchema,
  /**
   * Timestamp from the carrier's SMSC in YYMMDDHHMM format.
   * "Submission/Completion Time Stamp" per GSM 03.40.
   */
  scts: z.string().optional(),
  /**
   * Carrier error code. "0" means success; non-zero values indicate failure.
   * Reference: https://developer.vonage.com/en/messaging/sms/guides/delivery-receipts
   */
  'err-code': z.string().optional(),
  /** Your Vonage API key */
  'api-key': z.string().optional(),
  /** ISO 8601 timestamp of when Vonage started pushing this DLR */
  'message-timestamp': z.string().optional(),
})

export type VonageDeliveryReceipt = z.infer<typeof VonageDeliveryReceiptSchema>
