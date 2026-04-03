import type { MessagingChannelType, RecipientEnvelope } from '../../shared/types'

export interface BlastStats {
  totalRecipients: number
  sent: number
  delivered: number
  failed: number
  optedOut: number
}

export interface SubscriberChannel {
  type: 'sms' | 'whatsapp' | 'signal' | 'rcs'
  verified: boolean
}

export interface Blast {
  id: string
  hubId: string
  name: string
  encryptedName?: string
  targetChannels: string[]
  targetTags: string[]
  targetLanguages: string[]
  encryptedContent: string
  contentEnvelopes: RecipientEnvelope[]
  status: string
  stats: BlastStats
  createdAt: Date
  sentAt?: Date | null
  scheduledAt: Date | null
  error: string | null
}

export interface CreateBlastData {
  hubId?: string
  name: string
  targetChannels?: string[]
  targetTags?: string[]
  targetLanguages?: string[]
  encryptedContent?: string
  contentEnvelopes?: RecipientEnvelope[]
  status?: string
  scheduledAt?: Date
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
}

export interface Subscriber {
  id: string
  hubId: string
  identifierHash: string
  encryptedIdentifier: string | null
  channels: SubscriberChannel[]
  tags: string[]
  language?: string | null
  status: string
  doubleOptInConfirmed: boolean
  subscribedAt: Date
  preferenceToken: string
  createdAt: Date
}

export interface CreateSubscriberData {
  hubId?: string
  identifierHash: string
  encryptedIdentifier?: string
  channels?: SubscriberChannel[]
  tags?: string[]
  language?: string
  status?: string
  preferenceToken?: string
}

export interface BlastDelivery {
  id: string
  blastId: string
  subscriberId: string
  channelType: string
  status: string
  error?: string | null
  sentAt?: Date | null
  deliveredAt?: Date | null
}

export interface CreateDeliveryData {
  blastId: string
  subscriberId: string
  channelType?: string
  status?: string
  error?: string
}

export interface BlastQueueItem {
  subscriberId: string
  channel: MessagingChannelType
  identifier: string // actual phone/contact (server-only, not stored)
  status: 'pending' | 'sent' | 'failed'
  error?: string
  sentAt?: string
}

export interface BlastDeliveryQueue {
  blastId: string
  items: BlastQueueItem[]
  processedCount: number
  totalCount: number
}
