import type { MessageDeliveryStatus, RecipientEnvelope } from '../../shared/types'

export type ConversationStatus = 'active' | 'waiting' | 'closed'

export type { MessageDeliveryStatus } from '../../shared/types'

export interface Conversation {
  id: string
  hubId: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string | null
  externalId?: string | null
  assignedTo?: string | null
  status: string
  metadata: Record<string, unknown>
  /** FK to report_types — only set on web/report conversations */
  reportTypeId?: string | null
  messageCount: number
  createdAt: Date
  updatedAt: Date
  lastMessageAt: Date
  // E2EE envelope-encrypted contactLast4 (Phase 2D)
  encryptedContactLast4?: string
  contactLast4Envelopes?: RecipientEnvelope[]
}

/**
 * Encrypted message using the envelope pattern (Epic 74).
 *
 * Single ciphertext encrypted with a random per-message symmetric key.
 * The key is ECIES-wrapped separately for each authorized reader.
 * Domain separation label: 'llamenos:message'.
 */
export interface EncryptedMessage {
  id: string
  conversationId: string
  direction: string
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes: RecipientEnvelope[]
  hasAttachments: boolean
  attachmentIds?: string[]
  externalId?: string | null
  status: string
  deliveryStatus: MessageDeliveryStatus
  deliveryStatusUpdatedAt?: Date | null
  providerMessageId?: string | null
  deliveryError?: string | null
  deliveredAt?: Date | null
  readAt?: Date | null
  failureReason?: string | null
  retryCount: number
  createdAt: Date
}

/** @deprecated Use RecipientEnvelope from @shared/types instead. */
export type MessageKeyEnvelope = RecipientEnvelope

export interface ConversationFilters {
  hubId?: string
  status?: string
  assignedTo?: string
  channelType?: string
  page?: number
  limit?: number
}

export interface CreateConversationData {
  hubId?: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string
  externalId?: string
  assignedTo?: string
  status?: string
  metadata?: Record<string, unknown>
  /** Optional: bind this conversation to a report type (for web/report channelType) */
  reportTypeId?: string
  /** When true, always INSERT a new row instead of upserting on the unique constraint.
   *  Used by reports where the same contact can have multiple conversations. */
  skipDedup?: boolean
}

export interface CreateMessageData {
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes?: RecipientEnvelope[]
  hasAttachments?: boolean
  attachmentIds?: string[]
  externalId?: string
  status?: string
  deliveryStatus?: MessageDeliveryStatus
  providerMessageId?: string
  deliveryError?: string
}
