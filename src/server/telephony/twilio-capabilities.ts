import { TwilioConfigSchema } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { TwilioConfig } from '@shared/schemas/providers'

export const twilioCapabilities: ProviderCapabilities<TwilioConfig> = {
  type: 'twilio',
  displayName: 'Twilio',
  description: 'Cloud communications platform with voice, SMS, and WebRTC support',
  credentialSchema: TwilioConfigSchema,
  supportsOAuth: true,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,
  async testConnection(_credentials: TwilioConfig): Promise<ConnectionTestResult> {
    throw new Error('Twilio capabilities not yet implemented')
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
