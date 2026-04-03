import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  decodeTelnyxClientState,
  encodeTelnyxClientState,
} from '../../shared/schemas/external/telnyx-voice'
import { TelnyxAdapter } from './telnyx'

// --- Helpers ---

const originalFetch = globalThis.fetch

/** Track all fetch calls for assertion */
let fetchCalls: Array<{ url: string; method: string; body?: string }> = []

function mockFetchWith(
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  fetchCalls = []
  const defaultHandler = (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: {} }), { status: 200 })

  globalThis.fetch = mock(((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const method = init?.method ?? 'GET'
    const body = init?.body ? String(init.body) : undefined
    fetchCalls.push({ url: urlStr, method, body })
    return (handler ?? defaultHandler)(urlStr, init)
  }) as typeof fetch) as unknown as typeof fetch
}

function createAdapter() {
  return new TelnyxAdapter('test-api-key', 'test-connection-id', '+15551234567')
}

/** Build a Telnyx webhook event body */
function makeWebhookEvent(
  eventType: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    data: {
      record_type: 'event',
      event_type: eventType,
      id: 'evt_test_123',
      occurred_at: '2026-04-03T12:00:00Z',
      payload,
    },
  }
}

/** Build a Request from a webhook event body */
function webhookRequest(event: Record<string, unknown>): Request {
  return new Request('http://localhost/telephony/incoming', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
  fetchCalls = []
})

// =====================================================================
// Client State Encoding/Decoding
// =====================================================================

describe('TelnyxClientState', () => {
  test('encodes and decodes round-trip', () => {
    const state = { hubId: 'hub-1', lang: 'es', callSid: 'cc-123', phase: 'captcha' as const }
    const encoded = encodeTelnyxClientState(state)
    const decoded = decodeTelnyxClientState(encoded)
    expect(decoded).toEqual(state)
  })

  test('decodes gracefully on bad input', () => {
    const decoded = decodeTelnyxClientState('not-valid-base64!!!')
    expect(decoded.lang).toBe('en')
    expect(decoded.callSid).toBe('')
  })

  test('encodes to base64 string', () => {
    const state = { lang: 'en', callSid: 'test' }
    const encoded = encodeTelnyxClientState(state)
    // Verify it's valid base64
    expect(() => atob(encoded)).not.toThrow()
  })
})

// =====================================================================
// handleLanguageMenu
// =====================================================================

describe('TelnyxAdapter.handleLanguageMenu', () => {
  test('answers call and sends gather for language menu', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    const result = await adapter.handleLanguageMenu({
      callSid: 'cc-123',
      callerNumber: '+14155551234',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en', 'es', 'fr'],
    })

    // Should return empty response
    expect(result.contentType).toBe('application/json')
    expect(result.body).toBe('{}')

    // Should have called answer + gather_using_speak
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/answer')
    expect(fetchCalls[1].url).toContain('/actions/gather_using_speak')
  })

  test('skips menu when only one language enabled', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleLanguageMenu({
      callSid: 'cc-123',
      callerNumber: '+14155551234',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en'],
    })

    // answer + speak (skip menu)
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/answer')
    expect(fetchCalls[1].url).toContain('/actions/speak')
  })

  test('includes hubId in client_state', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleLanguageMenu({
      callSid: 'cc-123',
      callerNumber: '+14155551234',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en', 'es'],
      hubId: 'hub-abc',
    })

    // Verify answer call includes client_state with hubId
    const answerBody = JSON.parse(fetchCalls[0].body!)
    const decoded = decodeTelnyxClientState(answerBody.client_state)
    expect(decoded.hubId).toBe('hub-abc')
  })
})

// =====================================================================
// handleIncomingCall
// =====================================================================

