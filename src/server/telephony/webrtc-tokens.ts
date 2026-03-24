import type { PlivoConfig, TwilioConfig, VonageConfig } from '../../shared/schemas/providers'
import type { TelephonyProviderConfig, TelephonyProviderType } from '../../shared/types'

/**
 * Generate a WebRTC access token for the given provider and identity.
 * Each provider has a different token format:
 * - Twilio/SignalWire: JWT with Voice grant
 * - Vonage: JWT with sub claim
 * - Plivo: JWT with voice endpoint
 */
export async function generateWebRtcToken(
  config: TelephonyProviderConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType }> {
  switch (config.type) {
    case 'twilio':
      return generateTwilioToken(config, identity)
    case 'signalwire':
      throw new Error('SignalWire WebRTC token generation not yet implemented')
    case 'vonage':
      return generateVonageToken(config, identity)
    case 'plivo':
      return generatePlivoToken(config, identity)
    case 'asterisk':
      throw new Error('Asterisk WebRTC requires JsSIP configuration (Epic 35)')
    case 'telnyx':
      throw new Error('Telnyx WebRTC not yet implemented')
    default: {
      const _exhaustive: never = config
      throw new Error(
        `WebRTC not supported for provider: ${(_exhaustive as TelephonyProviderConfig).type}`
      )
    }
  }
}

/**
 * Check whether a provider config has WebRTC properly configured.
 */
export function isWebRtcConfigured(config: TelephonyProviderConfig | null): boolean {
  if (!config) return false
  switch (config.type) {
    case 'twilio':
      return !!(
        config.webrtcEnabled &&
        config.apiKeySid &&
        config.apiKeySecret &&
        config.twimlAppSid
      )
    case 'signalwire':
      // SignalWire uses the same token flow as Twilio but config shape differs
      return false
    case 'vonage':
      return !!(config.applicationId && config.privateKey)
    case 'plivo':
      return !!(config.authId && config.authToken)
    default:
      return false
  }
}

// --- Twilio/SignalWire JWT ---
// Twilio Access Tokens use a HS256 JWT with Voice grant

async function generateTwilioToken(
  config: TwilioConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType }> {
  if (!config.apiKeySid || !config.apiKeySecret || !config.twimlAppSid) {
    throw new Error(
      'Missing Twilio WebRTC config: apiKeySid, apiKeySecret, twimlAppSid, accountSid'
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${config.apiKeySid}-${now}`,
    iss: config.apiKeySid,
    sub: config.accountSid,
    iat: now,
    exp: now + 3600, // 1 hour
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: config.twimlAppSid },
      },
    },
  }

  const token = await signJwtHs256(header, payload, config.apiKeySecret)
  return { token, provider: config.type }
}

// --- Vonage JWT ---
// Vonage uses RS256 JWT with application_id and sub claims

async function generateVonageToken(
  config: VonageConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType }> {
  if (!config.privateKey) {
    throw new Error('Missing Vonage WebRTC config: privateKey')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'RS256' }
  const payload = {
    iat: now,
    exp: now + 3600,
    jti: crypto.randomUUID(),
    application_id: config.applicationId,
    sub: identity,
    acl: {
      paths: {
        '/*/users/**': {},
        '/*/conversations/**': {},
        '/*/sessions/**': {},
        '/*/devices/**': {},
        '/*/image/**': {},
        '/*/media/**': {},
        '/*/knocking/**': {},
        '/*/legs/**': {},
      },
    },
  }

  const token = await signJwtRs256(header, payload, config.privateKey)
  return { token, provider: 'vonage' }
}

// --- Plivo JWT ---
// Plivo browser SDK uses auth credentials directly (Auth ID + Auth Token)
// The "token" is a time-limited credential pair

async function generatePlivoToken(
  config: PlivoConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType }> {
  // Plivo browser SDK authenticates with a username (endpoint) and password
  // The token format encodes credentials + identity for the client
  const tokenData = {
    username: `${identity}@app.plivo.com`,
    authId: config.authId,
    // For security, we generate a time-limited HMAC rather than sending the raw auth token
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  const hmac = await hmacSha256(config.authToken, JSON.stringify(tokenData))
  const token = base64urlEncode(JSON.stringify({ ...tokenData, sig: hmac }))
  return { token, provider: 'plivo' }
}

// --- Crypto helpers ---

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signJwtHs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const data = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const sigB64 = base64urlEncodeBytes(new Uint8Array(sig))
  return `${data}.${sigB64}`
}

async function signJwtRs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const data = `${headerB64}.${payloadB64}`

  // Parse PEM private key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))
  const sigB64 = base64urlEncodeBytes(new Uint8Array(sig))
  return `${data}.${sigB64}`
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
