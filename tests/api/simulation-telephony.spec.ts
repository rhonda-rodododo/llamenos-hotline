import { expect, test } from '@playwright/test'
import { simulateEndCall, simulateIncomingCall, simulateVoicemail } from '../helpers/simulation'

const PROVIDERS = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk', 'freeswitch'] as const

/**
 * Expected response content patterns per provider when returning 200.
 * In test/dev environments USE_TEST_ADAPTER=true means all providers fall back
 * to the TestAdapter which returns TwiML, so Asterisk/Vonage patterns also accept TwiML.
 */
const RESPONSE_PATTERNS: Record<string, { contentType: RegExp; bodyPattern: RegExp }> = {
  twilio: { contentType: /xml/i, bodyPattern: /<Response>/ },
  signalwire: { contentType: /xml/i, bodyPattern: /<Response>/ },
  vonage: { contentType: /json|xml/i, bodyPattern: /ncco|action|<Response>/i },
  plivo: { contentType: /xml/i, bodyPattern: /<Response>/ },
  // Asterisk returns ARI JSON when configured, TwiML when using TestAdapter fallback
  asterisk: { contentType: /json|xml/i, bodyPattern: /channel|endpoint|application|<Response>/i },
  // FreeSWITCH returns mod_httapi XML when configured, TwiML when using TestAdapter fallback
  freeswitch: {
    contentType: /xml/i,
    bodyPattern: /freeswitch-httapi|document|<Response>/i,
  },
}

test.describe('Cross-provider telephony simulation smoke tests', () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: incoming-call webhook returns valid response or 404`, async ({
      request,
    }) => {
      const { status, body } = await simulateIncomingCall(request, provider, {
        callerNumber: '+15555550100',
      })

      if (status === 200) {
        const pattern = RESPONSE_PATTERNS[provider]
        expect(
          body,
          `${provider} incoming-call response body should match expected format`
        ).toMatch(pattern.bodyPattern)
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

  test('telephony incoming without configured provider returns 404 or 200 (TestAdapter)', async ({
    request,
  }) => {
    // Send a well-formed Twilio webhook to a hub that has no telephony configured
    const res = await request.post('/telephony/incoming?hub=nonexistent-hub', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-no-provider&From=%2B15555550100&To=%2B15559999999&CallStatus=ringing',
    })
    // In production: 404 (no provider configured for this hub)
    // In dev/test with USE_TEST_ADAPTER=true: 200 (TestAdapter fallback serves all hubs)
    expect([200, 404]).toContain(res.status())
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
    expect(res.status(), `Malformed payload should not cause 500: got ${res.status()}`).not.toBe(
      500
    )
  })
})
