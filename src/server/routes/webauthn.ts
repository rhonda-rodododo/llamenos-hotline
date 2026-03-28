import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { Hono } from 'hono'
import { uint8ArrayToBase64URL } from '../lib/helpers'
import {
  generateAuthOptions,
  generateRegOptions,
  verifyAuthResponse,
  verifyRegResponse,
} from '../lib/webauthn'
import { auth as authMiddleware } from '../middleware/auth'
import type { AppEnv, WebAuthnCredential } from '../types'

const webauthn = new Hono<AppEnv>()

// --- Public login routes (no auth) ---

webauthn.post('/login/options', async (c) => {
  const services = c.get('services')
  // Rate limit WebAuthn login attempts to prevent challenge flooding
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const limited = await services.settings.checkRateLimit(
    `webauthn:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    10
  )
  if (limited) return c.json({ error: 'Too many requests. Try again later.' }, 429)
  const rpID = new URL(c.req.url).hostname
  const credentials = await services.identity.getAllWebAuthnCredentials()
  const options = await generateAuthOptions(credentials, rpID)
  const challengeId = crypto.randomUUID()
  await services.identity.storeWebAuthnChallenge({ id: challengeId, challenge: options.challenge })
  return c.json({ ...options, challengeId })
})

webauthn.post('/login/verify', async (c) => {
  const services = c.get('services')
  // Rate limit verification attempts
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const verifyLimited = await services.settings.checkRateLimit(
    `webauthn-verify:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    10
  )
  if (verifyLimited) return c.json({ error: 'Too many requests. Try again later.' }, 429)
  const body = (await c.req.json()) as { assertion: unknown; challengeId: string }
  const origin = new URL(c.req.url).origin
  const rpID = new URL(c.req.url).hostname
  let challenge: string
  try {
    challenge = await services.identity.getWebAuthnChallenge(body.challengeId)
  } catch {
    return c.json({ error: 'Invalid or expired challenge' }, 400)
  }
  const credentials = await services.identity.getAllWebAuthnCredentials()
  const assertion = body.assertion as { id: string }
  const matched = credentials.find((cr) => cr.id === assertion.id)
  if (!matched) return c.json({ error: 'Unknown credential' }, 401)
  try {
    const verification = await verifyAuthResponse(assertion, matched, challenge, origin, rpID)
    if (!verification.verified) return c.json({ error: 'Verification failed' }, 401)
    await services.identity.updateWebAuthnCounter({
      pubkey: matched.ownerPubkey,
      credId: matched.id,
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date().toISOString(),
    })
    const session = await services.identity.createSession({ pubkey: matched.ownerPubkey })
    await services.records.addAuditEntry('global', 'webauthnLogin', matched.ownerPubkey, {
      credId: matched.id,
    })
    return c.json({ token: session.token, pubkey: session.pubkey })
  } catch {
    return c.json({ error: 'Verification failed' }, 401)
  }
})

// --- Authenticated routes ---
webauthn.use('/register/*', authMiddleware)
webauthn.use('/credentials', authMiddleware)
webauthn.use('/credentials/*', authMiddleware)

webauthn.post('/register/options', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const volunteer = c.get('volunteer')
  const body = await c.req.json().catch(() => ({}) as { label?: string })
  const rpID = new URL(c.req.url).hostname
  const rpName = c.env.HOTLINE_NAME || 'Hotline'
  const existing: WebAuthnCredential[] = await services.identity.getWebAuthnCredentials(pubkey)
  const options = await generateRegOptions({ pubkey, name: volunteer.name }, existing, rpID, rpName)
  const challengeId = crypto.randomUUID()
  await services.identity.storeWebAuthnChallenge({ id: challengeId, challenge: options.challenge })
  return c.json({ ...options, challengeId })
})

webauthn.post('/register/verify', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as { attestation: unknown; label: string; challengeId: string }
  const origin = new URL(c.req.url).origin
  const rpID = new URL(c.req.url).hostname
  let challenge: string
  try {
    challenge = await services.identity.getWebAuthnChallenge(body.challengeId)
  } catch {
    return c.json({ error: 'Invalid or expired challenge' }, 400)
  }
  try {
    const attestation = body.attestation as { response?: { transports?: string[] } }
    const verification = await verifyRegResponse(attestation, challenge, origin, rpID)
    if (!verification.verified || !verification.registrationInfo)
      return c.json({ error: 'Verification failed' }, 400)
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
    await services.identity.addWebAuthnCredential({ pubkey, credential: newCred })
    await services.records.addAuditEntry('global', 'webauthnRegistered', pubkey, {
      credId: newCred.id,
      label: body.label,
    })
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Verification failed' }, 400)
  }
})

webauthn.get('/credentials', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const credentials: WebAuthnCredential[] = await services.identity.getWebAuthnCredentials(pubkey)
  return c.json({
    credentials: credentials.map((cr) => ({
      id: cr.id,
      label: cr.label,
      backedUp: cr.backedUp,
      createdAt: cr.createdAt,
      lastUsedAt: cr.lastUsedAt,
    })),
  })
})

webauthn.delete('/credentials/:credId', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('credId'))
  if (!credId) return c.json({ error: 'Invalid credential ID' }, 400)
  try {
    await services.identity.deleteWebAuthnCredential(pubkey, credId)
    await services.records.addAuditEntry('global', 'webauthnDeleted', pubkey, { credId })
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
})

export default webauthn
