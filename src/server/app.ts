import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { IdPAdapter } from './idp/adapter'
import messagingRoutes from './messaging/router'
import { auth } from './middleware/auth'
import { cors } from './middleware/cors'
import { errorHandler } from './middleware/error'
import { hubContext } from './middleware/hub'
import { checkPermission } from './middleware/permission-guard'
import { securityHeaders } from './middleware/security-headers'
import analyticsRoutes from './routes/analytics'
import auditRoutes from './routes/audit'
import authRoutes from './routes/auth'
import authFacadeRoutes from './routes/auth-facade'
import bansRoutes from './routes/bans'
import blastsRoutes from './routes/blasts'
import callsRoutes from './routes/calls'
import configRoutes from './routes/config'
import contactsRoutes from './routes/contacts'
import contactImportRoutes from './routes/contacts-import'
import conversationsRoutes from './routes/conversations'
import devRoutes from './routes/dev'
import filesRoutes from './routes/files'
import gdprRoutes from './routes/gdpr'
import geocodingRoutes from './routes/geocoding'
import healthRoutes from './routes/health'
import hubRoutes from './routes/hubs'
import intakesRoutes from './routes/intakes'
import invitesRoutes from './routes/invites'
import signalRegistrationRoutes from './routes/messaging/signal-registration'
import metricsRoutes from './routes/metrics'
import notesRoutes from './routes/notes'
import notificationsRoutes from './routes/notifications'
import providerSetupRoutes from './routes/provider-setup'
import provisioningRoutes from './routes/provisioning'
import reportTypesRoutes from './routes/report-types'
import reportsRoutes from './routes/reports'
import settingsRoutes from './routes/settings'
import setupRoutes from './routes/setup'
import shiftsRoutes from './routes/shifts'
import tagsRoutes from './routes/tags'
import teamsRoutes from './routes/teams'
import telephonyRoutes from './routes/telephony'
import uploadsRoutes from './routes/uploads'
import usersRoutes from './routes/users'
import webrtcRoutes from './routes/webrtc'
import type { AppEnv } from './types'

// Lazy-initialized IdP adapter (set up in server.ts via setIdPAdapter)
let _idpAdapter: IdPAdapter | null = null

export function setIdPAdapter(adapter: IdPAdapter): void {
  _idpAdapter = adapter
}

export function getIdPAdapter(): IdPAdapter | null {
  return _idpAdapter
}

const app = new Hono<AppEnv>()

app.onError(errorHandler)

// --- API routes: CORS on all /api/* ---
const api = new Hono<AppEnv>()

// Health check — before CORS middleware (internal probes only, no external access needed)
api.route('/health', healthRoutes)
api.route('/metrics', metricsRoutes)

api.use('*', cors)

// Public routes (no auth)
api.route('/config', configRoutes)
api.route('/', devRoutes)
api.route('/auth', authRoutes)

// Auth facade — bridge AppEnv services to AuthFacadeEnv variables
const authFacadeBridge = new Hono<AppEnv>()
authFacadeBridge.use('*', async (c, next) => {
  const services = c.get('services')
  if (!_idpAdapter) {
    return c.json({ error: 'IdP service not initialized' }, 503)
  }
  // biome-ignore lint/suspicious/noExplicitAny: bridging between two Hono env types
  const ctx = c as any
  ctx.set('identity', services.identity)
  ctx.set('idpAdapter', _idpAdapter)
  ctx.set('settings', services.settings)
  // Bridge env bindings that AuthFacadeEnv expects
  c.env.JWT_SECRET = c.env.JWT_SECRET ?? process.env.JWT_SECRET ?? ''
  c.env.AUTH_WEBAUTHN_RP_ID =
    c.env.AUTH_WEBAUTHN_RP_ID ?? process.env.AUTH_WEBAUTHN_RP_ID ?? new URL(c.req.url).hostname
  c.env.AUTH_WEBAUTHN_RP_NAME =
    c.env.AUTH_WEBAUTHN_RP_NAME ??
    process.env.AUTH_WEBAUTHN_RP_NAME ??
    c.env.HOTLINE_NAME ??
    'Hotline'
  c.env.AUTH_WEBAUTHN_ORIGIN =
    c.env.AUTH_WEBAUTHN_ORIGIN ?? process.env.AUTH_WEBAUTHN_ORIGIN ?? new URL(c.req.url).origin
  await next()
})
authFacadeBridge.route('/', authFacadeRoutes)
api.route('/auth', authFacadeBridge)

