import { z } from 'zod'
import { pubkeySchema } from './common'

export const loginBodySchema = z.object({
  pubkey: pubkeySchema,
  timestamp: z.number(),
  token: z.string().min(1),
}).passthrough()

export const bootstrapBodySchema = z.object({
  pubkey: pubkeySchema,
  timestamp: z.number(),
  token: z.string().min(1),
}).passthrough()

export const profileUpdateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(20).optional(),
  spokenLanguages: z.array(z.string().max(5)).optional(),
  uiLanguage: z.string().max(5).optional(),
  profileCompleted: z.boolean().optional(),
  callPreference: z.enum(['phone', 'browser', 'both']).optional(),
}).passthrough()

export const availabilityBodySchema = z.object({
  onBreak: z.boolean(),
}).passthrough()

export const transcriptionToggleBodySchema = z.object({
  enabled: z.boolean(),
}).passthrough()
