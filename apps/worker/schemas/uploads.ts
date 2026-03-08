import { z } from 'zod'
import { fileKeyEnvelopeSchema, encryptedMetadataEntrySchema } from './common'

export const uploadInitBodySchema = z.object({
  totalSize: z.number().int().min(1),
  totalChunks: z.number().int().min(1).max(10000),
  conversationId: z.string().min(1, 'conversationId is required'),
  recipientEnvelopes: z.array(fileKeyEnvelopeSchema).optional(),
  encryptedMetadata: z.array(encryptedMetadataEntrySchema).optional(),
}).passthrough()