describe('TelnyxAdapter.handleIncomingCall', () => {
  test('rate limited caller gets spoken message and hangup', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    const result = await adapter.handleIncomingCall({
      callSid: 'cc-123',
      callerNumber: '+14155551234',
      voiceCaptchaEnabled: false,
      rateLimited: true,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
    })

    expect(result.body).toBe('{}')
    // speak + hangup
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/speak')
    expect(fetchCalls[1].url).toContain('/actions/hangup')
  })

  test('CAPTCHA enabled sends greeting then gather', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleIncomingCall({
      callSid: 'cc-123',
      callerNumber: '+14155551234',
      voiceCaptchaEnabled: true,
      rateLimited: false,
      callerLanguage: 'es',
      hotlineName: 'Test Hotline',
      captchaDigits: '4821',
    })

    // speak (greeting) + gather_using_speak (captcha)
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/speak')
    expect(fetchCalls[1].url).toContain('/actions/gather_using_speak')

    // Verify captcha state is set
    const gatherBody = JSON.parse(fetchCalls[1].body!)
    const decoded = decodeTelnyxClientState(gatherBody.client_state)
    expect(decoded.phase).toBe('captcha')
    expect(decoded.lang).toBe('es')
  })

  test('no CAPTCHA plays greeting, hold message, and hold music', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleIncomingCall({
      callSid: 'cc-123',
      callerNumber: '+14155551234',
      voiceCaptchaEnabled: false,
      rateLimited: false,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
    })

    // speak (greeting + hold) + playback_start (hold music)
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/speak')
    expect(fetchCalls[1].url).toContain('/actions/playback_start')

    // Verify queue state
    const playbackBody = JSON.parse(fetchCalls[1].body!)
    const decoded = decodeTelnyxClientState(playbackBody.client_state)
    expect(decoded.phase).toBe('queue')
  })
})

// =====================================================================
// handleCaptchaResponse
// =====================================================================

describe('TelnyxAdapter.handleCaptchaResponse', () => {
  test('correct digits plays success and starts hold music', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleCaptchaResponse({
      callSid: 'cc-123',
      digits: '4821',
      expectedDigits: '4821',
      callerLanguage: 'en',
    })

    // speak (success) + playback_start (hold music)
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/speak')
    expect(fetchCalls[1].url).toContain('/actions/playback_start')
  })

  test('wrong digits with retries sends new gather', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleCaptchaResponse({
      callSid: 'cc-123',
      digits: '0000',
      expectedDigits: '4821',
      callerLanguage: 'en',
      remainingAttempts: 2,
      newCaptchaDigits: '9753',
    })

    // gather_using_speak (retry)
    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0].url).toContain('/actions/gather_using_speak')

    const body = JSON.parse(fetchCalls[0].body!)
    expect(body.payload).toContain('9, 7, 5, 3')
  })

  test('wrong digits with no retries plays fail and hangup', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleCaptchaResponse({
      callSid: 'cc-123',
      digits: '0000',
      expectedDigits: '4821',
      callerLanguage: 'en',
      remainingAttempts: 0,
    })

    // speak (fail) + hangup
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/speak')
    expect(fetchCalls[1].url).toContain('/actions/hangup')
  })
})

// =====================================================================
// handleCallAnswered
// =====================================================================

describe('TelnyxAdapter.handleCallAnswered', () => {
  test('bridges caller and volunteer and starts recording', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleCallAnswered({
      parentCallSid: 'cc-caller',
      callbackUrl: 'https://example.com',
      userPubkey: 'pub123',
      hubId: 'hub-1',
    })

    // bridge + record_start
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/bridge')
    expect(fetchCalls[1].url).toContain('/actions/record_start')
  })
})

// =====================================================================
// handleVoicemail
// =====================================================================

describe('TelnyxAdapter.handleVoicemail', () => {
  test('speaks voicemail prompt and starts recording', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleVoicemail({
      callSid: 'cc-123',
      callerLanguage: 'en',
      callbackUrl: 'https://example.com',
    })

    // speak (voicemail prompt) + record_start
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0].url).toContain('/actions/speak')
    expect(fetchCalls[1].url).toContain('/actions/record_start')

    const recordBody = JSON.parse(fetchCalls[1].body!)
    expect(recordBody.format).toBe('mp3')
    expect(recordBody.play_beep).toBe(true)
  })

  test('uses custom max recording seconds', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.handleVoicemail({
      callSid: 'cc-123',
      callerLanguage: 'en',
      callbackUrl: 'https://example.com',
      maxRecordingSeconds: 60,
    })

    const recordBody = JSON.parse(fetchCalls[1].body!)
    expect(recordBody.max_length_secs).toBe(60)
  })
})

// =====================================================================
// handleWaitMusic
// =====================================================================