api.route('/invites', invitesRoutes)

// Device provisioning (mixed auth — room creation is public, payload submission is authenticated)
api.route('/provision', provisioningRoutes)

// Signal registration (authenticated admin routes — must be before webhook router)
const signalAdmin = new Hono<AppEnv>()
signalAdmin.use('*', auth)
signalAdmin.route('/', signalRegistrationRoutes)
api.route('/messaging/signal', signalAdmin)

// Messaging webhooks (each adapter validates its own signature)
api.route('/messaging', messagingRoutes)

// Public preferences endpoint (no auth, token-validated)
api.get('/messaging/preferences', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Token required' }, 400)
  const services = c.get('services')
  const subscriber = await services.blasts.getSubscriberByPreferenceToken(token)
  if (!subscriber) return c.json({ error: 'Invalid token' }, 404)
  return c.json({
    id: subscriber.id,
    channels: subscriber.channels,
    status: subscriber.status,
    tags: subscriber.tags,
    language: subscriber.language,
  })
})

api.patch('/messaging/preferences', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Token required' }, 400)
  const services = c.get('services')
  const subscriber = await services.blasts.getSubscriberByPreferenceToken(token)
  if (!subscriber) return c.json({ error: 'Invalid token' }, 404)
  const body = await c.req.json<{ status?: string; language?: string; tags?: string[] }>()
  const updated = await services.blasts.updateSubscriber(subscriber.id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.language !== undefined ? { language: body.language } : {}),
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
  })
  return c.json({
    id: updated.id,
    channels: updated.channels,
    status: updated.status,
    tags: updated.tags,
    language: updated.language,
  })
})

// Public VAPID key endpoint (no auth — browser needs this before subscribing)
api.get('/notifications/vapid-public-key', (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) return c.json({ error: 'Push notifications not configured' }, 503)
  return c.json({ publicKey: key })
})

// Public IVR audio serve (Twilio fetches during calls)
api.get('/ivr-audio/:promptType/:language', async (c) => {
  const promptType = c.req.param('promptType')
  const language = c.req.param('language')
  // Validate path params to prevent injection
  if (!/^[a-z_-]+$/.test(promptType) || !/^[a-z]{2,5}(-[A-Z]{2})?$/.test(language)) {
    return c.json({ error: 'Invalid parameters' }, 400)
  }
  const services = c.get('services')
  const audio = await services.settings.getIvrAudio(promptType, language)
  if (!audio) return c.json({ error: 'Audio not found' }, 404)
  return new Response(audio.audioData, {
    headers: { 'Content-Type': audio.mimeType },
  })
})

/**
 * MED-W1: Require hub context for non-super-admin requests on global resource routes.
 * Super-admins may access global routes without a hub ID (cross-hub visibility is intentional).
 * All other users must go through hub-scoped routes (/api/hubs/:hubId/...).
 */
const requireHubOrSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('hubId')) return next()
  const permissions = c.get('permissions')
  if (checkPermission(permissions, '*')) return next()
  return c.json({ error: 'Hub context required. Use /api/hubs/:hubId/... endpoints.' }, 400)
})

