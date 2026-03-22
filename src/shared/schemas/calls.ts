import { z } from 'zod'

export const ActiveCallSchema = z.object({
  callSid: z.string(),
  hubId: z.string(),
  callerNumber: z.string(),
  status: z.enum(['ringing', 'in-progress', 'completed']),
  assignedPubkey: z.string().optional(),
  startedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()),
})
export type ActiveCall = z.infer<typeof ActiveCallSchema>

export const CallLegSchema = z.object({
  legSid: z.string(),
  callSid: z.string(),
  hubId: z.string(),
  volunteerPubkey: z.string(),
  phone: z.string().optional(),
  status: z.string(),
  createdAt: z.string().datetime(),
})
export type CallLeg = z.infer<typeof CallLegSchema>

export const CallTokenSchema = z.object({
  token: z.string(),
  callSid: z.string(),
  hubId: z.string(),
  pubkey: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
})
export type CallToken = z.infer<typeof CallTokenSchema>