describe('TelnyxAdapter.handleWaitMusic', () => {
  test('returns leave signal when queue timeout exceeded', async () => {
    const adapter = createAdapter()
    const result = await adapter.handleWaitMusic('en', undefined, 100, 90)
    const body = JSON.parse(result.body)
    expect(body.leave).toBe(true)
  })

  test('returns empty response when still in queue', async () => {
    const adapter = createAdapter()
    const result = await adapter.handleWaitMusic('en', undefined, 30, 90)
    expect(result.body).toBe('{}')
  })

  test('uses default timeout of 90 seconds', async () => {
    const adapter = createAdapter()
    const result = await adapter.handleWaitMusic('en', undefined, 91)
    const body = JSON.parse(result.body)
    expect(body.leave).toBe(true)
  })
})

// =====================================================================
// Sync response methods
// =====================================================================

describe('TelnyxAdapter sync methods', () => {
  test('handleVoicemailComplete returns empty response', () => {
    const adapter = createAdapter()
    const result = adapter.handleVoicemailComplete('en')
    expect(result.contentType).toBe('application/json')
    expect(result.body).toBe('{}')
  })

  test('handleUnavailable returns empty response', () => {
    const adapter = createAdapter()
    const result = adapter.handleUnavailable('en')
    expect(result.contentType).toBe('application/json')
    expect(result.body).toBe('{}')
  })

  test('rejectCall returns empty response', () => {
    const adapter = createAdapter()
    const result = adapter.rejectCall()
    expect(result.contentType).toBe('application/json')
    expect(result.body).toBe('{}')
  })

  test('emptyResponse returns empty JSON', () => {
    const adapter = createAdapter()
    const result = adapter.emptyResponse()
    expect(result.contentType).toBe('application/json')
    expect(result.body).toBe('{}')
  })
})

// =====================================================================
// hangupCall
// =====================================================================

describe('TelnyxAdapter.hangupCall', () => {
  test('sends hangup command', async () => {
    mockFetchWith()
    const adapter = createAdapter()
    await adapter.hangupCall('cc-123')

    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0].url).toContain('/cc-123/actions/hangup')
    expect(fetchCalls[0].method).toBe('POST')
  })
})

// =====================================================================
// ringUsers
// =====================================================================

describe('TelnyxAdapter.ringUsers', () => {
  test('creates outbound calls for each volunteer with phone', async () => {
    mockFetchWith((_url, init) => {
      if (init?.method === 'POST' && _url.endsWith('/v2/calls')) {
        return new Response(
          JSON.stringify({
            data: {
              call_control_id: `cc-${Math.random().toString(36).slice(2, 8)}`,
              call_leg_id: 'leg-1',
              call_session_id: 'session-1',
            },
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    })
    const adapter = createAdapter()

    const sids = await adapter.ringUsers({
      callSid: 'cc-caller',
      callerNumber: '+14155551234',
      volunteers: [
        { pubkey: 'pub1', phone: '+14155559999' },
        { pubkey: 'pub2', phone: '+14155558888' },
        { pubkey: 'pub3' }, // no phone — should be skipped
      ],
      callbackUrl: 'https://example.com',
      hubId: 'hub-1',
    })

    // Two calls created (pub3 has no phone)
    expect(sids.length).toBe(2)

    // Verify outbound call details
    const createCalls = fetchCalls.filter((c) => c.url.endsWith('/v2/calls'))
    expect(createCalls.length).toBe(2)

    const firstCallBody = JSON.parse(createCalls[0].body!)
    expect(firstCallBody.from).toBe('+15551234567')
    expect(firstCallBody.connection_id).toBe('test-connection-id')
    expect(firstCallBody.timeout_secs).toBe(30)
    expect(firstCallBody.webhook_url).toContain('parentCallSid=cc-caller')
    expect(firstCallBody.webhook_url).toContain('hub=hub-1')
  })

  test('handles API failures gracefully', async () => {
    let callCount = 0
    mockFetchWith((_url, init) => {
      if (init?.method === 'POST' && _url.endsWith('/v2/calls')) {
        callCount++
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              data: {
                call_control_id: 'cc-success',
                call_leg_id: 'leg-1',
                call_session_id: 'session-1',
              },
            }),
            { status: 200 }
          )
        }
        // Second call fails
        return new Response('Server Error', { status: 500 })
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    })
    const adapter = createAdapter()

    const sids = await adapter.ringUsers({
      callSid: 'cc-caller',
      callerNumber: '+14155551234',
      volunteers: [
        { pubkey: 'pub1', phone: '+14155559999' },
        { pubkey: 'pub2', phone: '+14155558888' },
      ],
      callbackUrl: 'https://example.com',
    })

    // Only one succeeded
    expect(sids.length).toBe(1)
    expect(sids[0]).toBe('cc-success')
  })
})

// =====================================================================
// cancelRinging
// =====================================================================

describe('TelnyxAdapter.cancelRinging', () => {
  test('hangs up all except the specified SID', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.cancelRinging(['cc-1', 'cc-2', 'cc-3'], 'cc-2')

    // Should hangup cc-1 and cc-3, not cc-2
    const hangupCalls = fetchCalls.filter((c) => c.url.includes('/actions/hangup'))
    expect(hangupCalls.length).toBe(2)
    expect(hangupCalls.some((c) => c.url.includes('/cc-1/'))).toBe(true)
    expect(hangupCalls.some((c) => c.url.includes('/cc-3/'))).toBe(true)
    expect(hangupCalls.some((c) => c.url.includes('/cc-2/'))).toBe(false)
  })

  test('hangs up all when no exceptSid given', async () => {
    mockFetchWith()
    const adapter = createAdapter()

    await adapter.cancelRinging(['cc-1', 'cc-2'])

    const hangupCalls = fetchCalls.filter((c) => c.url.includes('/actions/hangup'))
    expect(hangupCalls.length).toBe(2)
  })
})

