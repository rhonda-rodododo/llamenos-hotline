import { VonageConfigSchema } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { VonageConfig } from '@shared/schemas/providers'

export const vonageCapabilities: ProviderCapabilities<VonageConfig> = {
  type: 'vonage',
  displayName: 'Vonage',
  description: 'Global communications platform with voice, SMS, and SIP capabilities',
  credentialSchema: VonageConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,
  async testConnection(_credentials: VonageConfig): Promise<ConnectionTestResult> {
    throw new Error('Vonage capabilities not yet implemented')
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },
}
