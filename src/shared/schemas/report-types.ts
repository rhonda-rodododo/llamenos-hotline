import { z } from 'zod/v4'

// ── Create Report Type ──
export const CreateReportTypeSchema = z.object({
  name: z.string().optional(),
  encryptedName: z.string().optional(),
  description: z.string().optional(),
  encryptedDescription: z.string().optional(),
  isDefault: z.boolean().optional(),
})
export type CreateReportTypeInput = z.infer<typeof CreateReportTypeSchema>

// ── Update Report Type ──
export const UpdateReportTypeSchema = z.object({
  name: z.string().optional(),
  encryptedName: z.string().optional(),
  description: z.string().optional(),
  encryptedDescription: z.string().optional(),
})
export type UpdateReportTypeInput = z.infer<typeof UpdateReportTypeSchema>

// ── Full Report Type entity ──
export const ReportTypeSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  encryptedName: z.string().optional(),
  encryptedDescription: z.string().optional(),
  isDefault: z.boolean(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ReportType = z.infer<typeof ReportTypeSchema>
