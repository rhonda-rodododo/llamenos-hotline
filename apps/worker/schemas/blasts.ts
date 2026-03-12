import { z } from 'zod'
import { paginationSchema } from './common'

// --- Response schemas ---

export const blastResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.object({
    body: z.string(),
    mediaUrl: z.string().optional(),
  }),
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled']),
  targetChannels: z.array(z.string()),
  targetTags: z.array(z.string()).optional(),
  targetLanguages: z.array(z.string()).optional(),
  createdBy: z.string().optional(),
  scheduledAt: z.string().nullable().optional(),
  sentAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: z.object({
    totalRecipients: z.number(),
    sent: z.number(),
    delivered: z.number(),
    failed: z.number(),
    optedOut: z.number(),
  }).optional(),
})

export const subscriberResponseSchema = z.object({
  id: z.string(),
  identifierHash: z.string(),
  channels: z.array(z.object({
    type: z.string(),
    verified: z.boolean(),
  })),
  tags: z.array(z.string()),
  language: z.string(),
  subscribedAt: z.string(),
  status: z.enum(['active', 'paused', 'unsubscribed']),
  doubleOptInConfirmed: z.boolean().optional(),
})

export const subscriberStatsResponseSchema = z.object({
  total: z.number(),
  byChannel: z.record(z.string(), z.number()),
  byStatus: z.record(z.string(), z.number()),
})

export const blastSettingsResponseSchema = z.object({
  subscribeKeyword: z.string().optional(),
  unsubscribeKeyword: z.string().optional(),
  confirmationMessage: z.string().optional(),
  unsubscribeMessage: z.string().optional(),
  doubleOptIn: z.boolean().optional(),
  maxBlastsPerDay: z.number().optional(),
})

// --- Input schemas ---

export const listBlastsQuerySchema = paginationSchema.extend({
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled']).optional(),
})

export const listSubscribersQuerySchema = paginationSchema.extend({
  channel: z.enum(['sms', 'whatsapp', 'signal']).optional(),
  status: z.enum(['active', 'unsubscribed', 'pending']).optional(),
})

export const createBlastBodySchema = z.looseObject({
  name: z.string().min(1).max(200),
  content: z.object({
    body: z.string().min(1).max(1600),
    mediaUrl: z.url().optional(),
  }),
  channels: z.array(z.enum(['sms', 'whatsapp', 'signal'])).min(1),
  scheduledAt: z.iso.datetime().optional(),
})

export const updateBlastBodySchema = z.looseObject({
  name: z.string().min(1).max(200).optional(),
  content: z.object({
    body: z.string().min(1).max(1600),
    mediaUrl: z.url().optional(),
  }).optional(),
  channels: z.array(z.enum(['sms', 'whatsapp', 'signal'])).min(1).optional(),
  scheduledAt: z.iso.datetime().optional().nullable(),
})

export const scheduleBlastBodySchema = z.looseObject({
  scheduledAt: z.iso.datetime(),
})
