import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { Hono } from 'hono'
import { getPrimaryRole } from '../../shared/permissions'
import { getIdPAdapter } from '../app'
import { hashIP } from '../lib/crypto-service'
import { isValidE164 } from '../lib/helpers'
import { maskPhone } from '../lib/user-projector'
import { auth as authMiddleware } from '../middleware/auth'
import { checkPermission } from '../middleware/permission-guard'
import type { AppEnv, WebAuthnCredential } from '../types'

const auth = new Hono<AppEnv>()

// --- Bootstrap (no auth — one-shot admin registration) ---
auth.post('/bootstrap', async (c) => {
  const services = c.get('services')

  // Rate limit by IP
  if (c.env.ENVIRONMENT !== 'development') {
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
    const limited = await services.settings.checkRateLimit(
      `bootstrap:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
      5
    )
    if (limited) {
      return c.json({ error: 'Too many attempts. Try again later.' }, 429)
    }
  }

  const body = (await c.req.json()) as { pubkey: string }
  if (!body.pubkey) {
    return c.json({ error: 'Invalid request' }, 400)
  }

  // Check if admin already exists
  const hasAdmin = await services.identity.hasAdmin()
  if (hasAdmin) {
    return c.json({ error: 'Admin already exists' }, 403)
  }

  // Create the admin
  try {
    await services.identity.bootstrapAdmin(body.pubkey)
  } catch {
    return c.json({ error: 'Bootstrap failed' }, 500)
  }

  // Create user in IdP and retrieve nsecSecret
  const idpAdapter = getIdPAdapter()
  if (!idpAdapter) {
    return c.json({ error: 'IdP service not available' }, 503)
  }
  await idpAdapter.createUser(body.pubkey)
  const nsecSecret = await idpAdapter.getNsecSecret(body.pubkey)
  const nsecSecretHex = Buffer.from(nsecSecret).toString('hex')

  return c.json({ ok: true, roles: ['role-super-admin'], nsecSecret: nsecSecretHex })
})

// --- Authenticated routes ---
auth.use('/me', authMiddleware)
auth.use('/me/*', authMiddleware)

auth.get('/me', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const user = c.get('user')
  const permissions = c.get('permissions')
  const allRoles = c.get('allRoles')

  const webauthnCreds: WebAuthnCredential[] = await services.identity.getWebAuthnCredentials(pubkey)
  const webauthnSettings = await services.identity.getWebAuthnSettings()

  const isAdmin = checkPermission(permissions, 'settings:manage')
  const webauthnRequired = isAdmin
    ? webauthnSettings.requireForAdmins
    : webauthnSettings.requireForUsers

  const primaryRole = getPrimaryRole(user.roles, allRoles)

  return c.json({
    pubkey: user.pubkey,
    roles: user.roles,
    hubRoles: user.hubRoles ?? [],
    permissions,
    primaryRole: primaryRole ? { id: primaryRole.id, name: primaryRole.name } : null,
    name: user.name,
    // E2EE envelope fields — client uses these to decrypt name with their private key
    ...(user.encryptedName !== undefined ? { encryptedName: user.encryptedName } : {}),
    ...(user.nameEnvelopes !== undefined ? { nameEnvelopes: user.nameEnvelopes } : {}),
    // PII: phone always masked in self-view (client shows masked; unmask via PIN challenge + ?unmask=true on /users/:pubkey)
    phone: maskPhone(user.phone),
    transcriptionEnabled: user.transcriptionEnabled,
    spokenLanguages: user.spokenLanguages || ['en'],
    uiLanguage: user.uiLanguage || 'en',
    profileCompleted: user.profileCompleted ?? true,
    onBreak: user.onBreak ?? false,
    callPreference: user.callPreference ?? 'phone',
    webauthnRequired,
    webauthnRegistered: webauthnCreds.length > 0,
    // H17: Removed adminPubkey (signing key identity) — only decryption pubkey needed
    adminDecryptionPubkey: c.env.ADMIN_DECRYPTION_PUBKEY || c.env.ADMIN_PUBKEY,
    // HIGH-W1: Global server event key removed — hub keys delivered via per-hub ECIES
    // envelopes (GET /api/hubs/:hubId/key). Clients use hub-key-cache.ts for decryption.
  })
})

auth.post('/me/logout', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  await services.records.addAuditEntry('global', 'logout', pubkey)
  return c.json({ ok: true })
})

auth.patch('/me/profile', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as {
    name?: string
    phone?: string
    spokenLanguages?: string[]
    uiLanguage?: string
    profileCompleted?: boolean
    callPreference?: 'phone' | 'browser' | 'both'
  }
  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }
  await services.identity.updateUser(pubkey, body)
  return c.json({ ok: true })
})

auth.patch('/me/availability', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as { onBreak: boolean }
  await services.identity.updateUser(pubkey, { onBreak: body.onBreak })
  await services.records.addAuditEntry(
    'global',
    body.onBreak ? 'userOnBreak' : 'userAvailable',
    pubkey
  )
  return c.json({ ok: true })
})

auth.patch('/me/transcription', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const body = (await c.req.json()) as { enabled: boolean }
  // If user is trying to disable, check if admin allows opt-out
  if (!body.enabled && !checkPermission(permissions, 'settings:manage-transcription')) {
    const transSettings = await services.settings.getTranscriptionSettings()
    if (!transSettings.allowUserOptOut) {
      return c.json({ error: 'Transcription opt-out is not allowed' }, 403)
    }
  }
  await services.identity.updateUser(pubkey, { transcriptionEnabled: body.enabled })
  await services.records.addAuditEntry('global', 'transcriptionToggled', pubkey, {
    enabled: body.enabled,
  })
  return c.json({ ok: true })
})

export default auth
