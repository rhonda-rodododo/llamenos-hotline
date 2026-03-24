import { PlivoConfigSchema } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { PlivoConfig } from '@shared/schemas/providers'

export const plivoCapabilities: ProviderCapabilities<PlivoConfig> = {
  type: 'plivo',
  displayName: 'Plivo',
  description: 'Cloud communications API for voice and SMS',
  credentialSchema: PlivoConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,
  async testConnection(_credentials: PlivoConfig): Promise<ConnectionTestResult> {
    throw new Error('Plivo capabilities not yet implemented')
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
