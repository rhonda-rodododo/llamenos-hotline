import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { AUTH_PREFIX } from '@shared/crypto-labels'
import type { AuthPayload, Env, ServerSession, Volunteer } from '../types'

const TOKEN_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

export function parseAuthHeader(header: string | null): AuthPayload | null {
  if (!header?.startsWith('Bearer ')) return null
  try {
    return JSON.parse(header.slice(7))
  } catch {
    return null
  }
}

export function parseSessionHeader(header: string | null): string | null {
  if (!header?.startsWith('Session ')) return null
  return header.slice(8).trim()
}

export function validateToken(auth: AuthPayload): boolean {
  if (!auth.pubkey || !auth.timestamp || !auth.token) return false
  // Check token freshness
  const age = Date.now() - auth.timestamp
  if (age > TOKEN_MAX_AGE_MS || age < -TOKEN_MAX_AGE_MS) return false
  return true
}

export async function verifyAuthToken(
  auth: AuthPayload,
  method?: string,
  path?: string
): Promise<boolean> {
  if (!validateToken(auth)) return false
  if (!method || !path) return false // method+path binding is required
  try {
    const boundMessage = `${AUTH_PREFIX}${auth.pubkey}:${auth.timestamp}:${method}:${path}`
    const boundHash = sha256(utf8ToBytes(boundMessage))
    return schnorr.verify(hexToBytes(auth.token), boundHash, hexToBytes(auth.pubkey))
  } catch {
    return false
  }
}

export async function authenticateRequest(
  request: Request,
  identity: {
    validateSession(token: string): Promise<ServerSession>
    getVolunteer(pubkey: string): Promise<Volunteer | null>
  }
): Promise<{ pubkey: string; volunteer: Volunteer } | null> {
  const authHeader = request.headers.get('Authorization')

  // Try session token auth first (WebAuthn-based sessions)
  const sessionToken = parseSessionHeader(authHeader)
  if (sessionToken) {
    try {
      const session = await identity.validateSession(sessionToken)
      const volunteer = await identity.getVolunteer(session.pubkey)
      if (!volunteer) return null
      return { pubkey: session.pubkey, volunteer }
    } catch {
      return null
    }
  }

  // Fall back to Schnorr signature auth
  const auth = parseAuthHeader(authHeader)
  if (!auth) return null
  const url = new URL(request.url)
  if (!(await verifyAuthToken(auth, request.method, url.pathname))) return null

  // Look up volunteer via identity service
  const volunteer = await identity.getVolunteer(auth.pubkey)
  if (!volunteer) return null
  return { pubkey: auth.pubkey, volunteer }
}
