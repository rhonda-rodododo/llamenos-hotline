import { SignalWireConfigSchema } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { SignalWireConfig } from '@shared/schemas/providers'

export const signalwireCapabilities: ProviderCapabilities<SignalWireConfig> = {
  type: 'signalwire',
  displayName: 'SignalWire',
  description: 'Open-source compatible cloud communications with voice, SMS, and SIP support',
  credentialSchema: SignalWireConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,
  async testConnection(_credentials: SignalWireConfig): Promise<ConnectionTestResult> {
    throw new Error('SignalWire capabilities not yet implemented')
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