// =====================================================================
// Webhook Parsing — parseIncomingWebhook
// =====================================================================

describe('TelnyxAdapter.parseIncomingWebhook', () => {
  test('extracts call info from call.initiated event', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.initiated', {
      call_control_id: 'cc-456',
      connection_id: 'conn-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+14155551234',
      to: '+15551234567',
      direction: 'incoming',
      state: 'ringing',
    })

    const result = await adapter.parseIncomingWebhook(webhookRequest(event))
    expect(result.callSid).toBe('cc-456')
    expect(result.callerNumber).toBe('+14155551234')
    expect(result.calledNumber).toBe('+15551234567')
  })
})

// =====================================================================
// Webhook Parsing — parseLanguageWebhook
// =====================================================================

describe('TelnyxAdapter.parseLanguageWebhook', () => {
  test('extracts digits from call.gather.ended event', async () => {
    const adapter = createAdapter()
    const clientState = encodeTelnyxClientState({
      lang: 'en',
      callSid: 'cc-789',
      phase: 'language',
    })
    const event = makeWebhookEvent('call.gather.ended', {
      call_control_id: 'cc-789',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+14155551234',
      to: '+15551234567',
      digits: '2',
      status: 'valid',
      client_state: clientState,
    })

    const result = await adapter.parseLanguageWebhook(webhookRequest(event))
    expect(result.callSid).toBe('cc-789')
    expect(result.callerNumber).toBe('+14155551234')
    expect(result.digits).toBe('2')
  })
})

// =====================================================================
// Webhook Parsing — parseCaptchaWebhook
// =====================================================================

describe('TelnyxAdapter.parseCaptchaWebhook', () => {
  test('extracts digits and caller number', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.gather.ended', {
      call_control_id: 'cc-101',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+14155551234',
      to: '+15551234567',
      digits: '4821',
      status: 'valid',
    })

    const result = await adapter.parseCaptchaWebhook(webhookRequest(event))
    expect(result.digits).toBe('4821')
    expect(result.callerNumber).toBe('+14155551234')
  })
})

// =====================================================================
// Webhook Parsing — parseCallStatusWebhook
// =====================================================================

