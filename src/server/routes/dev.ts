import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

function rand(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** ECIES-wrap a hub key for a recipient (test-only server-side helper). */
function wrapHubKeyForPubkey(hubKey: Uint8Array, recipientPubkeyHex: string) {
  const ephemeralSecret = rand(32)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)
  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.slice(1, 33)
  const labelBytes = utf8ToBytes(LABEL_HUB_KEY_WRAP)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)
  const nonce = rand(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(hubKey)
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return {
    pubkey: recipientPubkeyHex,
    wrappedKey: bytesToHex(packed),
    ephemeralPubkey: bytesToHex(ephemeralPublicKey),
  }
}

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
  await services.settings.resetForTest()
  // Re-bootstrap admin and default hub so tests can log in immediately after reset
  if (c.env.ADMIN_PUBKEY) {
    try {
      await services.identity.bootstrapAdmin(c.env.ADMIN_PUBKEY)
      await services.identity.updateVolunteer(c.env.ADMIN_PUBKEY, { profileCompleted: true })
    } catch {
      // Admin may already exist
    }
    // Create default hub with hub key envelopes so pages requiring hub context work
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
      // Generate and distribute hub key — ECIES-wrap for admin so hub key cache works
      const hubKey = rand(32)
      const envelope = wrapHubKeyForPubkey(hubKey, c.env.ADMIN_PUBKEY)
      await services.settings.setHubKeyEnvelopes(hub.id, [envelope])
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
  await services.settings.resetForTest()
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
