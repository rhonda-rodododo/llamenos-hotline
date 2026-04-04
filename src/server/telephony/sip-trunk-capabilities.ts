import { z } from 'zod/v4'
import type { ProviderCapabilities } from './capabilities'

/**
 * SIP Trunk configuration schema.
 * SIP trunks are NOT a separate TelephonyAdapter — they configure
 * the existing Asterisk (or FreeSWITCH) adapter to route calls
 * through an external SIP trunk provider.
 */
export const SipTrunkSetupSchema = z.object({
  preset: z.string().optional(),
  trunkDomain: z.string().min(1),
  trunkPort: z.number().default(5060),
  transport: z.enum(['udp', 'tcp', 'tls']).default('udp'),
  authType: z.enum(['registration', 'ip-based']),
  username: z.string().optional(),
  password: z.string().optional(),
  authUsername: z.string().optional(),
  codecs: z.array(z.string()).default(['ulaw', 'alaw']),
  dtmfMode: z.enum(['rfc2833', 'inband', 'info']).default('rfc2833'),
  didNumber: z.string().min(1),
})
export type SipTrunkSetup = z.infer<typeof SipTrunkSetupSchema>

/**
 * SIP trunk "capabilities" — not a full ProviderCapabilities since
 * SIP trunks delegate call control to the underlying PBX adapter.
 * This provides setup/test functionality only.
 */
export const sipTrunkCapabilities = {
  type: 'sip-trunk' as const,
  displayName: 'SIP Trunk (Generic)',
  description:
    'Connect any SIP trunk provider (VoIP.ms, Flowroute, sipgate, etc.) through your Asterisk or FreeSWITCH PBX',

  async testConnection(
    config: SipTrunkSetup
  ): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
    // SIP trunk testing requires the bridge to check registration status
    // This is a placeholder — actual test happens via SipTrunkProvisioner.testTrunkConnectivity()
    return {
      connected: false,
      error: 'SIP trunk test requires Asterisk bridge — use the provisioner',
    }
  },

  getWebhookUrls(baseUrl: string, hubId?: string) {
    // SIP trunks don't have webhook URLs — they use the Asterisk adapter's webhooks
    const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
    return {
      voiceIncoming: `${baseUrl}/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/telephony/call-status${qs}`,
    }
  },
}
