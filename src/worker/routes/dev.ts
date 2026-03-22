import { Hono } from 'hono'
import { getDOs } from '../lib/do-access'
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

export default dev
