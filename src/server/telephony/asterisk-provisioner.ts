import { BridgeClient } from './bridge-client'
import type { SipEndpointConfig, SipEndpointProvisioner } from './sip-provisioner'

/**
 * AsteriskProvisioner — provisions WebRTC-capable SIP endpoints on Asterisk
 * via the asterisk-bridge service. Computes time-limited TURN credentials
 * using coturn's use-auth-secret mechanism (RFC 5766 HMAC-SHA1).
 */
export class AsteriskProvisioner implements SipEndpointProvisioner {
  private bridge: BridgeClient

  constructor(
    bridgeCallbackUrl: string,
    bridgeSecret: string,
    private asteriskDomain: string,
    private wssPort: number,
    private stunServer: string,
    private turnServer?: string,
    private turnSecret?: string
  ) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  /** Compute time-limited TURN credential using HMAC-SHA1(secret, username) per RFC 5766 */
  private async computeTurnCredential(turnUsername: string): Promise<string> {
    if (!this.turnSecret) throw new Error('TURN_SECRET required for TURN credential generation')
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.turnSecret) as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(turnUsername) as Uint8Array<ArrayBuffer>
    )
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
  }

  async provisionEndpoint(pubkey: string): Promise<SipEndpointConfig> {
    const result = await this.bridge.request('POST', '/provision-endpoint', { pubkey })
    const { username, password } = result as { ok: boolean; username: string; password: string }

    const iceServers: SipEndpointConfig['iceServers'] = []
    if (this.stunServer) {
      iceServers.push({ urls: this.stunServer })
    }
    if (this.turnServer && this.turnSecret) {
      const ttl = 86400
      const expiry = Math.floor(Date.now() / 1000) + ttl
      const turnUsername = `${expiry}:${username}`
      const turnCredential = await this.computeTurnCredential(turnUsername)
      iceServers.push({
        urls: this.turnServer,
        username: turnUsername,
        credential: turnCredential,
      })
    }

    return {
      sipUri: `sip:${username}@${this.asteriskDomain}`,
      username,
      password,
      wsUri: `wss://${this.asteriskDomain}:${this.wssPort}/ws`,
      iceServers,
    }
  }

  async deprovisionEndpoint(pubkey: string): Promise<void> {
    await this.bridge.request('POST', '/deprovision-endpoint', { pubkey })
  }

  async checkEndpoint(pubkey: string): Promise<boolean> {
    try {
      const result = await this.bridge.request('POST', '/check-endpoint', { pubkey })
      return (result as { exists: boolean }).exists
    } catch {
      return false
    }
  }
}
