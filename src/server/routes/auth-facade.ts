import { bytesToHex } from '@noble/hashes/utils.js'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { resolvePermissions } from '../../shared/permissions'
import type { IdPAdapter } from '../idp/adapter'
import { hashIP } from '../lib/crypto-service'
import { uint8ArrayToBase64URL } from '../lib/helpers'
import { signAccessToken, verifyAccessToken } from '../lib/jwt'
import {
  generateAuthOptions,
  generateRegOptions,
  verifyAuthResponse,
  verifyRegResponse,
} from '../lib/webauthn'
import type { IdentityService } from '../services/identity'
import type { SettingsService } from '../services/settings'
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
// Helper: sign a refresh token (JWT with type=refresh, 30-day expiry)
// ---------------------------------------------------------------------------

async function signRefreshToken(pubkey: string, secret: string): Promise<string> {
  // Use the same signAccessToken but with type claim and longer expiry.
  // We piggyback on jose directly for the extra claim.
  const { SignJWT } = await import('jose')
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(pubkey)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime('30d')
    .setIssuer('llamenos')
    .sign(key)
}

async function verifyRefreshToken(token: string, secret: string): Promise<{ sub: string }> {
  const { jwtVerify } = await import('jose')
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key, {
    issuer: 'llamenos',
    algorithms: ['HS256'],
  })
  if (payload.type !== 'refresh') throw new Error('Not a refresh token')
  if (!payload.sub) throw new Error('Missing subject')
  return { sub: payload.sub }
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

  const body = (await c.req.json()) as { assertion: unknown; challengeId: string }
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

    const refreshToken = await signRefreshToken(matched.ownerPubkey, c.env.JWT_SECRET)
    setCookie(c, 'llamenos-refresh', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/auth/token',
      maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    })

    return c.json({ accessToken, pubkey: matched.ownerPubkey })
  } catch {
    return c.json({ error: 'Verification failed' }, 401)
  }
})

// POST /invite/accept
authFacade.post('/invite/accept', async (c) => {
  const identity = c.get('identity')
  const body = (await c.req.json()) as { code: string }
  if (!body.code) return c.json({ error: 'Missing invite code' }, 400)

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
  const body = (await c.req.json()) as { pubkey: string }
  if (!body.pubkey) return c.json({ error: 'Missing pubkey' }, 400)

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

  const body = (await c.req.json()) as {
    attestation: unknown
    label: string
    challengeId: string
  }
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

  let refreshPayload: { sub: string }
  try {
    refreshPayload = await verifyRefreshToken(refreshCookie, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Invalid or expired refresh token' }, 401)
  }

  const pubkey = refreshPayload.sub
  const idpAdapter = c.get('idpAdapter')
  const identity = c.get('identity')

  // Confirm user is still active in IdP
  const session = await idpAdapter.refreshSession(pubkey)
  if (!session.valid) {
    return c.json({ error: 'Session no longer valid' }, 401)
  }

  const settings = c.get('settings')
  const permissions = await resolveUserPermissions(pubkey, identity, settings)
  const accessToken = await signAccessToken({ pubkey, permissions }, c.env.JWT_SECRET)
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
  const idpAdapter = c.get('idpAdapter')
  await idpAdapter.revokeSession(pubkey)

  // Clear refresh cookie
  setCookie(c, 'llamenos-refresh', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/auth/token',
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
  if (!permissions.includes('volunteers:update') && !permissions.includes('*')) {
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
  if (!permissions.includes('volunteers:create') && !permissions.includes('*')) {
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
export { type AuthFacadeEnv, isRateLimited, rateLimitStore, signRefreshToken, verifyRefreshToken }
