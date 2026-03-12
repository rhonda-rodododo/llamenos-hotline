import { z } from 'zod'

// --- Response schemas ---

export const webauthnCredentialResponseSchema = z.object({
  id: z.string(),
  publicKey: z.string(),
  counter: z.number(),
  name: z.string().optional(),
  createdAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
})

export const webauthnChallengeResponseSchema = z.object({
  challenge: z.string(),
})
