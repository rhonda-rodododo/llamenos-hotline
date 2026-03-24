import { TelnyxConfigSchema } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { TelnyxConfig } from '@shared/schemas/providers'

export const telnyxCapabilities: ProviderCapabilities<TelnyxConfig> = {
  type: 'telnyx',
  displayName: 'Telnyx',
  description: 'Mission-critical communications platform with voice, SMS, SIP, and WebRTC support',
  credentialSchema: TelnyxConfigSchema,
  supportsOAuth: true,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,
  async testConnection(_credentials: TelnyxConfig): Promise<ConnectionTestResult> {
    throw new Error('Telnyx capabilities not yet implemented')
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
