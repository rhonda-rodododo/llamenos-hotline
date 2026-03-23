import { Hono } from 'hono'
import { getDOs } from '../lib/do-access'
import {
  buildTelephonyPayload,
  buildMessagingPayload,
  type TelephonyProvider,
  type MessagingProvider,
  type MessagingChannel,
  type SimulateCallParams,
  type SimulateMessageParams,
} from '../lib/test-payload-factory'
import type { AppEnv } from '../types'

const dev = new Hono<AppEnv>()

/**
 * Secondary gate: if DEV_RESET_SECRET is set, require X-Test-Secret header.
 * Protects against accidental ENVIRONMENT=development in production.
 */
function checkResetSecret(c: {
  env: { DEV_RESET_SECRET?: string; E2E_TEST_SECRET?: string }
  req: { header(name: string): string | undefined }
}): boolean {
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return false // No secret configured — deny by default
  return c.req.header('X-Test-Secret') === secret
}

dev.post('/test-reset', async (c) => {
  // Full reset: development and demo only — too destructive for staging
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  if (!checkResetSecret(c)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const dos = getDOs(c.env)
  await dos.identity.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.settings.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.records.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.shifts.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.calls.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.conversations.fetch(new Request('http://do/reset', { method: 'POST' }))
  return c.json({ ok: true })
})

// Reset to a truly fresh state — no admin, no ADMIN_PUBKEY effect
// Used for testing in-browser admin bootstrap
dev.post('/test-reset-no-admin', async (c) => {
  // Full reset without admin: development and demo only
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  if (!checkResetSecret(c)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const dos = getDOs(c.env)
  // Reset all DOs (ensureInit re-creates admin from ADMIN_PUBKEY)
  await dos.identity.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.settings.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.records.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.shifts.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.calls.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.conversations.fetch(new Request('http://do/reset', { method: 'POST' }))
  // Set _skipAdminSeed flag and delete admin so bootstrap tests see needsBootstrap=true
  // This persists across DO eviction/restart, unlike in-memory flags
  await dos.identity.fetch(new Request('http://do/test-skip-admin-seed', { method: 'POST' }))
  if (c.env.ADMIN_PUBKEY) {
    await dos.identity.fetch(
      new Request(`http://do/volunteers/${c.env.ADMIN_PUBKEY}`, { method: 'DELETE' })
    )
  }
  return c.json({ ok: true })
})

// Light reset: only clears records, calls, conversations, and shifts
// Preserves identity (admin account) and settings (setup state)
// Used by live telephony E2E tests against staging
dev.post('/test-reset-records', async (c) => {
  const isDev = c.env.ENVIRONMENT === 'development'
  const isStaging =
    c.env.ENVIRONMENT === 'staging' &&
    c.env.E2E_TEST_SECRET &&
    c.req.header('X-Test-Secret') === c.env.E2E_TEST_SECRET
  if (!isDev && !isStaging) {
    return c.json({ error: 'Not Found' }, 404)
  }
  if (isDev && !checkResetSecret(c)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const dos = getDOs(c.env)
  await dos.records.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.shifts.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.calls.fetch(new Request('http://do/reset', { method: 'POST' }))
  await dos.conversations.fetch(new Request('http://do/reset', { method: 'POST' }))
  return c.json({ ok: true })
})

// -------------------------------------------------------------------
// Simulation infrastructure — POST factory-generated payloads to real webhook endpoints
// -------------------------------------------------------------------

/** POST a factory-generated payload to the real webhook endpoint. */
async function postToWebhook(
  c: { req: { url: string } },
  factoryResult: { body: string; contentType: string; headers: Record<string, string>; path: string }
): Promise<Response> {
  const origin = new URL(c.req.url).origin
  return fetch(`${origin}${factoryResult.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': factoryResult.contentType,
      'CF-Connecting-IP': '127.0.0.1', // triggers telephony/messaging dev bypass
      ...factoryResult.headers,
    },
    body: factoryResult.body,
  })
}

// --- Telephony simulation ---

dev.post('/test-simulate/incoming-call', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
  if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
  const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
  const params: SimulateCallParams = await c.req.json().catch(() => ({}))
  const result = buildTelephonyPayload(provider, 'incoming-call', params)
  const res = await postToWebhook(c, result)
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
  })
})

dev.post('/test-simulate/answer-call', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
  if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
  const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
  const params: SimulateCallParams = await c.req.json().catch(() => ({}))
  const result = buildTelephonyPayload(provider, 'answer-call', params)
  const res = await postToWebhook(c, result)
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
  })
})

dev.post('/test-simulate/end-call', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
  if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
  const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
  const params: SimulateCallParams = await c.req.json().catch(() => ({}))
  const result = buildTelephonyPayload(provider, 'end-call', params)
  const res = await postToWebhook(c, result)
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
  })
})

dev.post('/test-simulate/voicemail', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
  if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
  const provider = (c.req.query('provider') ?? 'twilio') as TelephonyProvider
  const params: SimulateCallParams = await c.req.json().catch(() => ({}))
  const result = buildTelephonyPayload(provider, 'voicemail', params)
  const res = await postToWebhook(c, result)
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
  })
})

// --- Messaging simulation ---

dev.post('/test-simulate/incoming-message', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
  if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
  const provider = (c.req.query('provider') ?? 'twilio') as MessagingProvider
  const channel = (c.req.query('channel') ?? 'sms') as MessagingChannel
  const params: SimulateMessageParams = await c.req.json().catch(() => ({}))
  const result = buildMessagingPayload(provider, channel, 'incoming-message', params)
  const res = await postToWebhook(c, result)
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
  })
})

dev.post('/test-simulate/delivery-status', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.json({ error: 'Not Found' }, 404)
  if (!checkResetSecret(c)) return c.json({ error: 'Forbidden' }, 403)
  const provider = (c.req.query('provider') ?? 'twilio') as MessagingProvider
  const channel = (c.req.query('channel') ?? 'sms') as MessagingChannel
  const params: SimulateMessageParams = await c.req.json().catch(() => ({}))
  const result = buildMessagingPayload(provider, channel, 'delivery-status', params)
  const res = await postToWebhook(c, result)
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },
  })
})

export default dev
