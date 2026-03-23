import { Hono } from 'hono'
import type { AppEnv } from '../types'

const dev = new Hono<AppEnv>()

dev.post('/test-reset', async (c) => {
  // Full reset: development and demo only — too destructive for staging
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  // HIGH-W4: When secret is not configured, return 404 (hide endpoint existence).
  // When secret IS configured but header is wrong, return 403 (endpoint known, access denied).
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const services = c.get('services')
  await services.identity.resetForTest()
  await services.records.resetForTest()
  await services.shifts.resetForTest()
  await services.calls.resetForTest()
  await services.conversations.resetForTest()
  await services.files.resetForTest()
  // Re-bootstrap admin and default hub so tests can log in immediately after reset
  if (c.env.ADMIN_PUBKEY) {
    try {
      await services.identity.bootstrapAdmin(c.env.ADMIN_PUBKEY)
      await services.identity.updateVolunteer(c.env.ADMIN_PUBKEY, { profileCompleted: true })
    } catch {
      // Admin may already exist
    }
    // Create default hub so pages that require hub context work
    try {
      const hub = await services.settings.createHub({
        id: 'default-hub',
        name: 'Default Hub',
        slug: 'default',
        createdBy: c.env.ADMIN_PUBKEY,
      })
      // Assign admin to the hub
      await services.identity.setHubRole({
        pubkey: c.env.ADMIN_PUBKEY,
        hubId: hub.id,
        roleIds: ['role-super-admin'],
      })
      // Mark setup as completed so the setup wizard doesn't intercept navigation
      await services.settings.updateSetupState({ setupCompleted: true })
    } catch {
      // Hub may already exist
    }
  }
  return c.json({ ok: true })
})

// Reset to a truly fresh state — no admin, no ADMIN_PUBKEY effect
// Used for testing in-browser admin bootstrap
dev.post('/test-reset-no-admin', async (c) => {
  // Full reset without admin: development and demo only
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const services = c.get('services')
  await services.identity.resetForTest()
  await services.records.resetForTest()
  await services.shifts.resetForTest()
  await services.calls.resetForTest()
  await services.conversations.resetForTest()
  await services.files.resetForTest()
  // Delete the admin volunteer so bootstrap tests see needsBootstrap=true
  if (c.env.ADMIN_PUBKEY) {
    try {
      await services.identity.deleteVolunteer(c.env.ADMIN_PUBKEY)
    } catch {
      // May not exist
    }
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
  if (isDev) {
    const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
    if (!secret) return c.json({ error: 'Not Found' }, 404)
    if (c.req.header('X-Test-Secret') !== secret) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }
  const services = c.get('services')
  await services.records.resetForTest()
  await services.shifts.resetForTest()
  await services.calls.resetForTest()
  await services.conversations.resetForTest()
  await services.files.resetForTest()
  return c.json({ ok: true })
})

export default dev
