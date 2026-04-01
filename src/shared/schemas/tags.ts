import { z } from 'zod/v4'

// ── Create Tag ──
export const CreateTagSchema = z.object({
  name: z.string().min(1),
  encryptedLabel: z.string().min(1),
  color: z.string().optional(),
  encryptedCategory: z.string().optional(),
})
export type CreateTagInput = z.infer<typeof CreateTagSchema>

// ── Update Tag ──
export const UpdateTagSchema = z.object({
  encryptedLabel: z.string().optional(),
  color: z.string().optional(),
  encryptedCategory: z.string().nullable().optional(),
})
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>
