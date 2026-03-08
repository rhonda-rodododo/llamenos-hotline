import { z } from 'zod'
import { pubkeySchema, paginationSchema, recipientEnvelopeSchema } from './common'

export const listConversationsQuerySchema = paginationSchema.extend({
  status: z.enum(['waiting', 'active', 'closed']).optional(),
  assignedTo: pubkeySchema.optional(),
  channel: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'web']).optional(),
  type: z.enum(['report', 'conversation']).optional(),
  contactHash: z.string().optional(),
})

export const sendMessageBodySchema = z.object({
  encryptedContent: z.string().min(1, 'encryptedContent is required'),
  readerEnvelopes: z.array(recipientEnvelopeSchema).min(1, 'At least one reader envelope required'),
  plaintextForSending: z.string().optional(),
}).passthrough()

export const updateConversationBodySchema = z.object({
  status: z.enum(['waiting', 'active', 'closed']).optional(),
  assignedTo: pubkeySchema.optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export const claimConversationBodySchema = z.object({
  pubkey: pubkeySchema,
}).passthrough()

export const createConversationBodySchema = z.object({
  channelType: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'web']).default('web'),
  contactIdentifierHash: z.string().default(''),
  contactLast4: z.string().max(4).optional(),
  assignedTo: pubkeySchema.optional(),
  status: z.enum(['waiting', 'active', 'closed']).default('waiting'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough()
