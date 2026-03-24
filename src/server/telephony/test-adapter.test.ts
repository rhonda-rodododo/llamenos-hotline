import { describe, expect, test } from 'bun:test'
import { TestAdapter } from './test'

describe('TestAdapter', () => {
  const adapter = new TestAdapter()

  test('handleLanguageMenu returns valid TwiML with Gather', async () => {
    const res = await adapter.handleLanguageMenu({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en', 'es'],
    })
    expect(res.contentType).toBe('text/xml')
    expect(res.body).toContain('<Response>')
    expect(res.body).toContain('<Gather')
    expect(res.body).toContain('numDigits="1"')
  })

  test('handleIncomingCall returns Enqueue when not rate-limited', async () => {
    const res = await adapter.handleIncomingCall({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      voiceCaptchaEnabled: false,
      rateLimited: false,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
    })
    expect(res.body).toContain('<Enqueue')
  })

  test('handleIncomingCall returns Reject when rate-limited', async () => {
    const res = await adapter.handleIncomingCall({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      voiceCaptchaEnabled: false,
      rateLimited: true,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
    })
    expect(res.body).toContain('<Reject')
  })

  test('handleIncomingCall returns Gather when CAPTCHA enabled', async () => {
    const res = await adapter.handleIncomingCall({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      voiceCaptchaEnabled: true,
      rateLimited: false,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
      captchaDigits: '1234',
    })
    expect(res.body).toContain('<Gather')
    expect(res.body).toContain('captcha')
  })

  test('handleCaptchaResponse returns Enqueue on correct digits', async () => {
    const res = await adapter.handleCaptchaResponse({
      callSid: 'CA_test_123',
      digits: '1234',
      expectedDigits: '1234',
      callerLanguage: 'en',
    })
    expect(res.body).toContain('<Enqueue')
  })

  test('handleCaptchaResponse returns Hangup on wrong digits with no retries', async () => {
    const res = await adapter.handleCaptchaResponse({
      callSid: 'CA_test_123',
      digits: '9999',
      expectedDigits: '1234',
      callerLanguage: 'en',
      remainingAttempts: 0,
    })
    expect(res.body).toContain('<Hangup')
    expect(res.body).not.toContain('<Gather')
  })

  test('handleCaptchaResponse returns Gather on wrong digits with retries remaining', async () => {
    const res = await adapter.handleCaptchaResponse({
      callSid: 'CA_test_123',
      digits: '9999',
      expectedDigits: '1234',
      callerLanguage: 'en',
      remainingAttempts: 2,
      newCaptchaDigits: '5678',
    })
    expect(res.body).toContain('<Gather')
    expect(res.body).toContain('5, 6, 7, 8')
    expect(res.body).not.toContain('<Enqueue')
  })

  test('rejectCall returns Reject TwiML', () => {
    const res = adapter.rejectCall()
    expect(res.body).toContain('<Reject')
  })

  test('emptyResponse returns empty TwiML', () => {
    const res = adapter.emptyResponse()
    expect(res.body).toContain('<Response/>')
  })

  test('validateWebhook always returns true', async () => {
    const req = new Request('http://localhost/telephony/incoming', { method: 'POST' })
    expect(await adapter.validateWebhook(req)).toBe(true)
  })

  test('parseIncomingWebhook extracts form fields', async () => {
    const body = new URLSearchParams({
      CallSid: 'CA_abc',
      From: '+15551111111',
      To: '+15552222222',
    })
    const req = new Request('http://localhost/telephony/incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const result = await adapter.parseIncomingWebhook(req)
    expect(result.callSid).toBe('CA_abc')
    expect(result.callerNumber).toBe('+15551111111')
    expect(result.calledNumber).toBe('+15552222222')
  })

  test('parseCallStatusWebhook maps Twilio statuses', async () => {
    const body = new URLSearchParams({ CallStatus: 'in-progress' })
    const req = new Request('http://localhost/telephony/call-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const result = await adapter.parseCallStatusWebhook(req)
    expect(result.status).toBe('answered')
  })

  test('testConnection returns connected', async () => {
    const result = await adapter.testConnection()
    expect(result.connected).toBe(true)
  })

  test('ringVolunteers returns empty array (no real calls)', async () => {
    const sids = await adapter.ringVolunteers({
      callSid: 'CA_test',
      callerNumber: '+15551111111',
      volunteers: [{ pubkey: 'pk1', phone: '+15553333333' }],
      callbackUrl: 'http://localhost:3000',
    })
    expect(sids).toEqual([])
  })

  test('handleWaitMusic returns Leave when queue timeout exceeded', async () => {
    const res = await adapter.handleWaitMusic('en', undefined, 120, 60)
    expect(res.body).toContain('<Leave/>')
  })

  test('handleWaitMusic returns hold music when within timeout', async () => {
    const res = await adapter.handleWaitMusic('en', undefined, 10, 60)
    expect(res.body).toContain('<Say>')
    expect(res.body).toContain('<Pause')
  })
})
