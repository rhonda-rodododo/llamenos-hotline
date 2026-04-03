import { BridgeClient } from './bridge-client'

/**
 * SIP trunk configuration for connecting to an external SIP provider.
 * Provisioned dynamically in Asterisk via ARI configureDynamic.
 */
export interface SipTrunkProvisionConfig {
  /** Unique ID for this trunk (e.g., 'trunk-voipms') */
  trunkId: string
  /** SIP provider domain (e.g., 'sip.voip.ms') */
  trunkDomain: string
  /** SIP port (default 5060) */
  trunkPort?: number
  /** Transport protocol */
  transport?: 'udp' | 'tcp' | 'tls'
  /** Authentication type */
  authType: 'registration' | 'ip-based'
  /** Username for registration-based auth */
  username?: string
  /** Password for registration-based auth */
  password?: string
  /** Auth username if different from SIP username */
  authUsername?: string
  /** Allowed codecs in preference order */
  codecs?: string[]
  /** DTMF mode */
  dtmfMode?: 'rfc2833' | 'inband' | 'info'
  /** DID number assigned by the trunk provider (E.164) */
  didNumber: string
}

/** Common SIP trunk provider presets */
export const SIP_TRUNK_PRESETS: Record<
  string,
  {
    domain: string
    port?: number
    transport?: 'udp' | 'tcp' | 'tls'
    authType: 'registration' | 'ip-based'
    notes: string
  }
> = {
  'voip.ms': {
    domain: 'chicago4.voip.ms',
    port: 5060,
    transport: 'udp',
    authType: 'registration',
    notes: 'City-specific servers — check voip.ms for your nearest POP',
  },
  flowroute: {
    domain: 'us-west-or.sip.flowroute.com',
    port: 5060,
    transport: 'udp',
    authType: 'ip-based',
    notes: 'IP-based auth — register your server IP in Flowroute dashboard',
  },
  sipgate: {
    domain: 'sipgate.de',
    port: 5060,
    transport: 'tls',
    authType: 'registration',
    notes: 'European provider — supports TLS',
  },
  callcentric: {
    domain: 'callcentric.com',
    port: 5060,
    transport: 'udp',
    authType: 'registration',
    notes: 'US provider with international reach',
  },
  'twilio-sip': {
    domain: 'pstn.twilio.com',
    port: 5060,
    transport: 'tls',
    authType: 'ip-based',
    notes: 'Twilio Elastic SIP Trunking — configure IP ACL in Twilio console',
  },
  'telnyx-sip': {
    domain: 'sip.telnyx.com',
    port: 5060,
    transport: 'tls',
    authType: 'registration',
    notes: 'Telnyx SIP Trunking — registration or IP-based',
  },
}

/**
 * Provisions a SIP trunk in Asterisk via the sip-bridge ARI service.
 * Creates PJSIP auth, aor, registration, and endpoint objects dynamically.
 */
export class SipTrunkProvisioner {
  private bridge: BridgeClient

  constructor(bridgeCallbackUrl: string, bridgeSecret: string) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  /**
   * Provision a SIP trunk in Asterisk's PJSIP configuration.
   * Creates: auth → aor → registration (if reg-based) → endpoint
   */
  async provisionTrunk(
    config: SipTrunkProvisionConfig
  ): Promise<{ success: boolean; error?: string }> {
    const id = config.trunkId
    const domain = config.trunkDomain
    const port = config.trunkPort ?? 5060
    const transport = `transport-${config.transport ?? 'udp'}`
    const codecs = config.codecs?.join(',') ?? '!all,ulaw,alaw'
    const dtmf = config.dtmfMode ?? 'rfc2833'

    try {
      // 1. Auth (only for registration-based)
      if (config.authType === 'registration' && config.username && config.password) {
        await this.bridge.request('POST', '/configure-dynamic', {
          configClass: 'res_pjsip',
          objectType: 'auth',
          id,
          fields: {
            auth_type: 'userpass',
            username: config.authUsername ?? config.username,
            password: config.password,
          },
        })
      }

      // 2. AOR (address of record)
      await this.bridge.request('POST', '/configure-dynamic', {
        configClass: 'res_pjsip',
        objectType: 'aor',
        id,
        fields: {
          contact: `sip:${domain}:${port}`,
          qualify_frequency: '60',
          ...(config.authType === 'registration' ? { outbound_auth: id } : {}),
        },
      })

      // 3. Registration (only for registration-based auth)
      if (config.authType === 'registration' && config.username) {
        await this.bridge.request('POST', '/configure-dynamic', {
          configClass: 'res_pjsip',
          objectType: 'registration',
          id,
          fields: {
            server_uri: `sip:${domain}:${port}`,
            client_uri: `sip:${config.username}@${domain}`,
            outbound_auth: id,
            retry_interval: '60',
            expiration: '3600',
          },
        })
      }

      // 4. Endpoint
      await this.bridge.request('POST', '/configure-dynamic', {
        configClass: 'res_pjsip',
        objectType: 'endpoint',
        id,
        fields: {
          transport: transport,
          context: 'from-trunk',
          disallow: 'all',
          allow: codecs,
          dtmf_mode: dtmf,
          aors: id,
          from_user: config.didNumber.replace('+', ''),
          from_domain: domain,
          ...(config.authType === 'registration' ? { outbound_auth: id } : {}),
          // Media settings
          rtp_symmetric: 'yes',
          force_rport: 'yes',
          rewrite_contact: 'yes',
          direct_media: 'no',
        },
      })

      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to provision SIP trunk',
      }
    }
  }

  /**
   * Remove a previously provisioned SIP trunk.
   */
  async deprovisionTrunk(trunkId: string): Promise<void> {
    // Remove in reverse order (endpoint → registration → aor → auth)
    for (const objectType of ['endpoint', 'registration', 'aor', 'auth']) {
      try {
        await this.bridge.request('POST', '/delete-dynamic', {
          configClass: 'res_pjsip',
          objectType,
          id: trunkId,
        })
      } catch {
        // Object may not exist (e.g., IP-based auth has no registration) — continue
      }
    }
  }

  /**
   * Test trunk connectivity by checking SIP registration status.
   */
  async testTrunkConnectivity(trunkId: string): Promise<{ connected: boolean; status?: string }> {
    try {
      const result = (await this.bridge.request('POST', '/check-registration', {
        id: trunkId,
      })) as { registered?: boolean; status?: string } | null
      return {
        connected: result?.registered === true,
        status: result?.status ?? 'unknown',
      }
    } catch {
      return { connected: false, status: 'Bridge unreachable' }
    }
  }
}
