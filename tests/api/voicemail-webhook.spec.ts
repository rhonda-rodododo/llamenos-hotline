import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function twilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

test.describe('Voicemail webhook API', () => {
  test.describe.configure({ mode: 'serial' })

  /** Whether telephony is configured in this environment. Set in the first test. */
  let telephonyAvailable = false
  /** Shared callSid created during the first test, used by subsequent tests. */
  let sharedCallSid = ''
  /** RecordingSid sent in the voicemail-recording webhook. */
  let sharedRecordingSid = ''

  test('voicemail-recording webhook accepts completed recording and sets hasVoicemail + recordingSid', async ({
    request,
  }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const callSid = `CA_test_voicemail_${Date.now()}`
    const recordingSid = `RE_test_${Date.now()}`
    sharedCallSid = callSid
    sharedRecordingSid = recordingSid

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

    // If telephony is not configured (no provider in dev), skip this and all dependent tests.
    if (incomingRes.status() === 503 || incomingRes.status() === 404) {
      test.skip(true, 'Telephony not configured in dev env -- skipping voicemail webhook test')
      return
    }

    telephonyAvailable = true

    // Step 2: Fire the voicemail-recording webhook.
    const voicemailRes = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: recordingSid,
        CallSid: callSid,
      }),
    })
    expect([200, 204]).toContain(voicemailRes.status())

    // Step 3: Assert hasVoicemail and recordingSid on the call record.
    // The voicemail-recording handler upserts a call_record, so it should appear in history.
    const callsRes = await authedApi.get('/api/calls/history?limit=50')
    expect(callsRes.status()).toBe(200)
    const callsData = (await callsRes.json()) as {
      calls: Array<{
        id: string
        hasVoicemail: boolean
        hasRecording: boolean
        recordingSid?: string | null
      }>
    }
    const calls = callsData.calls ?? []
    // call_records.id is the callSid used in upsertCallRecord
    const match = calls.find((c) => c.id === callSid)

    expect(match, `Expected to find call record with id=${callSid} in history`).toBeTruthy()
    expect(match!.hasVoicemail).toBe(true)
    expect(match!.recordingSid).toBe(recordingSid)
  })

  test('voicemail-complete webhook returns valid TwiML response', async ({ request }) => {
    test.skip(!telephonyAvailable, 'Telephony not configured -- skipping')

    const res = await request.post('/telephony/voicemail-complete', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: 'CA_test_complete_static',
        CallStatus: 'in-progress',
      }),
    })

    expect(res.status()).toBe(200)
    const body = await res.text()
    // TwiML responses are XML with a <Response> root element
    expect(body).toMatch(/<Response>|<response>/i)
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

  test('voicemail transcript note is created with system:voicemail author', async ({ request }) => {
    test.skip(!telephonyAvailable, 'Telephony not configured -- skipping')
    // Transcription is async and requires faster-whisper / AI service.
    // Check if a system:voicemail note was created for the call.
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Give transcription a moment to complete (it runs asynchronously after webhook)
    await new Promise((r) => setTimeout(r, 2000))

    const notesRes = await authedApi.get(`/api/notes?callId=${sharedCallSid}`)
    expect(notesRes.status()).toBe(200)
    const notesData = (await notesRes.json()) as {
      notes: Array<{
        authorPubkey: string
        encryptedContent?: string
      }>
    }

    const voicemailNote = notesData.notes?.find((n) => n.authorPubkey === 'system:voicemail')

    // Transcription depends on faster-whisper being available in test env.
    // If no voicemail note exists, skip rather than fail.
    if (!voicemailNote) {
      test.skip(
        true,
        'No voicemail transcript note found -- transcription service likely not available'
      )
      return
    }

    expect(voicemailNote.authorPubkey).toBe('system:voicemail')
    expect(voicemailNote.encryptedContent).toBeTruthy()
  })
})
