import { Hono } from 'hono'
import { getTelephony } from '../lib/adapters'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv, AuditLogEntry } from '../types'

const calls = new Hono<AppEnv>()

calls.get('/active', requirePermission('calls:read-active'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const canSeeFullInfo = checkPermission(permissions, 'calls:read-active-full')
  const activeCalls = await services.calls.getActiveCalls(hubId)

  // Map server ActiveCall (callSid, assignedPubkey, Date) to client ActiveCall (id, answeredBy, string)
  const mapped = activeCalls.map((call) => ({
    id: call.callSid,
    callerNumber: canSeeFullInfo ? call.callerNumber : '[redacted]',
    answeredBy: call.assignedPubkey ?? null,
    startedAt: call.startedAt instanceof Date ? call.startedAt.toISOString() : call.startedAt,
    status: call.status,
  }))

  return c.json({ calls: mapped })
})

calls.get('/today-count', requirePermission('calls:read-active'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const count = await services.records.getCallsTodayCount(hubId)
  return c.json({ count })
})

calls.get('/presence', requirePermission('calls:read-presence'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const activeCalls = await services.calls.getActiveCalls(hubId)
  const onShift = await services.shifts.getActiveShifts(hubId)
  return c.json({
    activeCalls: activeCalls.length,
    onShift: onShift.length,
    users: onShift.map((s) => s.pubkey),
  })
})

calls.get('/history', requirePermission('calls:read-history'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)
  const filters = {
    ...(c.req.query('search') ? { search: c.req.query('search')! } : {}),
    ...(c.req.query('dateFrom') ? { dateFrom: c.req.query('dateFrom')! } : {}),
    ...(c.req.query('dateTo') ? { dateTo: c.req.query('dateTo')! } : {}),
    ...(c.req.query('voicemailOnly') === 'true' ? { voicemailOnly: true } : {}),
  }
  const result = await services.records.getCallHistory(page, limit, hubId, filters)
  return c.json(result)
})

// --- Call Detail ---

