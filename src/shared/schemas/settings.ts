import { z } from 'zod/v4'

export const HubSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'suspended', 'archived']),
  phoneNumber: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Hub = z.infer<typeof HubSchema>

export const CreateHubSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  phoneNumber: z.string().optional(),
})
export type CreateHubInput = z.infer<typeof CreateHubSchema>

export const UpdateHubSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  phoneNumber: z.string().optional(),
  status: z.enum(['active', 'suspended', 'archived']).optional(),
})
export type UpdateHubInput = z.infer<typeof UpdateHubSchema>

export const RoleSchema = z.object({
  id: z.uuid(),
  hubId: z.string().optional(),
  name: z.string(),
  slug: z.string(),
  permissions: z.array(z.string()),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type Role = z.infer<typeof RoleSchema>

export const CreateRoleSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  permissions: z.array(z.string()),
  isDefault: z.boolean().optional(),
  hubId: z.string().optional(),
})
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>

export const UpdateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
})
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>

export const CustomFieldDefinitionSchema = z.object({
  id: z.uuid(),
  hubId: z.string().optional(),
  fieldName: z.string(),
  label: z.string(),
  fieldType: z.enum(['text', 'number', 'select', 'checkbox', 'textarea', 'file']),
  options: z.array(z.string()).optional(),
  required: z.boolean(),
  showInVolunteerView: z.boolean(),
  order: z.number().int(),
  createdAt: z.iso.datetime(),
})
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>

export const SpamSettingsSchema = z.object({
  voiceCaptchaEnabled: z.boolean(),
  rateLimitEnabled: z.boolean(),
  maxCallsPerMinute: z.number().int().positive(),
  blockDurationMinutes: z.number().int().positive(),
})
export type SpamSettings = z.infer<typeof SpamSettingsSchema>

export const CallSettingsSchema = z.object({
  queueTimeoutSeconds: z.number().int().positive(),
  voicemailMaxSeconds: z.number().int().positive(),
})
export type CallSettings = z.infer<typeof CallSettingsSchema>

export const TranscriptionSettingsSchema = z.object({
  globalEnabled: z.boolean(),
  allowVolunteerOptOut: z.boolean(),
})
export type TranscriptionSettings = z.infer<typeof TranscriptionSettingsSchema>

export const IvrLanguagesSchema = z.array(z.string())
export type IvrLanguages = z.infer<typeof IvrLanguagesSchema>

export const TelephonyConfigSchema = z.object({
  provider: z.string(),
  config: z.record(z.string(), z.unknown()),
})
export type TelephonyConfig = z.infer<typeof TelephonyConfigSchema>

export const MessagingChannelConfigSchema = z.object({
  channel: z.enum(['sms', 'whatsapp', 'signal', 'rcs']),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})
export type MessagingChannelConfig = z.infer<typeof MessagingChannelConfigSchema>

export const MessagingConfigSchema = z.object({
  channels: z.array(MessagingChannelConfigSchema),
})
export type MessagingConfig = z.infer<typeof MessagingConfigSchema>
