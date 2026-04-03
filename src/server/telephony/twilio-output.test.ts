import { describe, expect, test } from 'bun:test'
import { TwilioAdapter } from './twilio'

const adapter = new TwilioAdapter('ACtest', 'test-token', '+15551234567')

describe('TwilioAdapter TwiML output', () => {
  test('handleLanguageMenu single language redirects to /telephony/', async () => {
    const result = await adapter.handleLanguageMenu({
      callSid: 'CA123',
      callerNumber: '+15559876543',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en'],
    })
    expect(result.contentType).toBe('text/xml')
    expect(result.body).toContain('/telephony/language-selected')
    expect(result.body).not.toContain('/api/telephony/')
  })

  test('handleLanguageMenu multi-language generates Gather', async () => {
    const result = await adapter.handleLanguageMenu({
      callSid: 'CA123',
      callerNumber: '+15559876543',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en', 'es'],
    })
    expect(result.body).toContain('<Gather')
    expect(result.body).toContain('/telephony/language-selected')
    expect(result.body).not.toContain('/api/telephony/')
  })

  test('handleIncomingCall with CAPTCHA generates Gather for digits', async () => {
    const result = await adapter.handleIncomingCall({
      callSid: 'CA123',
      callerNumber: '+15559876543',
      hotlineName: 'Test Hotline',
      voiceCaptchaEnabled: true,
      rateLimited: false,
      callerLanguage: 'en',
      captchaDigits: '5678',
    })
    expect(result.body).toContain('<Gather')
    expect(result.body).toContain('/telephony/captcha')
    expect(result.body).not.toContain('/api/telephony/')
  })

  test('handleIncomingCall without CAPTCHA enqueues', async () => {
    const result = await adapter.handleIncomingCall({
      callSid: 'CA123',
      callerNumber: '+15559876543',
      hotlineName: 'Test Hotline',
      voiceCaptchaEnabled: false,
      rateLimited: false,
      callerLanguage: 'en',
    })
    expect(result.body).toContain('<Enqueue')
    expect(result.body).toContain('/telephony/wait-music')
    expect(result.body).toContain('/telephony/queue-exit')
    expect(result.body).not.toContain('/api/telephony/')
  })

  test('handleCallAnswered generates Dial with recording callback', async () => {
    const result = await adapter.handleCallAnswered({
      parentCallSid: 'CA123',
      callbackUrl: 'https://hotline.example.com',
      userPubkey: 'abc123',
    })
    expect(result.body).toContain('<Dial')
    expect(result.body).toContain('https://hotline.example.com/telephony/call-recording')
    expect(result.body).not.toContain('/api/telephony/')
  })

  test('handleVoicemail generates Record with callbacks', async () => {
    const result = await adapter.handleVoicemail({
      callSid: 'CA123',
      callerLanguage: 'en',
      callbackUrl: 'https://hotline.example.com',
    })
    expect(result.body).toContain('<Record')
    expect(result.body).toContain('/telephony/voicemail-complete')
    expect(result.body).toContain('https://hotline.example.com/telephony/voicemail-recording')
    expect(result.body).not.toContain('/api/telephony/')
  })

  test('rejectCall returns valid TwiML', () => {
    const result = adapter.rejectCall()
    expect(result.contentType).toBe('text/xml')
    expect(result.body).toContain('<Reject')
  })

  test('emptyResponse returns valid TwiML', () => {
    const result = adapter.emptyResponse()
    expect(result.contentType).toBe('text/xml')
    expect(result.body).toContain('<Response')
  })

  test('handleWaitMusic returns valid TwiML', async () => {
    const result = await adapter.handleWaitMusic('en')
    expect(result.contentType).toBe('text/xml')
    expect(result.body).toContain('<Response')
  })

  test('verifyWebhookConfig uses /telephony/ path', async () => {
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://hotline.example.com')
    expect(result.expectedUrl).toBe('https://hotline.example.com/telephony/incoming')
    expect(result.expectedUrl).not.toContain('/api/telephony/')
  })
})
