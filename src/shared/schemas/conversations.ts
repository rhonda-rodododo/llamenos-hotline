import { z } from 'zod'
import { RecipientEnvelopeSchema } from './records'

export const ConversationSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  channelType: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'web']),
  contactIdentifierHash: z.string(),
  contactLast4: z.string().optional(),
  externalId: z.string().optional(),
  assignedTo: z.string().optional(),
  status: z.enum(['active', 'waiting', 'closed']),
  metadata: z.record(z.string(), z.unknown()),
  messageCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastMessageAt: z.string().datetime(),
})
export type Conversation = z.infer<typeof ConversationSchema>

export const CreateConversationSchema = z.object({
  hubId: z.string().optional(),
  channelType: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'web']),
  contactIdentifierHash: z.string(),
  contactLast4: z.string().optional(),
  externalId: z.string().optional(),
  assignedTo: z.string().optional(),
})
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>

export const EncryptedMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  authorPubkey: z.string(),
  encryptedContent: z.string(),
  readerEnvelopes: z.array(RecipientEnvelopeSchema),
  hasAttachments: z.boolean(),
  attachmentIds: z.array(z.string()),
  externalId: z.string().optional(),
  status: z.string(),
  deliveredAt: z.string().datetime().optional(),
  readAt: z.string().datetime().optional(),
  failureReason: z.string().optional(),
  retryCount: z.number().int(),
  createdAt: z.string().datetime(),
})
export type EncryptedMessage = z.infer<typeof EncryptedMessageSchema>
