import { AsteriskConfigSchema } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { AsteriskConfig } from '@shared/schemas/providers'

export const asteriskCapabilities: ProviderCapabilities<AsteriskConfig> = {
  type: 'asterisk',
  displayName: 'Asterisk (Self-Hosted)',
  description: 'Self-hosted open-source PBX via ARI (Asterisk REST Interface)',
  credentialSchema: AsteriskConfigSchema,
  supportsOAuth: false,
  supportsSms: false,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: false,
  supportsWebhookAutoConfig: false,
  async testConnection(_credentials: AsteriskConfig): Promise<ConnectionTestResult> {
    throw new Error('Asterisk capabilities not yet implemented')
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
    }
  },
}