// Permission: admin (calls:read-history) or user who answered the call
calls.get('/:callId/detail', async (c) => {
  const callId = c.req.param('callId')
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const isAdmin = checkPermission(permissions, 'calls:read-history')

  const call = await services.records.getCallRecord(callId, hubId)
  if (!call) return c.json({ error: 'Call not found' }, 404)

  // Users can only view calls they answered (check active + metadata)
  if (!isAdmin) {
    const activeCall = await services.calls.getActiveCall(callId, hubId)
    // For archived calls, check by decrypted answeredBy — we can't do server-side,
    // so we allow the user to fetch and let client validate via E2EE decryption.
    // At minimum, if there's an active call that another user answered, deny.
    if (activeCall?.assignedPubkey && activeCall.assignedPubkey !== pubkey) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  // Fetch notes for this call (admin sees all, user sees own)
  const notesResult = await services.records.getNotes({
    callId,
    hubId: hubId ?? 'global',
    ...(!isAdmin ? { authorPubkey: pubkey } : {}),
  })

  // Fetch audit entries for this call (admin only)
  let auditEntries: AuditLogEntry[] = []
  if (isAdmin) {
    const auditResult = await services.records.getAuditLog({
      search: callId,
      page: 1,
      limit: 100,
      hubId: hubId ?? 'global',
    })
    auditEntries = auditResult.entries
  }

  return c.json({
    call,
    notes: notesResult.notes,
    auditEntries,
  })
})

// --- Call Actions (REST endpoints for WS→Nostr migration) ---

// Answer a ringing call (user)
calls.post('/:callId/answer', requirePermission('calls:answer'), async (c) => {
  const callId = c.req.param('callId')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')

  const body = await c.req
    .json<{ type?: 'phone' | 'browser' }>()
    .catch((): { type?: 'phone' | 'browser' } => ({}))
  const answerType = body.type

  const existing = await services.calls.getActiveCall(callId, hubId)
  if (!existing) return c.json({ error: 'Call not found' }, 404)
  if (existing.assignedPubkey) return c.json({ error: 'Call already answered' }, 409)

  const updated = await services.calls.updateActiveCall(
    callId,
    { assignedPubkey: pubkey, status: 'in-progress' },
    hubId
  )

  // Cancel other ringing legs (both in DB and via telephony adapter for phone legs)
  const phoneLegSidsToCancel = await services.calls.cancelOtherLegs(
    callId,
    hubId,
    pubkey,
    answerType
  )

  if (phoneLegSidsToCancel.length > 0) {
    const adapter = await getTelephony(services.settings, hubId, {
      TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: c.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: c.env.TWILIO_PHONE_NUMBER,
    })
    if (adapter) {
      await adapter.cancelRinging(phoneLegSidsToCancel)
    }
  }

  return c.json({ call: updated })
})

// Hang up an active call (user who answered it)
calls.post('/:callId/hangup', requirePermission('calls:answer'), async (c) => {
  const callId = c.req.param('callId')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')

  // Verify the user answered this call
  const call = await services.calls.getActiveCall(callId, hubId)
  if (!call) return c.json({ error: 'Call not found' }, 404)
  if (call.assignedPubkey !== pubkey) return c.json({ error: 'Not your call' }, 403)

  await services.calls.deleteActiveCall(callId, hubId)
  return c.json({ ok: true })
})

// Report a call as spam (user who answered it)
calls.post('/:callId/spam', requirePermission('calls:answer'), async (c) => {
  const callId = c.req.param('callId')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')

  // Verify the user answered this call
  const call = await services.calls.getActiveCall(callId, hubId)
  if (!call) return c.json({ error: 'Call not found' }, 404)
  if (call.assignedPubkey !== pubkey) return c.json({ error: 'Not your call' }, 403)

  await services.calls.updateActiveCall(
    callId,
    { status: 'spam', metadata: { ...call.metadata, reportedSpam: true, reportedBy: pubkey } },
    hubId
  )
  return c.json({ ok: true })
})

// Permission checked inside handler: admin (calls:read-recording) or assigned user
calls.get('/:callId/recording', async (c) => {
  const callId = c.req.param('callId')
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  // Fetch the call record to verify permission and get recordingSid
  const callRecord = await services.records.getCallRecord(callId, hubId)
  if (!callRecord) return c.json({ error: 'Call not found' }, 404)

  if (!callRecord.recordingSid || !callRecord.hasRecording) {
    return c.json({ error: 'No recording available for this call' }, 404)
  }

  // Permission check: admin (calls:read-recording) or the user who answered
  const isAdmin = checkPermission(permissions, 'calls:read-recording')
  // Note: answeredBy is in encrypted content; for permission check we use the active call's assignedPubkey
  // If the call record is archived, the metadata is encrypted — admin check is the safe fallback
  if (!isAdmin) {
    // Check active calls for current assignment
    const activeCall = await services.calls.getActiveCall(callId, hubId)
    const isAnsweringUser = activeCall?.assignedPubkey === pubkey
    if (!isAnsweringUser) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  // Fetch recording audio from the telephony provider on demand
  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: c.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: c.env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony provider not configured' }, 503)

  const audio = await adapter.getRecordingAudio(callRecord.recordingSid)
  if (!audio) return c.json({ error: 'Recording not available from provider' }, 404)

  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(audio.byteLength),
      'Cache-Control': 'private, no-store',
    },
  })
})

// Diagnostic endpoint
calls.get('/debug', requirePermission('calls:debug'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const activeCalls = await services.calls.getActiveCalls(hubId)
  const legs = await Promise.all(
    activeCalls.map((call) => services.calls.getCallLegs(call.callSid, hubId))
  )
  return c.json({ activeCalls, legs: legs.flat() })
})

export default calls
