import { z } from 'zod'

/** Hex-encoded 32-byte Nostr public key (x-only, 64 hex chars) */
export const pubkeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex string')

/** UUID v4 */
export const uuidSchema = z.string().uuid()

/** E.164 phone number */
export const e164PhoneSchema = z.string().regex(/^\+\d{7,15}$/, 'Must be E.164 format (+XXXXXXXXXXX)')

/** Pagination parameters — bounded and defaulted */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Cursor-based pagination */
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** ISO 8601 date string */
export const isoDateSchema = z.string().datetime({ offset: true }).or(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
)

/** Standard error response envelope */
export const errorResponseSchema = z.object({
  error: z.string(),
  details: z.array(z.object({
    field: z.string(),
    message: z.string(),
    code: z.string().optional(),
  })).optional(),
  requestId: z.string().optional(),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>

/** ECIES recipient envelope — used across notes, messages, files */
export const recipientEnvelopeSchema = z.object({
  pubkey: pubkeySchema,
  wrappedKey: z.string().min(1),
  ephemeralPubkey: pubkeySchema,
}).passthrough()

/** Key envelope — used for note author copies (no pubkey) */
export const keyEnvelopeSchema = z.object({
  wrappedKey: z.string().min(1),
  ephemeralPubkey: pubkeySchema,
}).passthrough()

/** File key envelope — used for file uploads */
export const fileKeyEnvelopeSchema = z.object({
  pubkey: pubkeySchema,
  encryptedFileKey: z.string().min(1),
  ephemeralPubkey: pubkeySchema,
}).passthrough()

/** Encrypted metadata entry — used for file uploads */
export const encryptedMetadataEntrySchema = z.object({
  pubkey: z.string().min(1),
  encryptedContent: z.string().min(1),
  ephemeralPubkey: pubkeySchema,
}).passthrough()
