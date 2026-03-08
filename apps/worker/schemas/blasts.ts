import { z } from 'zod'
import { paginationSchema } from './common'

export const listBlastsQuerySchema = paginationSchema.extend({
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled']).optional(),
})

export const listSubscribersQuerySchema = paginationSchema.extend({
  channel: z.enum(['sms', 'whatsapp', 'signal']).optional(),
  status: z.enum(['active', 'unsubscribed', 'pending']).optional(),
})

export const createBlastBodySchema = z.object({
  name: z.string().min(1).max(200),
  content: z.object({
    body: z.string().min(1).max(1600),
    mediaUrl: z.string().url().optional(),
  }),
  channels: z.array(z.enum(['sms', 'whatsapp', 'signal'])).min(1),
  scheduledAt: z.string().datetime().optional(),
}).passthrough()

export const updateBlastBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  content: z.object({
    body: z.string().min(1).max(1600),
    mediaUrl: z.string().url().optional(),
  }).optional(),
  channels: z.array(z.enum(['sms', 'whatsapp', 'signal'])).min(1).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
}).passthrough()

export const scheduleBlastBodySchema = z.object({
  scheduledAt: z.string().datetime(),
}).passthrough()
