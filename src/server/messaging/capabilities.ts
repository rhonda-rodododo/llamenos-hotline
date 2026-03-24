import type { z } from 'zod/v4'
import type { MessagingChannelType, ConnectionTestResult, WebhookUrlSet, AutoConfigResult } from '@shared/types'

export interface MessagingChannelCapabilities<T = unknown> {
  readonly channelType: MessagingChannelType
  readonly displayName: string
  readonly description: string
  readonly credentialSchema: z.ZodType<T>
  readonly supportsWebhookAutoConfig: boolean

  testConnection(config: T): Promise<ConnectionTestResult>
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet
  configureWebhooks?(config: T, webhookUrls: WebhookUrlSet): Promise<AutoConfigResult>
}

// Stub registry — will be replaced with real implementations in Task 10
import { SMSConfigSchema, WhatsAppConfigSchema, SignalBridgeConfigSchema, RCSConfigSchema } from '@shared/schemas/providers'

const smsCapabilities: MessagingChannelCapabilities = {
  channelType: 'sms',
  displayName: 'SMS',
  description: 'Text messaging via telephony provider',
  credentialSchema: SMSConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(): Promise<ConnectionTestResult> {
    return { connected: true, latencyMs: 0, accountName: 'Uses telephony provider' }
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}` }
  },
}

const whatsappCapabilities: MessagingChannelCapabilities = {
  channelType: 'whatsapp',
  displayName: 'WhatsApp',
  description: 'WhatsApp Business messaging',
  credentialSchema: WhatsAppConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(): Promise<ConnectionTestResult> {
    throw new Error('WhatsApp capabilities not yet implemented')
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { whatsappIncoming: `${baseUrl}/api/messaging/whatsapp/webhook${qs}` }
  },
}

const signalCapabilities: MessagingChannelCapabilities = {
  channelType: 'signal',
  displayName: 'Signal',
  description: 'Encrypted messaging via signal-cli bridge',
  credentialSchema: SignalBridgeConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(): Promise<ConnectionTestResult> {
    throw new Error('Signal capabilities not yet implemented')
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { signalIncoming: `${baseUrl}/api/messaging/signal/webhook${qs}` }
  },
}

const rcsCapabilities: MessagingChannelCapabilities = {
  channelType: 'rcs',
  displayName: 'RCS',
  description: 'Rich Communication Services via Google RBM',
  credentialSchema: RCSConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(): Promise<ConnectionTestResult> {
    throw new Error('RCS capabilities not yet implemented')
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { rcsIncoming: `${baseUrl}/api/messaging/rcs/webhook${qs}` }
  },
}

export const MESSAGING_CAPABILITIES: Record<MessagingChannelType, MessagingChannelCapabilities> = {
  sms: smsCapabilities,
  whatsapp: whatsappCapabilities,
  signal: signalCapabilities,
  rcs: rcsCapabilities,
}
