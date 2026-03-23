import { test, expect } from '@playwright/test'
import { simulateIncomingCall, simulateEndCall, simulateVoicemail } from './helpers/simulation'
import { resetTestState } from './helpers/index'

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

  test('invalid provider name returns 400 or 404', async ({ request }) => {
    const { status } = await simulateIncomingCall(request, 'not-a-real-provider' as any, {
      callerNumber: '+15555550100',
    })
    expect([400, 404]).toContain(status)
  })

  test('malformed payload returns 400 (not 200 or 500)', async ({ request }) => {
    // Send a request with missing required fields and garbage data
    const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787'
    const TEST_SECRET = process.env.E2E_TEST_SECRET ?? process.env.DEV_RESET_SECRET ?? ''

    const res = await request.post(
      `${BASE_URL}/api/test-simulate/incoming-call?provider=twilio`,
      {
        data: { callerNumber: '', calledNumber: 12345, unexpected: { nested: true } },
        headers: { 'X-Test-Secret': TEST_SECRET },
      }
    )

    // Should not silently succeed or crash — expect 400 (bad input) or 404 (not configured)
    // 500 would indicate an unhandled error, which is a bug
    expect(res.status(), 'Malformed payload should not return 500').not.toBe(500)
    // If the endpoint is configured, it should reject bad input with 400
    if (res.status() !== 404) {
      expect(res.status()).toBe(400)
    }
  })
})
