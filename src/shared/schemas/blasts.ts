import { z } from 'zod/v4'

export const BlastSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  name: z.string(),
  channel: z.enum(['sms', 'whatsapp', 'signal']),
  content: z.string(),
  status: z.enum(['draft', 'sending', 'sent', 'failed']),
  totalCount: z.number().int(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().optional(),
})
export type Blast = z.infer<typeof BlastSchema>

export const CreateBlastSchema = z.object({
  hubId: z.string().optional(),
  name: z.string().min(1).max(200),
  channel: z.enum(['sms', 'whatsapp', 'signal']),
  content: z.string().min(1),
})
export type CreateBlastInput = z.infer<typeof CreateBlastSchema>

export const SubscriberSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  phoneNumber: z.string(),
  channel: z.string(),
  active: z.boolean(),
  token: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
})
export type Subscriber = z.infer<typeof SubscriberSchema>

export const CreateSubscriberSchema = z.object({
  hubId: z.string().optional(),
  phoneNumber: z.string(),
  channel: z.string(),
  token: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CreateSubscriberInput = z.infer<typeof CreateSubscriberSchema>

export const BlastDeliverySchema = z.object({
  id: z.uuid(),
  blastId: z.string(),
  subscriberId: z.string(),
  status: z.enum(['pending', 'sent', 'failed']),
  error: z.string().optional(),
  sentAt: z.iso.datetime().optional(),
})
export type BlastDelivery = z.infer<typeof BlastDeliverySchema>

export const BlastContentSchema = z.object({
  text: z.string(),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  smsText: z.string().optional(),
  whatsappTemplateId: z.string().optional(),
  rcsRichCard: z.boolean().optional(),
})
export type BlastContent = z.infer<typeof BlastContentSchema>

export const BlastStatsSchema = z.object({
  totalRecipients: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  optedOut: z.number().int(),
})
export type BlastStats = z.infer<typeof BlastStatsSchema>

export const BlastSettingsSchema = z.object({
  subscribeKeyword: z.string(),
  unsubscribeKeyword: z.string(),
  confirmationMessage: z.string(),
  unsubscribeMessage: z.string(),
  doubleOptIn: z.boolean(),
  optOutFooter: z.string(),
  maxBlastsPerDay: z.number().int(),
  rateLimitPerSecond: z.number().int(),
})
export type BlastSettings = z.infer<typeof BlastSettingsSchema>
