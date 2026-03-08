import { z } from 'zod'
import { pubkeySchema } from './common'

export const createVolunteerBodySchema = z.object({
  pubkey: pubkeySchema,
  name: z.string().min(1).max(200),
  phone: z.string().max(20),
  roleIds: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  encryptedSecretKey: z.string().optional(),
}).passthrough()

export const updateVolunteerBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(20).optional(),
  spokenLanguages: z.array(z.string().max(5)).optional(),
  uiLanguage: z.string().max(5).optional(),
  profileCompleted: z.boolean().optional(),
  transcriptionEnabled: z.boolean().optional(),
  onBreak: z.boolean().optional(),
  callPreference: z.enum(['phone', 'browser', 'both']).optional(),
}).passthrough()

export const adminUpdateVolunteerBodySchema = updateVolunteerBodySchema.extend({
  roles: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  messagingEnabled: z.boolean().optional(),
  supportedMessagingChannels: z.array(z.enum(['sms', 'whatsapp', 'signal', 'rcs'])).optional(),
}).passthrough()
