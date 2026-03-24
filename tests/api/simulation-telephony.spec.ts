import { test, expect } from '@playwright/test'
import { simulateIncomingCall, simulateEndCall, simulateVoicemail } from '../helpers/simulation'
import { resetTestState } from '../helpers/index'

const PROVIDERS = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk'] as const

/** Expected response content patterns per provider when returning 200 */
const RESPONSE_PATTERNS: Record<string, { contentType: RegExp; bodyPattern: RegExp }> = {
  twilio: { contentType: /xml/i, bodyPattern: /<Response>/ },
  signalwire: { contentType: /xml/i, bodyPattern: /<Response>/ },
  vonage: { contentType: /json/i, bodyPattern: /ncco|action/i },
  plivo: { contentType: /xml/i, bodyPattern: /<Response>/ },
  asterisk: { contentType: /json/i, bodyPattern: /channel|endpoint|application/i },
}

test.describe('Cross-provider telephony simulation smoke tests', () => {
  test.beforeEach(async ({ request }) => {
    await resetTestState(request)
  })

  for (const provider of PROVIDERS) {
    test(`${provider}: incoming-call webhook returns valid response or 404`, async ({ request }) => {
      const { status, body } = await simulateIncomingCall(request, provider, {
        callerNumber: '+15555550100',
      })

      if (status === 200) {
        const pattern = RESPONSE_PATTERNS[provider]
        expect(body, `${provider} incoming-call response body should match expected format`).toMatch(
          pattern.bodyPattern
        )
      } else if (status === 404) {
        // Provider not configured — acceptable in CI without provider creds
        console.log(`[${provider}] incoming-call returned 404 (provider not configured)`)
      } else {
        throw new Error(
          `${provider} incoming-call returned unexpected status ${status}: ${body.slice(0, 200)}`
        )
      }
    })

    test(`${provider}: end-call webhook returns valid response or 404`, async ({ request }) => {
      const callSid = `test-end-${provider}-${Date.now()}`
      const { status, body } = await simulateEndCall(request, provider, {
        callSid,
        status: 'completed',
      })

      if (status === 200) {
        // End-call should return a success acknowledgment
        expect(body).toBeTruthy()
      } else if (status === 404) {
        console.log(`[${provider}] end-call returned 404 (provider not configured)`)
      } else {
        throw new Error(
          `${provider} end-call returned unexpected status ${status}: ${body.slice(0, 200)}`
        )
      }
    })

    test(`${provider}: voicemail webhook returns valid response or 404`, async ({ request }) => {
      const callSid = `test-vm-${provider}-${Date.now()}`
      const { status, body } = await simulateVoicemail(request, provider, { callSid })

      if (status === 200) {
        // Voicemail should return a success acknowledgment
        expect(body).toBeTruthy()
      } else if (status === 404) {
        console.log(`[${provider}] voicemail returned 404 (provider not configured)`)
      } else {
        throw new Error(
          `${provider} voicemail returned unexpected status ${status}: ${body.slice(0, 200)}`
        )
      }
    })
  }

  test('telephony incoming without configured provider returns 404', async ({ request }) => {
    // Send a well-formed Twilio webhook to a hub that has no telephony configured
    const res = await request.post('/telephony/incoming?hub=nonexistent-hub', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-no-provider&From=%2B15555550100&To=%2B15559999999&CallStatus=ringing',
    })
    // Server should return 404 (no provider configured for this hub)
    expect(res.status()).toBe(404)
  })

  test('malformed payload returns 400 or is handled gracefully (not 500)', async ({ request }) => {
    // Send a request with missing/invalid fields to the real incoming webhook
    const res = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'From=&To=12345&unexpected=true',
    })

    // Should not crash (500). 200/404 are acceptable (provider handles gracefully or not configured)
    // 400/403 also fine (bad input or validation failure)
    expect(res.status(), 'Malformed payload should not return 500').not.toBe(500)
    // Should not crash (500 = unhandled error = bug)
    expect(res.status(), `Malformed payload should not cause 500: got ${res.status()}`).not.toBe(500)
  })
})
