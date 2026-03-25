import { z } from 'zod/v4'

// ── Base schema shared by all telephony providers ──
const E164Phone = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format (e.g., +15551234567)')

const BaseProviderSchema = z.object({
  phoneNumber: E164Phone,
})

// ── Per-provider schemas ──

export const TwilioConfigSchema = BaseProviderSchema.extend({
  type: z.literal('twilio'),
  accountSid: z
    .string()
    .regex(/^AC[0-9a-f]{32}$/i, 'Must start with AC followed by 32 hex characters'),
  authToken: z.string().min(32, 'Auth token must be at least 32 characters'),
  webrtcEnabled: z.boolean().optional(),
  apiKeySid: z.string().optional(),
  apiKeySecret: z.string().optional(),
  twimlAppSid: z.string().optional(),
})
export type TwilioConfig = z.infer<typeof TwilioConfigSchema>

export const SignalWireConfigSchema = BaseProviderSchema.extend({
  type: z.literal('signalwire'),
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  signalwireSpace: z.string().min(1, 'Space name is required (e.g., "myspace")'),
})
export type SignalWireConfig = z.infer<typeof SignalWireConfigSchema>

export const VonageConfigSchema = BaseProviderSchema.extend({
  type: z.literal('vonage'),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  applicationId: z.string().uuid('Must be a valid UUID'),
  privateKey: z.string().optional(),
})
export type VonageConfig = z.infer<typeof VonageConfigSchema>

export const PlivoConfigSchema = BaseProviderSchema.extend({
  type: z.literal('plivo'),
  authId: z.string().min(1),
  authToken: z.string().min(1),
})
export type PlivoConfig = z.infer<typeof PlivoConfigSchema>

export const AsteriskConfigSchema = BaseProviderSchema.extend({
  type: z.literal('asterisk'),
  ariUrl: z.string().url('Must be a valid URL'),
  ariUsername: z.string().min(1),
  ariPassword: z.string().min(1),
  bridgeCallbackUrl: z.string().url().optional(),
  bridgeSecret: z.string().optional(),
  asteriskDomain: z.string().optional(),
  wssPort: z.number().optional(),
  stunServer: z.string().optional(),
  turnServer: z.string().optional(),
  turnSecret: z.string().optional(),
})
export type AsteriskConfig = z.infer<typeof AsteriskConfigSchema>

export const TelnyxConfigSchema = BaseProviderSchema.extend({
  type: z.literal('telnyx'),
  apiKey: z.string().min(1),
  texmlAppId: z.string().optional(),
})
export type TelnyxConfig = z.infer<typeof TelnyxConfigSchema>

// ── Discriminated union of all telephony providers ──
export const TelephonyProviderConfigSchema = z.discriminatedUnion('type', [
  TwilioConfigSchema,
  SignalWireConfigSchema,
  VonageConfigSchema,
  PlivoConfigSchema,
  AsteriskConfigSchema,
  TelnyxConfigSchema,
])
export type TelephonyProviderConfig = z.infer<typeof TelephonyProviderConfigSchema>

// ── Messaging channel schemas ──

export const SMSConfigSchema = z.object({
  enabled: z.boolean(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type SMSConfig = z.infer<typeof SMSConfigSchema>

export const WhatsAppConfigSchema = z.object({
  integrationMode: z.enum(['twilio', 'direct']),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  accessToken: z.string().optional(),
  verifyToken: z.string().optional(),
  appSecret: z.string().optional(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>

export const SignalBridgeConfigSchema = z.object({
  bridgeUrl: z.string().url(),
  bridgeApiKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  registeredNumber: z.string().min(1),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type SignalBridgeConfig = z.infer<typeof SignalBridgeConfigSchema>

export const RCSConfigSchema = z.object({
  agentId: z.string().min(1),
  serviceAccountKey: z.string().min(1),
  webhookSecret: z.string().optional(),
  fallbackToSms: z.boolean(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type RCSConfig = z.infer<typeof RCSConfigSchema>
