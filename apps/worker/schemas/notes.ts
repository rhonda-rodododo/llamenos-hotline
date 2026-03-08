import { z } from 'zod'
import { paginationSchema, recipientEnvelopeSchema, keyEnvelopeSchema } from './common'

export const listNotesQuerySchema = paginationSchema.extend({
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  contactHash: z.string().optional(),
})

export const createNoteBodySchema = z.object({
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  contactHash: z.string().optional(),
  encryptedContent: z.string().min(1, 'encryptedContent is required'),
  authorEnvelope: keyEnvelopeSchema.optional(),
  adminEnvelopes: z.array(recipientEnvelopeSchema).optional(),
}).passthrough().refine(
  data => data.callId || data.conversationId,
  { message: 'callId or conversationId is required' }
)

export const updateNoteBodySchema = z.object({
  encryptedContent: z.string().min(1).optional(),
  authorEnvelope: keyEnvelopeSchema.optional(),
  adminEnvelopes: z.array(recipientEnvelopeSchema).optional(),
}).passthrough()

export const createReplyBodySchema = z.object({
  encryptedContent: z.string().min(1, 'encryptedContent is required'),
  readerEnvelopes: z.array(recipientEnvelopeSchema).min(1, 'At least one reader envelope required'),
}).passthrough()
