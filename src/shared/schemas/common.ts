import { z } from 'zod/v4'

export const ContactTypeSchema = z.enum(['caller', 'partner-org', 'referral-resource', 'other'])
export type ContactType = z.infer<typeof ContactTypeSchema>

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

export const LocationPrecisionSchema = z.enum(['none', 'city', 'neighborhood', 'block', 'exact'])
export type LocationPrecision = z.infer<typeof LocationPrecisionSchema>

export const CallPreferenceSchema = z.enum(['phone', 'browser', 'both'])
export type CallPreference = z.infer<typeof CallPreferenceSchema>

export const MessageDeliveryStatusSchema = z.enum([
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
])
export type MessageDeliveryStatus = z.infer<typeof MessageDeliveryStatusSchema>

export const MessagingChannelTypeSchema = z.enum(['sms', 'whatsapp', 'signal', 'rcs'])
export type MessagingChannelType = z.infer<typeof MessagingChannelTypeSchema>

export const ChannelTypeSchema = z.enum(['voice', 'sms', 'whatsapp', 'signal', 'rcs', 'reports'])
export type ChannelType = z.infer<typeof ChannelTypeSchema>

export const CustomFieldContextSchema = z.enum([
  'call-notes',
  'conversation-notes',
  'reports',
  'all',
])
export type CustomFieldContext = z.infer<typeof CustomFieldContextSchema>
