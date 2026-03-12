import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { AppEnv, CallRecord } from '../types'
import { getScopedDOs, getTelephony } from '../lib/do-access'
import { audit } from '../services/audit'
import { requirePermission, checkPermission } from '../middleware/permission-guard'
import { callHistoryQuerySchema, callRecordResponseSchema } from '../schemas/calls'
import { okResponseSchema, paginatedMeta } from '../schemas/common'
import { authErrors, notFoundError } from '../openapi/helpers'

const calls = new Hono<AppEnv>()

calls.get('/active',
  describeRoute({
    tags: ['Calls'],
    summary: 'List active calls',
    responses: {
      200: { description: 'Active calls' },
      ...authErrors,
    },
  }),
  requirePermission('calls:read-active'),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const permissions = c.get('permissions')
    const canSeeFullInfo = checkPermission(permissions, 'calls:read-active-full')
    const res = await dos.calls.fetch(new Request('http://do/calls/active'))
    if (!canSeeFullInfo) {
      const data = await res.json() as { calls: Array<{ callerNumber: string; [key: string]: unknown }> }
      data.calls = data.calls.map(call => ({ ...call, callerNumber: '[redacted]' }))
      return c.json(data)
    }
    return res
  },
)

calls.get('/today-count',
  describeRoute({
    tags: ['Calls'],
    summary: 'Get today\'s call count',
    responses: {
      200: { description: 'Today\'s call count' },
      ...authErrors,
    },
  }),
  requirePermission('calls:read-active'),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    return dos.calls.fetch(new Request('http://do/calls/today-count'))
  },
)

calls.get('/presence',
  describeRoute({
    tags: ['Calls'],
    summary: 'Get call presence status',
    responses: {
      200: { description: 'Presence status' },
      ...authErrors,
    },
  }),
  requirePermission('calls:read-presence'),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    return dos.calls.fetch(new Request('http://do/calls/presence'))
  },
)

calls.get('/history',
  describeRoute({
    tags: ['Calls'],
    summary: 'Paginated call history',
    responses: {
      200: {
        description: 'Paginated call records',
        content: {
          'application/json': {
            schema: resolver(z.object({
              calls: z.array(callRecordResponseSchema),
              ...paginatedMeta,
            })),
          },
        },
      },
      ...authErrors,
    },
  }),
  requirePermission('calls:read-history'),
  validator('query', callHistoryQuerySchema),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const query = c.req.valid('query')

    const params = new URLSearchParams()
    params.set('page', String(query.page))
    params.set('limit', String(query.limit))
    // Cursor-based pagination (Epic 281)
    if (query.cursor) params.set('cursor', query.cursor)
    if (query.search) params.set('search', query.search)
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    return dos.calls.fetch(new Request(`http://do/calls/history?${params}`))
  },
)

// --- Call Actions (REST endpoints for WS→Nostr migration) ---

