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

    // Simulate voicemail recording complete
    await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_ui_${Date.now()}`,
        CallSid: callSid,
      }),
    })

    // Complete the call so it appears in call history
    await request.post('/telephony/call-status', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        CallStatus: 'completed',
        From: '+15554445555',
        To: '+15556667777',
        Duration: '30',
      }),
    })

    // Give the server a moment to process the webhooks before navigating
    await page.waitForTimeout(1000)

    // Navigate to calls page — wait for the call history API to return
    await navigateAfterLogin(page, '/calls')
    await expect(page.getByRole('heading', { name: /call history/i })).toBeVisible({
      timeout: 15000,
    })

    // Wait for call list to load (call-history-row is the actual testid in the component)
    await expect(page.locator('[data-testid="call-history-row"]').first()).toBeVisible({
      timeout: 15000,
    })

    // The VoicemailPlayer component renders with data-testid="voicemail-player"
    // when call.hasVoicemail is true. Verify at least one voicemail player is visible.
    const voicemailPlayer = page.locator('[data-testid="voicemail-player"]')
    await expect(voicemailPlayer.first()).toBeVisible({ timeout: 15000 })
  })
})
