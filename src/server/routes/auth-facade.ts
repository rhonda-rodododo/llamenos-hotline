import { bytesToHex } from '@noble/hashes/utils.js'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { LABEL_SESSION_META } from '../../shared/crypto-labels'
import { resolvePermissions } from '../../shared/permissions'
import {
  DemoLoginSchema,
  InviteAcceptSchema,
  WebAuthnLoginVerifySchema,
  WebAuthnRegisterVerifySchema,
} from '../../shared/schemas/auth'
import type { IdPAdapter } from '../idp/adapter'
import { hashIP } from '../lib/crypto-service'
import type { CryptoService } from '../lib/crypto-service'
import { lookupIp } from '../lib/geoip'
import { uint8ArrayToBase64URL } from '../lib/helpers'
import { signAccessToken, verifyAccessToken } from '../lib/jwt'
import { generateSessionToken, hashSessionToken } from '../lib/session-tokens'
import {
  generateAuthOptions,
  generateRegOptions,
  verifyAuthResponse,
  verifyRegResponse,
} from '../lib/webauthn'
import type { IdentityService } from '../services/identity'
import { sessionExpiry } from '../services/sessions'
import type { SessionService } from '../services/sessions'
import type { SettingsService } from '../services/settings'

const GEOIP_DB_PATH = process.env.GEOIP_DB_PATH ?? './data/geoip/dbip-city.mmdb'
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds
import type { WebAuthnCredential } from '../types'

// ---------------------------------------------------------------------------
// Type bindings for Hono context
// ---------------------------------------------------------------------------

interface AuthFacadeEnv {
  Bindings: {
    HMAC_SECRET: string
    JWT_SECRET: string
    HOTLINE_NAME: string
    AUTH_WEBAUTHN_RP_ID: string
    AUTH_WEBAUTHN_RP_NAME: string
    AUTH_WEBAUTHN_ORIGIN: string
    DEMO_MODE?: string
  }
  Variables: {
    identity: IdentityService
    idpAdapter: IdPAdapter
    settings: SettingsService
    sessions: SessionService
    crypto: CryptoService
    /** Set by jwtAuth middleware on authenticated routes */
    pubkey: string
    /** Set by jwtAuth middleware — permissions from the access token */
    permissions: string[]
  }
}

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter (per-IP, sliding window)
// ---------------------------------------------------------------------------

const rateLimitStore = new Map<string, { count: number; expiresAt: number }>()

function isRateLimited(key: string, maxPerWindow: number, windowMs = 5 * 60 * 1000): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || entry.expiresAt < now) {
    rateLimitStore.set(key, { count: 1, expiresAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > maxPerWindow
}

// Periodic cleanup (prevent unbounded growth)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (entry.expiresAt < now) rateLimitStore.delete(key)
  }
}, 60_000).unref?.()

// ---------------------------------------------------------------------------
// JWT-based auth middleware for protected routes
// ---------------------------------------------------------------------------

const jwtAuth = createMiddleware<AuthFacadeEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const token = header.slice(7)
  try {
    const payload = await verifyAccessToken(token, c.env.JWT_SECRET)
    c.set('pubkey', payload.sub)
    c.set('permissions', payload.permissions ?? [])
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})

// ---------------------------------------------------------------------------
// Helper: resolve permissions for a user
// ---------------------------------------------------------------------------

async function resolveUserPermissions(
  pubkey: string,
  identity: IdentityService,
  settings: SettingsService
): Promise<string[]> {
  const user = await identity.getUser(pubkey)
  if (!user || !user.active) return []
  const { resolvePermissions } = await import('../../shared/permissions')
  const allRoles = await settings.listRoles()
  return resolvePermissions(user.roles, allRoles)
}

// ---------------------------------------------------------------------------
// Helper: create a new opaque-token session and set refresh + session cookies.
// Returns the session id + opaque token.
// Used by login-verify, invite-accept, and dev bootstrap.
// ---------------------------------------------------------------------------

export interface CreateSessionParams {
  pubkey: string
  credentialId: string | null
  clientIp: string
  userAgent: string
  ipHash: string
  hmacSecret: string
  sessions: SessionService
  crypto: CryptoService
  geoipDbPath?: string
}

export async function createUserSession(
  params: CreateSessionParams
): Promise<{ sessionId: string; token: string }> {
  const geo = await lookupIp(params.clientIp, params.geoipDbPath ?? GEOIP_DB_PATH)

  const metaPlain = JSON.stringify({
    ip: params.clientIp,
    userAgent: params.userAgent,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    lat: geo.lat,
    lon: geo.lon,
  })
  const { encrypted, envelopes } = params.crypto.envelopeEncrypt(
    metaPlain,
    [params.pubkey],
    LABEL_SESSION_META
  )

  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token, params.hmacSecret)
  const sessionId = crypto.randomUUID()

  await params.sessions.create({
    id: sessionId,
    userPubkey: params.pubkey,
    tokenHash,
    ipHash: params.ipHash,
    credentialId: params.credentialId,
    encryptedMeta: encrypted,
    metaEnvelope: envelopes,
    expiresAt: sessionExpiry(),
  })

  return { sessionId, token }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const authFacade = new Hono<AuthFacadeEnv>()

