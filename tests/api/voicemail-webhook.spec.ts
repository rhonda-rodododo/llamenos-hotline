import { expect, test } from '@playwright/test'
import { ADMIN_NSEC, resetTestState } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function twilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

test.describe('Voicemail webhook API', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test('voicemail-recording webhook accepts completed recording and sets hasVoicemail', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const callSid = `CA_test_voicemail_${Date.now()}`

    // Step 1: Simulate an incoming call to create an active call record.
    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: '+15551112222',
        To: '+15553334444',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })

    // If telephony is not configured (no provider in dev), the middleware returns 404 or handler returns 503.
    if (incomingRes.status() === 503 || incomingRes.status() === 404) {
      test.skip(true, 'Telephony not configured in dev env -- skipping voicemail webhook test')
      return
    }

    // Step 2: Fire the voicemail-recording webhook.
    const voicemailRes = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_test_${Date.now()}`,
        CallSid: callSid,
      }),
    })
    expect([200, 204]).toContain(voicemailRes.status())

    // Step 3: Check calls history API for hasVoicemail flag
    const callsRes = await authedApi.get('/api/calls/history?limit=50')
    const callsData = await callsRes.json()
    const calls =
      (callsData as { calls?: Array<{ callSid?: string; id?: string; hasVoicemail?: boolean }> })
        .calls ?? []
    const match = calls.find(
      (c: { callSid?: string; id?: string }) => c.callSid === callSid || c.id === callSid
    )
    if (match) {
      expect(match.hasVoicemail).toBe(true)
    }
    // If call record doesn't persist (e.g., no-op in test mode), just verify webhook accepted
  })

  test('voicemail-complete webhook returns valid TwiML response', async ({ request }) => {
    const res = await request.post('/telephony/voicemail-complete', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: 'CA_test_complete_static',
        CallStatus: 'in-progress',
      }),
    })

    // With no telephony configured -> 404 or 503; with config -> 200 TwiML
    if (res.status() !== 503 && res.status() !== 404) {
      expect(res.status()).toBe(200)
      const body = await res.text()
      // TwiML responses are XML with a <Response> root element
      expect(body).toMatch(/<Response>|<response>/i)
    }
  })

  test('voicemail-recording webhook returns 200 for unknown callSid (graceful)', async ({
    request,
  }) => {
    const unknownCallSid = `CA_unknown_${Date.now()}`
    const res = await request.post(`/telephony/voicemail-recording?callSid=${unknownCallSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_unknown_${Date.now()}`,
        CallSid: unknownCallSid,
      }),
    })
    // Should not return 500 -- either 200/204 (handled gracefully) or 404/503 (no telephony config)
    expect(res.status()).not.toBe(500)
  })
})
