import { Hono } from 'hono'
import { CONSENT_VERSION } from '../../shared/types'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const gdpr = new Hono<AppEnv>()

// GET /api/gdpr/consent — check consent status for authenticated volunteer
gdpr.get('/consent', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const status = await services.gdpr.getConsentStatus(pubkey)
  return c.json(status)
})

// POST /api/gdpr/consent — record consent
gdpr.post('/consent', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = await c.req.json<{ version?: string }>()
  if (!body.version) {
    return c.json({ error: 'version is required' }, 400)
  }
  if (body.version !== CONSENT_VERSION) {
    return c.json({ error: `Invalid consent version. Expected ${CONSENT_VERSION}` }, 400)
  }
  await services.gdpr.recordConsent(pubkey, body.version)
  return c.json({ ok: true })
})

// GET /api/gdpr/export — GDPR data export for authenticated volunteer
gdpr.get('/export', requirePermission('gdpr:export'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const data = await services.gdpr.exportForVolunteer(pubkey)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="llamenos-export-${date}.json"`,
    },
  })
})

// GET /api/gdpr/export/:pubkey — admin export of any volunteer's data
gdpr.get('/export/:targetPubkey', requirePermission('gdpr:admin'), async (c) => {
  const services = c.get('services')
  const adminPubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const targetPubkey = c.req.param('targetPubkey')
  const data = await services.gdpr.exportForVolunteer(targetPubkey)
  await services.records.addAuditEntry(hubId ?? 'global', 'gdprExportRequested', adminPubkey, {
    targetPubkey,
  })
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="llamenos-export-${targetPubkey.slice(0, 8)}-${date}.json"`,
    },
  })
})

// GET /api/gdpr/me/erasure — check self erasure request
gdpr.get('/me/erasure', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const request = await services.gdpr.getErasureRequest(pubkey)
  if (!request) return c.json({ request: null })
  return c.json({ request })
})

// DELETE /api/gdpr/me — create self-erasure request (72h delay)
gdpr.delete('/me', requirePermission('gdpr:erase-self'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const request = await services.gdpr.createErasureRequest(pubkey)
  await services.records.addAuditEntry(hubId ?? 'global', 'gdprErasureRequested', pubkey, {
    executeAt: request.executeAt,
  })
  return c.json({ request }, 202)
})

// DELETE /api/gdpr/me/cancel — cancel pending self-erasure
gdpr.delete('/me/cancel', async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  await services.gdpr.cancelErasureRequest(pubkey)
  return c.json({ ok: true })
})

// DELETE /api/gdpr/:pubkey — admin-initiated immediate erasure
gdpr.delete('/:targetPubkey', requirePermission('gdpr:admin'), async (c) => {
  const services = c.get('services')
  const adminPubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const targetPubkey = c.req.param('targetPubkey')
  await services.gdpr.eraseVolunteer(targetPubkey)
  await services.records.addAuditEntry(hubId ?? 'global', 'gdprErasureExecuted', adminPubkey, {
    targetPubkey,
    initiator: adminPubkey,
  })
  return c.json({ ok: true })
})

export default gdpr
