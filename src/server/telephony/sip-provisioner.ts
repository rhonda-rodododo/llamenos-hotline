/**
 * SipEndpointProvisioner — generic interface for provisioning WebRTC-capable
 * SIP endpoints on self-hosted PBX systems.
 */
export interface SipEndpointConfig {
  sipUri: string
  username: string
  password: string
  wsUri: string
  iceServers: Array<{
    urls: string | string[]
    username?: string
    credential?: string
  }>
}

export interface SipEndpointProvisioner {
  provisionEndpoint(pubkey: string): Promise<SipEndpointConfig>
  deprovisionEndpoint(pubkey: string): Promise<void>
  checkEndpoint(pubkey: string): Promise<boolean>
}
