import { type APIRequestContext, expect, test } from '@playwright/test'
import { ADMIN_NSEC, resetTestState } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function twilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

test.describe('Voicemail mode routing', () => {
  test.describe.configure({ mode: 'serial' })

  let telephonyAvailable = false

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  /**
   * Helper: set voicemailMode via the settings API.
   */
  async function setVoicemailMode(request: APIRequestContext, mode: 'auto' | 'always' | 'never') {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.patch('/api/settings/call', { voicemailMode: mode })
    expect(res.status()).toBe(200)
  }

  /**
   * Helper: simulate a language-selected webhook (step 2 of the call flow).
   * Returns the TwiML response body.
   */
  async function simulateLanguageSelected(
    request: APIRequestContext,
    callSid: string,
    callerNumber = '+15559990001'
  ): Promise<{ status: number; body: string }> {
    // First hit /incoming to establish the call
    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: callerNumber,
        To: '+15553334444',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })

    if (incomingRes.status() === 503 || incomingRes.status() === 404) {
      return { status: incomingRes.status(), body: '' }
    }

    // Then hit /language-selected with auto-detect (no digit press)
    const langRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: callerNumber,
        Digits: '',
        CallStatus: 'in-progress',
      }),
    })

    return {
      status: langRes.status(),
      body: await langRes.text(),
    }
  }

  test('voicemailMode=always returns voicemail TwiML (Record verb, no Enqueue)', async ({
    request,
  }) => {
    // First check if telephony is available
    const probeRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: 'CA_probe_vm_mode',
        From: '+15559990000',
        To: '+15553334444',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })

    if (probeRes.status() === 503 || probeRes.status() === 404) {
      test.skip(true, 'Telephony not configured in dev env')
      return
    }
    telephonyAvailable = true

    // Set voicemailMode to 'always'
    await setVoicemailMode(request, 'always')

    const callSid = `CA_vm_always_${Date.now()}`
    const { status, body } = await simulateLanguageSelected(request, callSid)

    expect(status).toBe(200)
    // Should contain Record (voicemail prompt) and NOT Enqueue (normal ringing flow)
    expect(body).toMatch(/Record/i)
    expect(body).not.toMatch(/Enqueue/i)

    // Reset to auto for other tests
    await setVoicemailMode(request, 'auto')
  })

  test('voicemailMode=never with no volunteers returns unavailable message (no Record, no Enqueue)', async ({
    request,
  }) => {
    test.skip(!telephonyAvailable, 'Telephony not configured')

    // Set voicemailMode to 'never'
    await setVoicemailMode(request, 'never')

    // With no shifts and no fallback group, there are no available volunteers.
    // The auto mode would go to voicemail, but 'never' should play unavailable.
    const callSid = `CA_vm_never_${Date.now()}`
    const { status, body } = await simulateLanguageSelected(request, callSid)

    expect(status).toBe(200)
    // Should NOT contain Record (no voicemail) and NOT contain Enqueue (no ringing)
    // Should contain a message about being unavailable + Hangup
    expect(body).not.toMatch(/Record/i)
    expect(body).not.toMatch(/Enqueue/i)
    expect(body).toMatch(/sorry|unavailable|try again/i)

    // Reset to auto
    await setVoicemailMode(request, 'auto')
  })

  test('voicemailMode=auto with no shifts returns voicemail TwiML', async ({ request }) => {
    test.skip(!telephonyAvailable, 'Telephony not configured')

    // Mode is 'auto', and no shifts/fallback configured means no available volunteers → voicemail
    await setVoicemailMode(request, 'auto')

    const callSid = `CA_vm_auto_noshifts_${Date.now()}`
    const { status, body } = await simulateLanguageSelected(request, callSid)

    expect(status).toBe(200)
    // Should contain Record (voicemail) since no one is available in auto mode
    expect(body).toMatch(/Record/i)
    expect(body).not.toMatch(/Enqueue/i)
  })
})