// ===== Public routes (no auth) =====

// POST /webauthn/login-options
authFacade.post('/webauthn/login-options', async (c) => {
  const identity = c.get('identity')

  // Rate limit
  const clientIp =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('CF-Connecting-IP') ||
    'unknown'
  const ipHash = hashIP(clientIp, c.env.HMAC_SECRET)
  if (isRateLimited(`auth-login-opts:${ipHash}`, 10)) {
    return c.json({ error: 'Too many requests. Try again later.' }, 429)
  }

  const rpID = c.env.AUTH_WEBAUTHN_RP_ID
  const credentials = await identity.getAllWebAuthnCredentials()
  const options = await generateAuthOptions(credentials, rpID)
  const challengeId = crypto.randomUUID()
  await identity.storeWebAuthnChallenge({ id: challengeId, challenge: options.challenge })
  return c.json({ ...options, challengeId })
})

// POST /webauthn/login-verify
authFacade.post('/webauthn/login-verify', async (c) => {
  const identity = c.get('identity')

  // Rate limit
  const clientIp =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('CF-Connecting-IP') ||
    'unknown'
  const ipHash = hashIP(clientIp, c.env.HMAC_SECRET)
  if (isRateLimited(`auth-login-verify:${ipHash}`, 10)) {
    return c.json({ error: 'Too many requests. Try again later.' }, 429)
  }

  const parseResult = WebAuthnLoginVerifySchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data
  const origin = c.env.AUTH_WEBAUTHN_ORIGIN
  const rpID = c.env.AUTH_WEBAUTHN_RP_ID

  let challenge: string
  try {
    challenge = await identity.getWebAuthnChallenge(body.challengeId)
  } catch {
    return c.json({ error: 'Invalid or expired challenge' }, 400)
  }

  const credentials = await identity.getAllWebAuthnCredentials()
  const assertion = body.assertion as { id: string }
  const matched = credentials.find((cr) => cr.id === assertion.id)
  if (!matched) return c.json({ error: 'Unknown credential' }, 401)

  try {
    const verification = await verifyAuthResponse(assertion, matched, challenge, origin, rpID)
    if (!verification.verified) return c.json({ error: 'Verification failed' }, 401)

    await identity.updateWebAuthnCounter({
      pubkey: matched.ownerPubkey,
      credId: matched.id,
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date().toISOString(),
    })

    const settings = c.get('settings')
    const permissions = await resolveUserPermissions(matched.ownerPubkey, identity, settings)
    const accessToken = await signAccessToken(
      { pubkey: matched.ownerPubkey, permissions },
      c.env.JWT_SECRET
    )

    const { sessionId, token } = await createUserSession({
      pubkey: matched.ownerPubkey,
      credentialId: matched.id,
      clientIp,
      userAgent: c.req.header('User-Agent') || '',
      ipHash,
      hmacSecret: c.env.HMAC_SECRET,
      sessions: c.get('sessions'),
      crypto: c.get('crypto'),
    })

    setCookie(c, 'llamenos-refresh', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/auth/token',
      maxAge: SESSION_COOKIE_MAX_AGE,
    })
    setCookie(c, 'llamenos-session-id', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE,
    })

    return c.json({ accessToken, pubkey: matched.ownerPubkey })
  } catch {
    return c.json({ error: 'Verification failed' }, 401)
  }
})

// POST /invite/accept
authFacade.post('/invite/accept', async (c) => {
  const identity = c.get('identity')
  const parseResult = InviteAcceptSchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data

  const result = await identity.validateInvite(body.code)
  if (!result.valid) {
    return c.json({ error: result.error ?? 'Invalid invite' }, 400)
  }
  return c.json({ valid: true, roles: result.roleIds })
})

// POST /demo-login — issue JWT for a demo account (demo mode only)
authFacade.post('/demo-login', async (c) => {
  // Demo mode can be enabled via env var or via setup wizard (database setting)
  const envDemo = c.env.DEMO_MODE === 'true'
  let dbDemo = false
  if (!envDemo) {
    try {
      const settings = c.get('settings')
      const setupState = await settings.getSetupState()
      dbDemo = !!(setupState as unknown as Record<string, unknown>)?.demoMode
    } catch {
      /* settings not available yet */
    }
  }
  if (!envDemo && !dbDemo) {
    return c.json({ error: 'Demo mode is not enabled' }, 403)
  }
  const parseResult = DemoLoginSchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data

  const identity = c.get('identity')
  const user = await identity.getUser(body.pubkey)
  if (!user) return c.json({ error: 'Demo account not found' }, 404)

  // Resolve permissions from roles
  const settings = c.get('settings')
  const allRoles = await settings.listRoles()
  const permissions = resolvePermissions(user.roles, allRoles)

  const token = await signAccessToken(
    { pubkey: body.pubkey, permissions: [...new Set(permissions)] },
    c.env.JWT_SECRET
  )

  return c.json({ token })
})

