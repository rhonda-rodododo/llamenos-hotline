import { expect, test } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin } from '../helpers'

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function twilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

test.describe('Voicemail UI', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('voicemail badge appears in calls list UI when hasVoicemail is true', async ({
    page,
    request,
  }) => {
    const callSid = `CA_test_vm_ui_${Date.now()}`

    // Simulate incoming call
    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: '+15554445555',
        To: '+15556667777',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })
    expect(incomingRes.status()).toBe(200)

    // Simulate voicemail recording complete — must finish before call-status
    // because the voicemail handler reads the active call to find hubId, and
    // call-status 'completed' deletes the active call.
    const vmRes = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_ui_${Date.now()}`,
        CallSid: callSid,
      }),
    })
    expect(vmRes.status()).toBe(200)

    // Wait for voicemail handler to complete its DB writes before completing the call.
    // The handler sets hasVoicemail=true via upsertCallRecord synchronously, but
    // background tasks (storage, transcription) run async. The DB write is what matters.
    await new Promise((r) => setTimeout(r, 1000))

    // Complete the call so it appears in call history
    const statusRes = await request.post('/telephony/call-status', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        CallStatus: 'completed',
        From: '+15554445555',
        To: '+15556667777',
        Duration: '30',
      }),
    })
    expect(statusRes.status()).toBe(200)

    // Wait for call-status handler to persist the completed call record
    await new Promise((r) => setTimeout(r, 1000))

    // Verify the call record exists with hasVoicemail via API before checking UI
    const historyRes = await request.get('/api/calls/history')
    expect(historyRes.ok()).toBeTruthy()
    const history = await historyRes.json()
    const vmCall = history.calls?.find((c: { callSid?: string }) => c.callSid === callSid)
    expect(vmCall, `Call ${callSid} should appear in history`).toBeTruthy()
    expect(vmCall.hasVoicemail, 'Call should have hasVoicemail=true').toBe(true)

    // Now navigate to the calls page and verify UI
    await navigateAfterLogin(page, '/calls')
    await expect(page.getByRole('heading', { name: /call history/i })).toBeVisible({
      timeout: 15000,
    })

    // Wait for call list rows to render
    await expect(page.locator('[data-testid="call-history-row"]').first()).toBeVisible({
      timeout: 15000,
    })

    // The VoicemailPlayer component renders data-testid="voicemail-player"
    await expect(page.locator('[data-testid="voicemail-player"]').first()).toBeVisible({
      timeout: 15000,
    })
  })
})
