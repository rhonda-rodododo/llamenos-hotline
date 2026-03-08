import { z } from 'zod'
import { pubkeySchema } from './common'

export const createShiftBodySchema = z.object({
  name: z.string().min(1).max(200),
  startTime: z.string(),
  endTime: z.string(),
  days: z.array(z.number().int().min(0).max(6)),
  volunteerPubkeys: z.array(pubkeySchema),
}).passthrough()

export const updateShiftBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
  volunteerPubkeys: z.array(pubkeySchema).optional(),
}).passthrough()

export const fallbackGroupSchema = z.object({
  volunteerPubkeys: z.array(pubkeySchema),
}).passthrough()