// ===== Authenticated routes =====

authFacade.use('/webauthn/register-options', jwtAuth)
authFacade.use('/webauthn/register-verify', jwtAuth)
authFacade.use('/userinfo', jwtAuth)
authFacade.use('/rotation/confirm', jwtAuth)
authFacade.use('/session/revoke', jwtAuth)
authFacade.use('/devices', jwtAuth)
authFacade.use('/devices/*', jwtAuth)
authFacade.use('/admin/*', jwtAuth)

// POST /webauthn/register-options
authFacade.post('/webauthn/register-options', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const user = await identity.getUser(pubkey)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const rpID = c.env.AUTH_WEBAUTHN_RP_ID
  const rpName = c.env.AUTH_WEBAUTHN_RP_NAME || c.env.HOTLINE_NAME || 'Hotline'
  const existing: WebAuthnCredential[] = await identity.getWebAuthnCredentials(pubkey)
  const options = await generateRegOptions({ pubkey, name: user.name }, existing, rpID, rpName)
  const challengeId = crypto.randomUUID()
  await identity.storeWebAuthnChallenge({ id: challengeId, challenge: options.challenge })
  return c.json({ ...options, challengeId })
})

// POST /webauthn/register-verify
authFacade.post('/webauthn/register-verify', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')

  const parseResult = WebAuthnRegisterVerifySchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data
  const origin = c.env.AUTH_WEBAUTHN_ORIGIN
  const rpID = c.env.AUTH_WEBAUTHN_RP_ID

  let challenge: string
  try {
    challenge = await identity.getWebAuthnChallenge(body.challengeId)
  } catch {
    return c.json({ error: 'Invalid or expired challenge' }, 400)
  }

  try {
    const attestation = body.attestation as { response?: { transports?: string[] } }
    const verification = await verifyRegResponse(attestation, challenge, origin, rpID)
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Verification failed' }, 400)
    }

    const { credential: regCred, credentialBackedUp } = verification.registrationInfo
    const newCred: WebAuthnCredential = {
      id: regCred.id,
      publicKey: uint8ArrayToBase64URL(regCred.publicKey),
      counter: regCred.counter,
      transports: attestation.response?.transports || [],
      backedUp: credentialBackedUp,
      label: body.label || 'Passkey',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    }

    await identity.addWebAuthnCredential({ pubkey, credential: newCred })
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Verification failed' }, 400)
  }
})

// POST /token/refresh — CSRF: require Content-Type: application/json
authFacade.post('/token/refresh', async (c) => {
  const contentType = c.req.header('Content-Type')
  if (!contentType?.includes('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 415)
  }

  const refreshCookie = getCookie(c, 'llamenos-refresh')
  if (!refreshCookie) {
    return c.json({ error: 'Missing refresh token' }, 401)
  }

  const sessions = c.get('sessions')
  const tokenHash = hashSessionToken(refreshCookie, c.env.HMAC_SECRET)
  const session = await sessions.findByTokenHash(tokenHash)
  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }
  if (session.revokedAt) {
    return c.json({ error: 'Session revoked' }, 401)
  }
  if (session.expiresAt < new Date()) {
    await sessions.revoke(session.id, 'expired')
    return c.json({ error: 'Session expired' }, 401)
  }

  // Rotate token
  const newToken = generateSessionToken()
  const newHash = hashSessionToken(newToken, c.env.HMAC_SECRET)
  await sessions.touch(session.id, newHash)

  const pubkey = session.userPubkey
  const idpAdapter = c.get('idpAdapter')
  const identity = c.get('identity')

  // Confirm user is still active in IdP
  const idpSession = await idpAdapter.refreshSession(pubkey)
  if (!idpSession.valid) {
    await sessions.revoke(session.id, 'admin')
    return c.json({ error: 'Session no longer valid' }, 401)
  }

  const settings = c.get('settings')
  const permissions = await resolveUserPermissions(pubkey, identity, settings)
  const accessToken = await signAccessToken({ pubkey, permissions }, c.env.JWT_SECRET)

  setCookie(c, 'llamenos-refresh', newToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api/auth/token',
    maxAge: SESSION_COOKIE_MAX_AGE,
  })

  return c.json({ accessToken })
})

