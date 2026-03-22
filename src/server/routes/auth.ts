import { bytesToHex } from '@noble/hashes/utils.js'
import { Hono } from 'hono'
import { getPrimaryRole } from '../../shared/permissions'
import { verifyAuthToken } from '../lib/auth'
import { hashIP } from '../lib/crypto'
import { isValidE164 } from '../lib/helpers'
import { deriveServerEventKey } from '../lib/hub-event-crypto'
import { auth as authMiddleware } from '../middleware/auth'
import { checkPermission } from '../middleware/permission-guard'
import type { AppEnv, WebAuthnCredential } from '../types'

const auth = new Hono<AppEnv>()

// --- Login (no auth) ---
auth.post('/login', async (c) => {
  const services = c.get('services')

  // Rate limit login attempts by IP (skip in development for testing)
  if (c.env.ENVIRONMENT !== 'development') {
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
    const limited = await services.settings.checkRateLimit(
      `auth:${hashIP(clientIp, c.env.HMAC_SECRET)}`,
      10
    )
    if (limited) {
      return c.json({ error: 'Too many login attempts. Try again later.' }, 429)
    }
  }

  const body = (await c.req.json()) as { pubkey: string; timestamp: number; token: string }
  // Verify Schnorr signature before returning any user information
  if (!body.pubkey || !body.timestamp || !body.token) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  const url = new URL(c.req.url)
  const isValid = await verifyAuthToken(
    { pubkey: body.pubkey, timestamp: body.timestamp, token: body.token },
    c.req.method,
    url.pathname
  )
  if (!isValid) return c.json({ error: 'Invalid credentials' }, 401)

  const volunteer = await services.identity.getVolunteer(body.pubkey)
  if (!volunteer) return c.json({ error: 'Invalid credentials' }, 401)
  return c.json({ ok: true, roles: volunteer.roles })
})

// --- Bootstrap (no auth — one-shot admin registration) ---
auth.post('/bootstrap', async (c) => {
  const services = c.get('services')

  // Rate limit by IP
  if (c.env.ENVIRONMENT !== 'development') {
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
    const limited = await services.settings.checkRateLimit(
      `bootstrap:${hashIP(clientIp, c.env.HMAC_SECRET)}`,
      5
    )
    if (limited) {
      return c.json({ error: 'Too many attempts. Try again later.' }, 429)
    }
  }

  const body = (await c.req.json()) as { pubkey: string; timestamp: number; token: string }
  if (!body.pubkey || !body.timestamp || !body.token) {
    return c.json({ error: 'Invalid request' }, 400)
  }

  // Verify Schnorr signature — proves caller owns the private key
  const bootstrapUrl = new URL(c.req.url)
  const isValid = await verifyAuthToken(
    { pubkey: body.pubkey, timestamp: body.timestamp, token: body.token },
    c.req.method,
    bootstrapUrl.pathname
  )
  if (!isValid) return c.json({ error: 'Invalid signature' }, 401)

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

  return c.json({ ok: true, roles: ['role-super-admin'] })
})

// --- Authenticated routes ---
auth.use('/me', authMiddleware)
auth.use('/me/*', authMiddleware)

auth.get('/me', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const volunteer = c.get('volunteer')
  const permissions = c.get('permissions')
  const allRoles = c.get('allRoles')

  const webauthnCreds: WebAuthnCredential[] = await services.identity.getWebAuthnCredentials(pubkey)
  const webauthnSettings = await services.identity.getWebAuthnSettings()

  const isAdmin = checkPermission(permissions, 'settings:manage')
  const webauthnRequired = isAdmin
    ? webauthnSettings.requireForAdmins
    : webauthnSettings.requireForVolunteers

  const primaryRole = getPrimaryRole(volunteer.roles, allRoles)

  // Derive server event key for client-side decryption of encrypted relay events (Epic 252)
  // Moved here from /api/config to keep it behind authentication (Epic 258 C2)
  const serverEventKeyHex = c.env.SERVER_NOSTR_SECRET
    ? bytesToHex(deriveServerEventKey(c.env.SERVER_NOSTR_SECRET))
    : undefined

  return c.json({
    pubkey: volunteer.pubkey,
    roles: volunteer.roles,
    permissions,
    primaryRole: primaryRole
      ? { id: primaryRole.id, name: primaryRole.name, slug: primaryRole.slug }
      : null,
    name: volunteer.name,
    transcriptionEnabled: volunteer.transcriptionEnabled,
    spokenLanguages: volunteer.spokenLanguages || ['en'],
    uiLanguage: volunteer.uiLanguage || 'en',
    profileCompleted: volunteer.profileCompleted ?? true,
    onBreak: volunteer.onBreak ?? false,
    callPreference: volunteer.callPreference ?? 'phone',
    webauthnRequired,
    webauthnRegistered: webauthnCreds.length > 0,
    // H17: Removed adminPubkey (signing key identity) — only decryption pubkey needed
    adminDecryptionPubkey: c.env.ADMIN_DECRYPTION_PUBKEY || c.env.ADMIN_PUBKEY,
    serverEventKeyHex,
  })
})

auth.post('/me/logout', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const authHeader = c.req.header('Authorization') || ''
  // Revoke the session token if using session-based auth
  if (authHeader.startsWith('Session ')) {
    const token = authHeader.slice(8).trim()
    await services.identity.revokeSession(token)
  }
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
  await services.identity.updateVolunteer(pubkey, body)
  return c.json({ ok: true })
})

auth.patch('/me/availability', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = (await c.req.json()) as { onBreak: boolean }
  await services.identity.updateVolunteer(pubkey, { onBreak: body.onBreak })
  await services.records.addAuditEntry(
    'global',
    body.onBreak ? 'volunteerOnBreak' : 'volunteerAvailable',
    pubkey
  )
  return c.json({ ok: true })
})

auth.patch('/me/transcription', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const body = (await c.req.json()) as { enabled: boolean }
  // If volunteer is trying to disable, check if admin allows opt-out
  if (!body.enabled && !checkPermission(permissions, 'settings:manage-transcription')) {
    const transSettings = await services.settings.getTranscriptionSettings()
    if (!transSettings.allowVolunteerOptOut) {
      return c.json({ error: 'Transcription opt-out is not allowed' }, 403)
    }
  }
  await services.identity.updateVolunteer(pubkey, { transcriptionEnabled: body.enabled })
  await services.records.addAuditEntry('global', 'transcriptionToggled', pubkey, {
    enabled: body.enabled,
  })
  return c.json({ ok: true })
})

export default auth