// Authenticated routes
const authenticated = new Hono<AppEnv>()
authenticated.use('*', auth)
authenticated.route('/users', usersRoutes)
// Resource routes shared with hub-scoped router: require hub context for non-super-admins
authenticated.use('/shifts/*', requireHubOrSuperAdmin)
authenticated.use('/shifts', requireHubOrSuperAdmin)
authenticated.use('/bans/*', requireHubOrSuperAdmin)
authenticated.use('/bans', requireHubOrSuperAdmin)
authenticated.use('/notes/*', requireHubOrSuperAdmin)
authenticated.use('/notes', requireHubOrSuperAdmin)
authenticated.use('/analytics/*', requireHubOrSuperAdmin)
authenticated.use('/analytics', requireHubOrSuperAdmin)
authenticated.use('/calls/*', requireHubOrSuperAdmin)
authenticated.use('/calls', requireHubOrSuperAdmin)
authenticated.use('/audit/*', requireHubOrSuperAdmin)
authenticated.use('/audit', requireHubOrSuperAdmin)
authenticated.use('/conversations/*', requireHubOrSuperAdmin)
authenticated.use('/conversations', requireHubOrSuperAdmin)
authenticated.use('/reports/*', requireHubOrSuperAdmin)
authenticated.use('/reports', requireHubOrSuperAdmin)
authenticated.use('/report-types/*', requireHubOrSuperAdmin)
authenticated.use('/report-types', requireHubOrSuperAdmin)
authenticated.use('/blasts/*', requireHubOrSuperAdmin)
authenticated.use('/blasts', requireHubOrSuperAdmin)
authenticated.use('/contacts/*', requireHubOrSuperAdmin)
authenticated.use('/contacts', requireHubOrSuperAdmin)
authenticated.use('/tags/*', requireHubOrSuperAdmin)
authenticated.use('/tags', requireHubOrSuperAdmin)
authenticated.use('/teams/*', requireHubOrSuperAdmin)
authenticated.use('/teams', requireHubOrSuperAdmin)
authenticated.use('/intakes/*', requireHubOrSuperAdmin)
authenticated.use('/intakes', requireHubOrSuperAdmin)
authenticated.route('/analytics', analyticsRoutes)
authenticated.route('/shifts', shiftsRoutes)
authenticated.route('/bans', bansRoutes)
authenticated.route('/notes', notesRoutes)
authenticated.route('/calls', callsRoutes)
authenticated.route('/audit', auditRoutes)
authenticated.route('/settings', settingsRoutes)
authenticated.route('/telephony', webrtcRoutes)
authenticated.route('/conversations', conversationsRoutes)
authenticated.route('/uploads', uploadsRoutes)
authenticated.route('/files', filesRoutes)
authenticated.route('/reports', reportsRoutes)
authenticated.route('/report-types', reportTypesRoutes)
authenticated.route('/setup', setupRoutes)
authenticated.route('/setup/provider', providerSetupRoutes)
authenticated.route('/hubs', hubRoutes)
authenticated.route('/blasts', blastsRoutes)
authenticated.route('/contacts', contactsRoutes)
authenticated.route('/contacts', contactImportRoutes)
authenticated.route('/tags', tagsRoutes)
authenticated.route('/teams', teamsRoutes)
authenticated.route('/intakes', intakesRoutes)
authenticated.route('/gdpr', gdprRoutes)
authenticated.route('/geocoding', geocodingRoutes)
authenticated.route('/notifications', notificationsRoutes)

// Hub-scoped authenticated routes
const hubScoped = new Hono<AppEnv>()
hubScoped.use('*', hubContext)
hubScoped.route('/analytics', analyticsRoutes)
hubScoped.route('/shifts', shiftsRoutes)
hubScoped.route('/bans', bansRoutes)
hubScoped.route('/notes', notesRoutes)
hubScoped.route('/calls', callsRoutes)
hubScoped.route('/audit', auditRoutes)
hubScoped.route('/conversations', conversationsRoutes)
hubScoped.route('/reports', reportsRoutes)
hubScoped.route('/report-types', reportTypesRoutes)
hubScoped.route('/blasts', blastsRoutes)
hubScoped.route('/contacts', contactsRoutes)
hubScoped.route('/contacts', contactImportRoutes)
hubScoped.route('/tags', tagsRoutes)
hubScoped.route('/teams', teamsRoutes)
hubScoped.route('/intakes', intakesRoutes)

authenticated.route('/hubs/:hubId', hubScoped)

api.route('/', authenticated)

// Telephony webhooks at top-level /telephony (validated by provider signature, not our auth)
// Must be top-level so Workbox navigateFallbackDenylist can exclude /telephony/* from SPA caching
app.route('/telephony', telephonyRoutes)

// Mount API under /api
app.route('/api', api)

// Static assets with security headers
app.use('*', securityHeaders)

export default app