// GET /userinfo — return pubkey + nsec secret for KEK derivation
authFacade.get('/userinfo', async (c) => {
  const pubkey = c.get('pubkey')
  const idpAdapter = c.get('idpAdapter')

  let nsecSecret: string | null = null
  try {
    const nsecBytes = await idpAdapter.getNsecSecret(pubkey)
    nsecSecret = bytesToHex(nsecBytes)
  } catch {
    // User not enrolled in IdP yet (e.g., during initial registration or test setup).
    // Return null — the client will use a synthetic IdP value for KEK derivation.
  }

  return c.json({ pubkey, nsecSecret })
})

// POST /rotation/confirm
authFacade.post('/rotation/confirm', async (c) => {
  const pubkey = c.get('pubkey')
  const idpAdapter = c.get('idpAdapter')
  await idpAdapter.confirmRotation(pubkey)
  return c.json({ ok: true })
})

// POST /session/revoke
authFacade.post('/session/revoke', async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const idpAdapter = c.get('idpAdapter')

  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  if (sessionIdCookie) {
    const session = await sessions.findByIdForUser(sessionIdCookie, pubkey)
    if (session) {
      await sessions.revoke(session.id, 'user')
    }
  }

  // Also revoke IdP session if still applicable.
  try {
    await idpAdapter.revokeSession(pubkey)
  } catch {
    // IdP may have already expired; ignore.
  }

  setCookie(c, 'llamenos-refresh', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api/auth/token',
    maxAge: 0,
  })
  setCookie(c, 'llamenos-session-id', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 0,
  })

  return c.json({ ok: true })
})

// GET /devices — list WebAuthn credentials
authFacade.get('/devices', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credentials = await identity.getWebAuthnCredentials(pubkey)
  return c.json({
    credentials: credentials.map((cr) => ({
      id: cr.id,
      label: cr.label,
      backedUp: cr.backedUp,
      createdAt: cr.createdAt,
      lastUsedAt: cr.lastUsedAt,
      // E2EE envelope fields for client-side label decryption
      ...(cr.encryptedLabel && cr.labelEnvelopes
        ? { encryptedLabel: cr.encryptedLabel, labelEnvelopes: cr.labelEnvelopes }
        : {}),
    })),
    warning: credentials.length === 1 ? 'Register a backup device to prevent lockout' : undefined,
  })
})

// POST /admin/re-enroll/:pubkey — admin-only: revoke all sessions + delete all WebAuthn credentials
authFacade.post('/admin/re-enroll/:pubkey', async (c) => {
  const permissions = c.get('permissions')
  if (!permissions.includes('users:update') && !permissions.includes('*')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const targetPubkey = c.req.param('pubkey')
  const idpAdapter = c.get('idpAdapter')
  const identity = c.get('identity')

  const user = await identity.getUser(targetPubkey)
  if (!user) return c.json({ error: 'User not found' }, 404)

  await idpAdapter.revokeAllSessions(targetPubkey)

  const creds = await identity.getWebAuthnCredentials(targetPubkey)
  for (const cred of creds) {
    await identity.deleteWebAuthnCredential(targetPubkey, cred.id)
  }

  return c.json({ success: true })
})

// POST /enroll — admin-only: create IdP user for a pubkey and return nsecSecret
authFacade.post('/enroll', jwtAuth, async (c) => {
  const permissions = c.get('permissions')
  if (!permissions.includes('users:create') && !permissions.includes('*')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { pubkey } = await c.req.json<{ pubkey: string }>()
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    return c.json({ error: 'Invalid pubkey' }, 400)
  }

  const idpAdapter = c.get('idpAdapter')

  // Idempotent: if user already exists, just return their nsecSecret
  const existing = await idpAdapter.getUser(pubkey)
  if (existing) {
    const nsecSecret = await idpAdapter.getNsecSecret(pubkey)
    return c.json({ nsecSecret: Buffer.from(nsecSecret).toString('hex') })
  }

  try {
    await idpAdapter.createUser(pubkey)
  } catch {
    // Race condition: concurrent createUser for same pubkey — check if it was created
    const raceCheck = await idpAdapter.getUser(pubkey)
    if (!raceCheck) throw new Error(`Failed to create IdP user for ${pubkey}`)
  }
  const nsecSecret = await idpAdapter.getNsecSecret(pubkey)
  return c.json({ nsecSecret: Buffer.from(nsecSecret).toString('hex') })
})

// DELETE /devices/:id — delete a credential
authFacade.delete('/devices/:id', async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('id'))
  if (!credId) return c.json({ error: 'Invalid credential ID' }, 400)

  try {
    await identity.deleteWebAuthnCredential(pubkey, credId)
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
})

export default authFacade

// Export for testing
export { type AuthFacadeEnv, isRateLimited, rateLimitStore }