// Answer a ringing call (volunteer)
calls.post('/:callId/answer',
  describeRoute({
    tags: ['Calls'],
    summary: 'Answer a ringing call',
    responses: {
      200: { description: 'Call answered' },
      ...authErrors,
    },
  }),
  requirePermission('calls:answer'),
  async (c) => {
    const callId = c.req.param('callId')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    const res = await dos.calls.fetch(new Request(`http://do/calls/${callId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    }))

    if (res.status === 409) return c.json({ error: 'Call already answered' }, 409)
    if (!res.ok) return c.json({ error: 'Failed to answer call' }, 500)
    return res
  },
)

// Hang up an active call (volunteer who answered it)
calls.post('/:callId/hangup',
  describeRoute({
    tags: ['Calls'],
    summary: 'Hang up an active call',
    responses: {
      200: { description: 'Call hung up' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('calls:answer'),
  async (c) => {
    const callId = c.req.param('callId')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    // Verify the volunteer answered this call
    const callRes = await dos.calls.fetch(new Request(`http://do/calls/${callId}`))
    if (!callRes.ok) return c.json({ error: 'Call not found' }, 404)
    const { call } = await callRes.json() as { call: CallRecord }
    if (call.answeredBy !== pubkey) return c.json({ error: 'Not your call' }, 403)

    const res = await dos.calls.fetch(new Request(`http://do/calls/${callId}/end`, {
      method: 'POST',
    }))

    if (!res.ok) return c.json({ error: 'Failed to hang up call' }, 500)
    return res
  },
)

// Report a call as spam (volunteer who answered it)
calls.post('/:callId/spam',
  describeRoute({
    tags: ['Calls'],
    summary: 'Report a call as spam',
    responses: {
      200: { description: 'Call reported as spam' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('calls:answer'),
  async (c) => {
    const callId = c.req.param('callId')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    // Verify the volunteer answered this call
    const callRes = await dos.calls.fetch(new Request(`http://do/calls/${callId}`))
    if (!callRes.ok) return c.json({ error: 'Call not found' }, 404)
    const { call } = await callRes.json() as { call: CallRecord }
    if (call.answeredBy !== pubkey) return c.json({ error: 'Not your call' }, 403)

    const res = await dos.calls.fetch(new Request(`http://do/calls/${callId}/spam`, {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    }))

    if (!res.ok) return c.json({ error: 'Failed to report spam' }, 500)
    return res
  },
)

// Ban caller and hang up — server resolves phone number (volunteer never sees it)
calls.post('/:callId/ban',
  describeRoute({
    tags: ['Calls'],
    summary: 'Ban the caller and hang up',
    responses: {
      200: { description: 'Caller banned and call ended' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  requirePermission('bans:report'),
  async (c) => {
    const callId = c.req.param('callId')
    const pubkey = c.get('pubkey')
    const dos = getScopedDOs(c.env, c.get('hubId'))

    // Get call record to verify ownership and extract caller phone
    const callRes = await dos.calls.fetch(new Request(`http://do/calls/${callId}`))
    if (!callRes.ok) return c.json({ error: 'Call not found' }, 404)
    const { call } = await callRes.json() as { call: CallRecord }

    if (call.answeredBy !== pubkey) {
      return c.json({ error: 'Not your call' }, 403)
    }

    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }))

    // Ban the caller (server resolves phone number — volunteer never sees it)
    const banRes = await dos.records.fetch(new Request('http://do/bans', {
      method: 'POST',
      body: JSON.stringify({
        phone: call.callerNumber,
        reason: body.reason || 'Banned during active call',
        bannedBy: pubkey,
      }),
    }))

    // Hang up the call
    await dos.calls.fetch(new Request(`http://do/calls/${callId}/end`, {
      method: 'POST',
    }))

    if (banRes.ok) {
      await audit(dos.records, 'numberBanned', pubkey, { phone: call.callerNumber, callId })
    }

    return c.json({ banned: banRes.ok, hungUp: true })
  },
)

// Recording playback — admin or answering volunteer
calls.get('/:callId/recording',
  describeRoute({
    tags: ['Calls'],
    summary: 'Get call recording audio',
    responses: {
      200: { description: 'Audio WAV file' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const callId = c.req.param('callId')
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const permissions = c.get('permissions')
    const pubkey = c.get('pubkey')

    // Fetch the call record to verify permission and get recordingSid
    const callRes = await dos.calls.fetch(new Request(`http://do/calls/${callId}`))
    if (!callRes.ok) return c.json({ error: 'Call not found' }, 404)
    const { call } = await callRes.json() as { call: CallRecord }

    if (!call.recordingSid || !call.hasRecording) {
      return c.json({ error: 'No recording available for this call' }, 404)
    }

    // Permission check: admin (calls:read-recording) or the volunteer who answered
    const isAdmin = checkPermission(permissions, 'calls:read-recording')
    const isAnsweringVolunteer = call.answeredBy === pubkey
    if (!isAdmin && !isAnsweringVolunteer) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    // Fetch recording audio from the telephony provider on demand
    const adapter = await getTelephony(c.env, dos)
    if (!adapter) return c.json({ error: 'Telephony provider not configured' }, 503)

    const audio = await adapter.getRecordingAudio(call.recordingSid)
    if (!audio) return c.json({ error: 'Recording not available from provider' }, 404)

    return new Response(audio, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'private, no-store',
      },
    })
  },
)

// Diagnostic endpoint
calls.get('/debug',
  describeRoute({
    tags: ['Calls'],
    summary: 'Debug call routing state',
    responses: {
      200: { description: 'Debug information' },
      ...authErrors,
    },
  }),
  requirePermission('calls:debug'),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const res = await dos.calls.fetch(new Request('http://do/calls/debug'))
    return res
  },
)

export default calls
