import { z } from 'zod'
import { pubkeySchema } from './common'

export const createHubBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).optional(),
  phoneNumber: z.string().max(20).optional(),
}).passthrough()

export const updateHubBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).optional(),
  phoneNumber: z.string().max(20).optional(),
  status: z.enum(['active', 'archived']).optional(),
}).passthrough()

export const addHubMemberBodySchema = z.object({
  pubkey: pubkeySchema,
  roleIds: z.array(z.string()).min(1, 'At least one role required'),
}).passthrough()

export const hubKeyEnvelopesBodySchema = z.object({
  envelopes: z.array(z.object({
    pubkey: pubkeySchema,
    wrappedKey: z.string().min(1),
    ephemeralPubkey: pubkeySchema,
  })).min(1, 'At least one envelope required'),
}).passthrough()
