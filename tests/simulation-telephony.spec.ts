import { test, expect } from '@playwright/test'
import { simulateIncomingCall, simulateEndCall, simulateVoicemail } from './helpers/simulation'
import { resetTestState } from './helpers/index'

const PROVIDERS = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk'] as const

test.describe('Cross-provider telephony simulation smoke tests', () => {
  test.beforeEach(async ({ request }) => {
    await resetTestState(request)
  })

  for (const provider of PROVIDERS) {
    test(`${provider}: incoming-call webhook accepted (not 400/403/500)`, async ({ request }) => {
      const { status } = await simulateIncomingCall(request, provider, {
        callerNumber: '+15555550100',
      })
      // 200 = success, 404 = telephony not configured (acceptable in CI without provider creds)
      // Anything else = payload format error or auth failure
      expect([200, 404]).toContain(status)
    })

    test(`${provider}: end-call webhook accepted`, async ({ request }) => {
      const callSid = `test-end-${provider}-${Date.now()}`
      const { status } = await simulateEndCall(request, provider, {
        callSid,
        status: 'completed',
      })
      expect([200, 404]).toContain(status)
    })

    test(`${provider}: voicemail webhook accepted`, async ({ request }) => {
      const callSid = `test-vm-${provider}-${Date.now()}`
      const { status } = await simulateVoicemail(request, provider, { callSid })
      expect([200, 404]).toContain(status)
    })
  }
})
