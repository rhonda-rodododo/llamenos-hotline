import type { AriClient } from './ari-client'

/**
 * Configures PJSIP SIP trunk objects in Asterisk via the ARI dynamic config API.
 * Called once at bridge startup when SIP_PROVIDER, SIP_USERNAME, SIP_PASSWORD are set.
 * Idempotent — safe to run on every restart.
 */
export class PjsipConfigurator {
  constructor(private readonly ari: AriClient) {}

  async configure(provider: string, username: string, password: string): Promise<void> {
    // Inbound/outbound auth credentials
    await this.ari.configureDynamic('res_pjsip', 'auth', 'trunk-auth', {
      auth_type: 'userpass',
      username,
      password,
    })

    // Address-of-record — where to send outbound calls and register
    await this.ari.configureDynamic('res_pjsip', 'aor', 'trunk', {
      contact: `sip:${username}@${provider}`,
      qualify_frequency: '60',
    })

    // Endpoint — binds transport, codec, and auth
    await this.ari.configureDynamic('res_pjsip', 'endpoint', 'trunk', {
      transport: 'transport-udp',
      context: 'from-trunk',
      disallow: 'all',
      allow: 'ulaw,alaw',
      outbound_auth: 'trunk-auth',
      aors: 'trunk',
    })

    // Registration — tells Asterisk to register with the provider
    await this.ari.configureDynamic('res_pjsip', 'registration', 'trunk-reg', {
      transport: 'transport-udp',
      outbound_auth: 'trunk-auth',
      server_uri: `sip:${provider}`,
      client_uri: `sip:${username}@${provider}`,
      retry_interval: '60',
      expiration: '3600',
    })

    // Reload res_pjsip so the new objects take effect
    await this.ari.reloadModule('res_pjsip.so')

    console.log(`[pjsip] SIP trunk configured for provider=${provider} username=${username}`)
  }
}
