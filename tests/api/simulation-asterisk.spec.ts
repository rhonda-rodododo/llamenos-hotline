import { expect, test } from '@playwright/test'
import { simulateEndCall, simulateIncomingCall, simulateVoicemail } from '../helpers/simulation'

// Asterisk simulation tests require USE_TEST_ADAPTER=false and a real Asterisk connection.
// When USE_TEST_ADAPTER=true (CI default), the TestAdapter handles webhooks in Twilio format,
// so Asterisk-formatted payloads return 500. Skip unless Asterisk is explicitly configured.
const hasAsteriskAdapter = process.env.TEST_ASTERISK_BRIDGE === '1'

test.describe('Asterisk simulation — call lifecycle', () => {
  test('incoming call → returns queue ARI command (not 400/403/500)', async ({ request }) => {
    test.skip(!hasAsteriskAdapter, 'Requires real Asterisk adapter (TEST_ASTERISK_BRIDGE=1)')
    const { status, body } = await simulateIncomingCall(request, 'asterisk', {
      callerNumber: '+15555550100',
    })
    // 200 = webhook accepted and processed
    // 404 = Asterisk not configured in this env (acceptable in CI)
    expect([200, 404]).toContain(status)
    if (status === 200) {
      // When a real AsteriskAdapter is configured: JSON ARI command response
      // When using TestAdapter fallback (dev/test with USE_TEST_ADAPTER=true): TwiML XML
      if (body.trim().startsWith('{')) {
        const json = JSON.parse(body)
        expect(json).toHaveProperty('commands')
        const commands: Array<{ action: string }> = json.commands
        // Should either enqueue (CAPTCHA off) or present language menu (CAPTCHA on)
        const actions = commands.map((c) => c.action)
        expect(actions.some((a) => ['queue', 'speak', 'gather'].includes(a))).toBe(true)
      } else {
        // TestAdapter fallback returns TwiML
        expect(body).toMatch(/<Response>/)
      }
    }
  })

  test('end call (completed) → call-status returns 200 or 404', async ({ request }) => {
    test.skip(!hasAsteriskAdapter, 'Requires real Asterisk adapter (TEST_ASTERISK_BRIDGE=1)')
    const callSid = `ast-end-${Date.now()}`
    await simulateIncomingCall(request, 'asterisk', { callSid })
    const { status } = await simulateEndCall(request, 'asterisk', {
      callSid,
      status: 'completed',
    })
    expect([200, 404]).toContain(status)
  })

  test('voicemail → voicemail-recording returns ARI hangup command (when configured)', async ({
    request,
  }) => {
    test.skip(!hasAsteriskAdapter, 'Requires real Asterisk adapter (TEST_ASTERISK_BRIDGE=1)')
    const callSid = `ast-vm-${Date.now()}`
    await simulateIncomingCall(request, 'asterisk', { callSid })
    const { status, body } = await simulateVoicemail(request, 'asterisk', { callSid })
    expect([200, 404]).toContain(status)
    if (status === 200 && body.trim().startsWith('{')) {
      const json = JSON.parse(body)
      if (json.commands) {
        const actions: string[] = json.commands.map((c: { action: string }) => c.action)
        expect(actions).toContain('hangup')
      }
    }
  })
})
