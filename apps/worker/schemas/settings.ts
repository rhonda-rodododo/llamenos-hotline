import { z } from 'zod'

export const spamSettingsSchema = z.object({
  voiceCaptchaEnabled: z.boolean().optional(),
  rateLimitEnabled: z.boolean().optional(),
  maxCallsPerMinute: z.number().int().min(1).max(100).optional(),
  blockDurationMinutes: z.number().int().min(1).max(1440).optional(),
}).passthrough()

export const callSettingsSchema = z.object({
  queueTimeoutSeconds: z.number().int().min(30).max(300).optional(),
  voicemailMaxSeconds: z.number().int().min(30).max(300).optional(),
}).passthrough()

export const messagingConfigSchema = z.object({
  enabledChannels: z.array(z.enum(['sms', 'whatsapp', 'signal', 'rcs'])).optional(),
  autoAssignEnabled: z.boolean().optional(),
  maxConcurrentPerVolunteer: z.number().int().min(1).max(20).optional(),
  inactivityTimeout: z.number().int().min(5).max(1440).optional(),
  welcomeMessage: z.string().max(500).optional(),
  awayMessage: z.string().max(500).optional(),
}).passthrough()

export const telephonyProviderSchema = z.object({
  type: z.enum(['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk']),
  accountSid: z.string().optional(),
  authToken: z.string().optional(),
  apiKeySid: z.string().optional(),
  apiKeySecret: z.string().optional(),
  phoneNumber: z.string().regex(/^\+\d{7,15}$/).optional(),
  twimlAppSid: z.string().optional(),
  projectId: z.string().optional(),
  spaceUrl: z.string().url().optional(),
  applicationId: z.string().optional(),
  ariUrl: z.string().url().optional(),
  ariUsername: z.string().optional(),
  ariPassword: z.string().optional(),
  // Allow extra provider-specific fields
  signalwireSpace: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  authId: z.string().optional(),
}).passthrough()

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  permissions: z.array(z.string()),
  description: z.string().min(1).max(500),
}).passthrough()

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).optional(),
}).passthrough()

export const webauthnSettingsSchema = z.object({
  requireForAdmins: z.boolean().optional(),
  requireForVolunteers: z.boolean().optional(),
}).passthrough()

export const transcriptionSettingsSchema = z.object({
  globalEnabled: z.boolean().optional(),
  allowVolunteerOptOut: z.boolean().optional(),
}).passthrough()

export const ivrLanguagesSchema = z.object({
  languages: z.array(z.string()).optional(),
}).passthrough()

export const setupStateSchema = z.object({
  completed: z.boolean().optional(),
  step: z.string().optional(),
}).passthrough()
