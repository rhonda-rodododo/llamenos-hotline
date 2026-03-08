import { z } from 'zod'
import { pubkeySchema } from './common'

export const redeemInviteBodySchema = z.object({
  code: z.string().uuid(),
  pubkey: pubkeySchema,
  timestamp: z.number(),
  token: z.string().min(1),
}).passthrough()

export const createInviteBodySchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(20),
  roleIds: z.array(z.string()).min(1),
}).passthrough()
