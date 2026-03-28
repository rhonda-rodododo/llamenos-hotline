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

    // Step 1: Simulate incoming call
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

    // Step 2: Simulate voicemail recording complete.
    // MUST complete before call-status 'completed' — the voicemail handler
    // reads the active call to resolve hubId, and call-status deletes it.
    const vmRes = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_ui_${Date.now()}`,
        CallSid: callSid,
      }),
    })
    expect(vmRes.status()).toBe(200)

    // Step 3: Complete the call. Wait between webhooks to ensure the voicemail
    // handler's synchronous DB write (upsertCallRecord with hasVoicemail=true)
    // finishes before call-status removes the active call.
    await page.waitForTimeout(2000)

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

    // Step 4: Navigate to calls page after giving the server time to persist
    await page.waitForTimeout(2000)
    await navigateAfterLogin(page, '/calls')
    await expect(page.getByRole('heading', { name: /call history/i })).toBeVisible({
      timeout: 15000,
    })

    // Step 5: Wait for the call list to populate
    await expect(page.locator('[data-testid="call-history-row"]').first()).toBeVisible({
      timeout: 15000,
    })

    // Step 6: Check for voicemail player — if not visible on first load,
    // reload to pick up the latest data (the voicemail flag may have been
    // written after the initial call record fetch)
    const voicemailPlayer = page.locator('[data-testid="voicemail-player"]')
    if (
      !(await voicemailPlayer
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false))
    ) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-testid="call-history-row"]').first()).toBeVisible({
        timeout: 15000,
      })
    }
    await expect(voicemailPlayer.first()).toBeVisible({ timeout: 10000 })
  })
})
