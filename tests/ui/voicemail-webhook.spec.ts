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

    // Step 2: Simulate voicemail recording — await response to ensure
    // the handler's synchronous DB write (hasVoicemail=true) completes.
    const vmRes = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_ui_${Date.now()}`,
        CallSid: callSid,
      }),
    })
    expect(vmRes.status()).toBe(200)

    // Step 3: Wait for voicemail DB write to be fully committed, then
    // complete the call. The delay prevents a race where call-status
    // deletes the active call before the voicemail handler reads hubId.
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

    // Step 4: Verify via authed browser fetch that hasVoicemail is set.
    // This confirms the DB state before we check the UI.
    await page.waitForTimeout(2000)
    const apiCheck = await page.evaluate(async (sid: string) => {
      const res = await fetch('/api/calls/history')
      if (!res.ok) return { ok: false, status: res.status }
      const data = await res.json()
      const call = data.calls?.find((c: { callSid?: string }) => c.callSid === sid)
      return { ok: true, found: !!call, hasVoicemail: call?.hasVoicemail }
    }, callSid)

    // If the API check fails, log diagnostics and skip the UI check
    if (!apiCheck.ok || !apiCheck.found) {
      console.log('API check failed:', JSON.stringify(apiCheck))
      // The call may not have been recorded — this can happen if the
      // test adapter doesn't fully support voicemail recording flow.
      // Fail with a clear message rather than a confusing UI timeout.
      expect(apiCheck.found, `Call ${callSid} not found in history`).toBe(true)
    }
    expect(apiCheck.hasVoicemail, 'Call should have hasVoicemail=true').toBe(true)

    // Step 5: Navigate to calls page and verify UI shows voicemail badge
    await navigateAfterLogin(page, '/calls')
    await expect(page.getByRole('heading', { name: /call history/i })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.locator('[data-testid="call-history-row"]').first()).toBeVisible({
      timeout: 15000,
    })

    // Use voicemail-badge (always rendered when hasVoicemail=true) rather
    // than voicemail-player (may be empty without audio fileId)
    await expect(page.locator('[data-testid="voicemail-badge"]').first()).toBeVisible({
      timeout: 10000,
    })
  })
})