describe('TelnyxAdapter.parseCallStatusWebhook', () => {
  test('maps call.initiated to initiated status', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.initiated', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+1',
      to: '+2',
      direction: 'incoming',
      state: 'ringing',
    })
    const result = await adapter.parseCallStatusWebhook(webhookRequest(event))
    expect(result.status).toBe('initiated')
  })

  test('maps call.answered to answered status', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.answered', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+1',
      to: '+2',
      direction: 'incoming',
      state: 'answered',
    })
    const result = await adapter.parseCallStatusWebhook(webhookRequest(event))
    expect(result.status).toBe('answered')
  })

  test('maps call.hangup normal_clearing to completed', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.hangup', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+1',
      to: '+2',
      hangup_cause: 'normal_clearing',
    })
    const result = await adapter.parseCallStatusWebhook(webhookRequest(event))
    expect(result.status).toBe('completed')
  })

  test('maps call.hangup busy to busy', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.hangup', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+1',
      to: '+2',
      hangup_cause: 'busy',
    })
    const result = await adapter.parseCallStatusWebhook(webhookRequest(event))
    expect(result.status).toBe('busy')
  })

  test('maps call.hangup timeout to no-answer', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.hangup', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+1',
      to: '+2',
      hangup_cause: 'timeout',
    })
    const result = await adapter.parseCallStatusWebhook(webhookRequest(event))
    expect(result.status).toBe('no-answer')
  })
})

// =====================================================================
// Webhook Parsing — parseQueueExitWebhook
// =====================================================================

describe('TelnyxAdapter.parseQueueExitWebhook', () => {
  test('maps call.bridged to bridged', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.bridged', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
    })
    const result = await adapter.parseQueueExitWebhook(webhookRequest(event))
    expect(result.result).toBe('bridged')
  })

  test('maps call.hangup normal_clearing to hangup', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.hangup', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      from: '+1',
      to: '+2',
      hangup_cause: 'normal_clearing',
    })
    const result = await adapter.parseQueueExitWebhook(webhookRequest(event))
    expect(result.result).toBe('hangup')
  })
})

// =====================================================================
// Webhook Parsing — parseRecordingWebhook
// =====================================================================

describe('TelnyxAdapter.parseRecordingWebhook', () => {
  test('extracts recording URL from call.recording.saved', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.recording.saved', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
      recording_urls: {
        mp3: 'https://api.telnyx.com/v2/recordings/rec-123/mp3',
        wav: 'https://api.telnyx.com/v2/recordings/rec-123/wav',
      },
    })

    const result = await adapter.parseRecordingWebhook(webhookRequest(event))
    expect(result.status).toBe('completed')
    expect(result.recordingSid).toBe('https://api.telnyx.com/v2/recordings/rec-123/mp3')
    expect(result.callSid).toBe('cc-1')
  })

  test('returns failed when no recording URLs', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.recording.saved', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
    })

    const result = await adapter.parseRecordingWebhook(webhookRequest(event))
    expect(result.status).toBe('failed')
  })
})

// =====================================================================
// Webhook Parsing — parseQueueWaitWebhook
// =====================================================================

describe('TelnyxAdapter.parseQueueWaitWebhook', () => {
  test('returns queueTime 0 (tracked externally)', async () => {
    const adapter = createAdapter()
    const event = makeWebhookEvent('call.speak.ended', {
      call_control_id: 'cc-1',
      call_leg_id: 'leg-1',
      call_session_id: 'sess-1',
    })

    const result = await adapter.parseQueueWaitWebhook(webhookRequest(event))
    expect(result.queueTime).toBe(0)
  })
})

// =====================================================================
// validateWebhook
// =====================================================================

describe('TelnyxAdapter.validateWebhook', () => {
  test('rejects when signature header is missing', async () => {
    const adapter = createAdapter()
    const req = new Request('http://localhost/telephony/incoming', {
      method: 'POST',
      body: '{}',
    })

    const valid = await adapter.validateWebhook(req)
    expect(valid).toBe(false)
  })

  test('rejects when timestamp header is missing', async () => {
    const adapter = createAdapter()
    const req = new Request('http://localhost/telephony/incoming', {
      method: 'POST',
      headers: {
        'telnyx-signature-ed25519': 'abc123',
      },
      body: '{}',
    })

    const valid = await adapter.validateWebhook(req)
    expect(valid).toBe(false)
  })

  test('rejects when timestamp is too old', async () => {
    const adapter = createAdapter()
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600) // 10 minutes ago
    const req = new Request('http://localhost/telephony/incoming', {
      method: 'POST',
      headers: {
        'telnyx-signature-ed25519': 'abc123',
        'telnyx-timestamp': oldTimestamp,
      },
      body: '{}',
    })

    const valid = await adapter.validateWebhook(req)
    expect(valid).toBe(false)
  })
})

// =====================================================================
// Recording methods
// =====================================================================

