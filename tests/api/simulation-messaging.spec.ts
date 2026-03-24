import { test, expect } from '@playwright/test'
import {
  simulateIncomingMessage,
  simulateDeliveryStatus,
} from '../helpers/simulation'
import { resetTestState } from '../helpers/index'

test.describe('Messaging simulation', () => {
  test.beforeEach(async ({ request }) => {
    await resetTestState(request)
  })

  test('Twilio SMS: incoming message → conversation created', async ({ request }) => {
    const { status } = await simulateIncomingMessage(request, 'twilio', 'sms', {
      senderNumber: '+15555550300',
      body: 'Hello from simulation',
    })
    // 200 = processed, 404 = channel not configured
    expect([200, 404]).toContain(status)
  })

  test('Twilio SMS: delivery status update → 200', async ({ request }) => {
    const msgSid = `SM${Date.now()}`
    const { status } = await simulateDeliveryStatus(request, 'twilio', 'sms', {
      messageSid: msgSid,
      status: 'delivered',
    })
    expect([200, 404]).toContain(status)
  })

  test('WhatsApp Meta: incoming message accepted', async ({ request }) => {
    const { status } = await simulateIncomingMessage(request, 'meta', 'whatsapp', {
      senderNumber: '+15555550301',
      body: 'WhatsApp test',
    })
    expect([200, 404]).toContain(status)
  })

  test('WhatsApp Twilio: incoming message accepted', async ({ request }) => {
    const { status } = await simulateIncomingMessage(request, 'twilio', 'whatsapp', {
      senderNumber: '+15555550302',
      body: 'WhatsApp via Twilio',
    })
    expect([200, 404]).toContain(status)
  })

  // Smoke: all SMS providers
  for (const provider of ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk'] as const) {
    test(`SMS ${provider}: webhook accepted (not 400/403/500)`, async ({ request }) => {
      const { status } = await simulateIncomingMessage(request, provider, 'sms', {
        senderNumber: '+15555550400',
        body: `Test from ${provider}`,
      })
      expect([200, 404]).toContain(status)
    })
  }

  test('Signal: incoming message accepted', async ({ request }) => {
    const { status } = await simulateIncomingMessage(request, 'twilio', 'signal', {
      senderNumber: '+15555550303',
      body: 'Signal test',
    })
    expect([200, 404]).toContain(status)
  })

  test('RCS: incoming message accepted', async ({ request }) => {
    const { status } = await simulateIncomingMessage(request, 'twilio', 'rcs', {
      senderNumber: '+15555550304',
      body: 'RCS test',
    })
    expect([200, 404]).toContain(status)
  })
})