describe('TelnyxAdapter recording methods', () => {
  test('getRecordingAudio fetches from URL', async () => {
    const audioData = new Uint8Array([1, 2, 3, 4])
    mockFetchWith((url) => {
      if (url.includes('recording')) {
        return new Response(audioData, { status: 200 })
      }
      return new Response('', { status: 404 })
    })
    const adapter = createAdapter()

    const result = await adapter.getRecordingAudio('https://api.telnyx.com/v2/recordings/rec-1/mp3')
    expect(result).not.toBeNull()
    expect(new Uint8Array(result!)).toEqual(audioData)
  })

  test('getRecordingAudio returns null on error', async () => {
    mockFetchWith(() => new Response('', { status: 500 }))
    const adapter = createAdapter()

    const result = await adapter.getRecordingAudio('https://api.telnyx.com/v2/recordings/rec-1/mp3')
    expect(result).toBeNull()
  })

  test('deleteRecording calls DELETE API', async () => {
    mockFetchWith(() => new Response('', { status: 200 }))
    const adapter = createAdapter()

    await adapter.deleteRecording('rec-123')

    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0].method).toBe('DELETE')
    expect(fetchCalls[0].url).toContain('/recordings/rec-123')
  })

  test('getCallRecording returns null (not yet implemented)', async () => {
    const adapter = createAdapter()
    const result = await adapter.getCallRecording('cc-123')
    expect(result).toBeNull()
  })
})

// =====================================================================
// testConnection
// =====================================================================

describe('TelnyxAdapter.testConnection', () => {
  test('delegates to telnyx capabilities', async () => {
    mockFetchWith((url) => {
      if (url.includes('/v2/texml_applications')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      return new Response('', { status: 404 })
    })
    const adapter = createAdapter()

    const result = await adapter.testConnection()
    expect(result.connected).toBe(true)
  })
})

// =====================================================================
// verifyWebhookConfig
// =====================================================================

describe('TelnyxAdapter.verifyWebhookConfig', () => {
  test('returns warning when no connectionId', async () => {
    const adapter = new TelnyxAdapter('test-key', '', '+15551234567')
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(false)
    expect(result.warning).toContain('not configured')
  })

  test('returns configured=true when webhook URL matches', async () => {
    mockFetchWith((url) => {
      if (url.includes('/call_control_applications/')) {
        return new Response(
          JSON.stringify({
            data: {
              webhook_event_url: 'https://example.com/telephony/incoming',
            },
          }),
          { status: 200 }
        )
      }
      return new Response('', { status: 404 })
    })
    const adapter = createAdapter()

    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')
    expect(result.configured).toBe(true)
    expect(result.expectedUrl).toBe('https://example.com/telephony/incoming')
  })

  test('returns configured=false when webhook URL does not match', async () => {
    mockFetchWith((url) => {
      if (url.includes('/call_control_applications/')) {
        return new Response(
          JSON.stringify({
            data: {
              webhook_event_url: 'https://other.com/telephony/incoming',
            },
          }),
          { status: 200 }
        )
      }
      return new Response('', { status: 404 })
    })
    const adapter = createAdapter()

    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')
    expect(result.configured).toBe(false)
    expect(result.actualUrl).toBe('https://other.com/telephony/incoming')
    expect(result.warning).toContain('does not point')
  })

  test('handles API errors gracefully', async () => {
    mockFetchWith(() => new Response('', { status: 500 }))
    const adapter = createAdapter()

    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')
    expect(result.configured).toBe(false)
    expect(result.warning).toContain('not found')
  })
})

// =====================================================================
// TelnyxCallControlClient error handling
// =====================================================================

describe('TelnyxCallControlClient error handling', () => {
  test('command throws AppError on API failure', async () => {
    mockFetchWith(() => new Response('Bad Request', { status: 400 }))
    const adapter = createAdapter()

    await expect(adapter.hangupCall('cc-123')).rejects.toThrow('Telnyx API error')
  })

  test('ringUsers returns empty array when all calls fail', async () => {
    mockFetchWith(() => new Response('Server Error', { status: 500 }))
    const adapter = createAdapter()

    const sids = await adapter.ringUsers({
      callSid: 'cc-caller',
      callerNumber: '+14155551234',
      volunteers: [{ pubkey: 'pub1', phone: '+14155559999' }],
      callbackUrl: 'https://example.com',
    })

    expect(sids.length).toBe(0)
  })
})
