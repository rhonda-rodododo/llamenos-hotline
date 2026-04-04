/**
 * Unit tests for BandwidthAdapter — BXML output and webhook parsing.
 */
import { describe, expect, it } from 'bun:test'
import { BandwidthAdapter } from './bandwidth'

function createAdapter(): BandwidthAdapter {
  return new BandwidthAdapter(
    'test-account-id',
    'test-api-token',
    'test-api-secret',
    'test-app-id',
    '+15551234567'
  )
}

/** Helper: create a mock Request with JSON body */
function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/telephony/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('BandwidthAdapter', () => {
  // --- BXML Output Tests ---

  describe('handleLanguageMenu', () => {
    it('returns BXML with Gather and SpeakSentence for multiple languages', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en', 'es'],
      })

      expect(res.contentType).toBe('application/xml')
      expect(res.body).toContain('<Gather')
      expect(res.body).toContain('<SpeakSentence')
      expect(res.body).toContain('gatherUrl="/telephony/language-selected')
      expect(res.body).toContain('maxDigits="1"')
    })

    it('skips menu and redirects when only one language enabled', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['es'],
      })

      expect(res.contentType).toBe('application/xml')
      expect(res.body).toContain('<Redirect')
      expect(res.body).toContain('forceLang=es')
      expect(res.body).not.toContain('<Gather')
    })

    it('includes hub ID in callback URLs', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en'],
        hubId: 'hub-abc',
      })

      expect(res.body).toContain('hub=hub-abc')
    })
  })

  describe('handleIncomingCall', () => {
    it('returns BXML with greeting and hold redirect for normal call', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
      })

      expect(res.contentType).toBe('application/xml')
      expect(res.body).toContain('<SpeakSentence')
      expect(res.body).toContain('Test Hotline')
      expect(res.body).toContain('<Redirect')
      expect(res.body).toContain('/telephony/wait-music')
    })

    it('returns rate limit rejection with Hangup', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        voiceCaptchaEnabled: false,
        rateLimited: true,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
      })

      expect(res.body).toContain('<Hangup/>')
      expect(res.body).toContain('<SpeakSentence')
    })

    it('returns CAPTCHA Gather when voice CAPTCHA enabled', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        voiceCaptchaEnabled: true,
        rateLimited: false,
        callerLanguage: 'es',
        hotlineName: 'Test Hotline',
        captchaDigits: '4829',
      })

      expect(res.body).toContain('<Gather')
      expect(res.body).toContain('maxDigits="4"')
      expect(res.body).toContain('/telephony/captcha')
      expect(res.body).toContain('4, 8, 2, 9')
    })

    it('uses /telephony/ prefix for callback URLs, not /api/telephony/', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'call-123',
        callerNumber: '+15559876543',
        voiceCaptchaEnabled: true,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
        captchaDigits: '1234',
      })

      expect(res.body).toContain('/telephony/captcha')
      expect(res.body).not.toContain('/api/telephony/')
    })
  })

  describe('handleCaptchaResponse', () => {
    it('redirects to wait music on correct digits', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'call-123',
        digits: '4829',
        expectedDigits: '4829',
        callerLanguage: 'en',
      })

      expect(res.body).toContain('<Redirect')
      expect(res.body).toContain('/telephony/wait-music')
    })

    it('retries with new digits when attempts remain', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'call-123',
        digits: '0000',
        expectedDigits: '4829',
        callerLanguage: 'en',
        remainingAttempts: 2,
        newCaptchaDigits: '5678',
      })

      expect(res.body).toContain('<Gather')
      expect(res.body).toContain('5, 6, 7, 8')
    })

    it('rejects with Hangup when no attempts remain', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'call-123',
        digits: '0000',
        expectedDigits: '4829',
        callerLanguage: 'en',
      })

      expect(res.body).toContain('<Hangup/>')
    })
  })

  describe('handleCallAnswered', () => {
    it('returns BXML with StartRecording and Bridge', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCallAnswered({
        parentCallSid: 'parent-call-123',
        callbackUrl: 'https://app.example.com',
        userPubkey: 'pubkey-abc',
      })

      expect(res.contentType).toBe('application/xml')
      expect(res.body).toContain('<StartRecording')
      expect(res.body).toContain('<Bridge')
      expect(res.body).toContain('targetCall="parent-call-123"')
      expect(res.body).toContain('/telephony/call-recording')
      expect(res.body).toContain('pubkey=pubkey-abc')
    })

    it('uses /telephony/ prefix for recording callback', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCallAnswered({
        parentCallSid: 'parent-call-123',
        callbackUrl: 'https://app.example.com',
        userPubkey: 'pubkey-abc',
      })

      expect(res.body).toContain('https://app.example.com/telephony/call-recording')
      expect(res.body).not.toContain('/api/telephony/')
    })
  })

  describe('handleVoicemail', () => {
    it('returns BXML with voicemail prompt and Record', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleVoicemail({
        callSid: 'call-123',
        callerLanguage: 'en',
        callbackUrl: 'https://app.example.com',
      })

      expect(res.body).toContain('<Record')
      expect(res.body).toContain('maxDuration="120"')
      expect(res.body).toContain('recordCompleteUrl=')
      expect(res.body).toContain('recordingAvailableUrl=')
      expect(res.body).toContain('<Hangup/>')
    })

    it('uses custom maxRecordingSeconds', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleVoicemail({
        callSid: 'call-123',
        callerLanguage: 'en',
        callbackUrl: 'https://app.example.com',
        maxRecordingSeconds: 60,
      })

      expect(res.body).toContain('maxDuration="60"')
    })
  })

  describe('handleWaitMusic', () => {
    it('returns BXML with PlayAudio and redirect loop', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleWaitMusic('en')

      expect(res.body).toContain('<PlayAudio>')
      expect(res.body).toContain('<Redirect')
      expect(res.body).toContain('/telephony/wait-music')
    })

    it('returns Hangup when queue timeout exceeded', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleWaitMusic('en', undefined, 100, 90)

      expect(res.body).toContain('<Hangup/>')
      expect(res.body).not.toContain('<PlayAudio>')
    })
  })

  describe('handleVoicemailComplete', () => {
    it('returns BXML with thanks and Hangup', () => {
      const adapter = createAdapter()
      const res = adapter.handleVoicemailComplete('en')

      expect(res.body).toContain('<SpeakSentence')
      expect(res.body).toContain('<Hangup/>')
    })
  })

  describe('handleUnavailable', () => {
    it('returns BXML with unavailable message and Hangup', () => {
      const adapter = createAdapter()
      const res = adapter.handleUnavailable('en')

      expect(res.body).toContain('<SpeakSentence')
      expect(res.body).toContain('<Hangup/>')
    })
  })

  describe('rejectCall', () => {
    it('returns BXML with Hangup', () => {
      const adapter = createAdapter()
      const res = adapter.rejectCall()

      expect(res.body).toContain('<Hangup/>')
    })
  })

  describe('emptyResponse', () => {
    it('returns empty BXML Response', () => {
      const adapter = createAdapter()
      const res = adapter.emptyResponse()

      expect(res.body).toBe('<Response/>')
      expect(res.contentType).toBe('application/xml')
    })
  })

  // --- Webhook Parsing Tests ---

  describe('parseIncomingWebhook', () => {
    it('extracts callId, from, and to from initiate event', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({
        eventType: 'initiate',
        callId: 'c-abc123',
        from: '+15551112222',
        to: '+15551234567',
        direction: 'inbound',
        accountId: 'test-account-id',
        applicationId: 'test-app-id',
      })

      const result = await adapter.parseIncomingWebhook(req)
      expect(result.callSid).toBe('c-abc123')
      expect(result.callerNumber).toBe('+15551112222')
      expect(result.calledNumber).toBe('+15551234567')
    })
  })

  describe('parseLanguageWebhook', () => {
    it('extracts digits from gather event', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({
        eventType: 'gather',
        callId: 'c-abc123',
        from: '+15551112222',
        to: '+15551234567',
        digits: '2',
        accountId: 'test-account-id',
        applicationId: 'test-app-id',
      })

      const result = await adapter.parseLanguageWebhook(req)
      expect(result.callSid).toBe('c-abc123')
      expect(result.digits).toBe('2')
      expect(result.callerNumber).toBe('+15551112222')
    })
  })

  describe('parseCaptchaWebhook', () => {
    it('extracts CAPTCHA digits', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({
        eventType: 'gather',
        callId: 'c-abc123',
        from: '+15551112222',
        digits: '4829',
        accountId: 'test-account-id',
        applicationId: 'test-app-id',
      })

      const result = await adapter.parseCaptchaWebhook(req)
      expect(result.digits).toBe('4829')
      expect(result.callerNumber).toBe('+15551112222')
    })
  })

  describe('parseCallStatusWebhook', () => {
    it('maps initiate event to initiated status', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'initiate', callId: 'c-1' })
      const result = await adapter.parseCallStatusWebhook(req)
      expect(result.status).toBe('initiated')
    })

    it('maps answer event to answered status', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'answer', callId: 'c-1' })
      const result = await adapter.parseCallStatusWebhook(req)
      expect(result.status).toBe('answered')
    })

    it('maps disconnect with hangup cause to completed', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'disconnect', callId: 'c-1', cause: 'hangup' })
      const result = await adapter.parseCallStatusWebhook(req)
      expect(result.status).toBe('completed')
    })

    it('maps disconnect with busy cause to busy', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'disconnect', callId: 'c-1', cause: 'busy' })
      const result = await adapter.parseCallStatusWebhook(req)
      expect(result.status).toBe('busy')
    })

    it('maps disconnect with timeout cause to no-answer', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'disconnect', callId: 'c-1', cause: 'timeout' })
      const result = await adapter.parseCallStatusWebhook(req)
      expect(result.status).toBe('no-answer')
    })
  })

  describe('parseQueueExitWebhook', () => {
    it('maps transferComplete to bridged', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'transferComplete', callId: 'c-1' })
      const result = await adapter.parseQueueExitWebhook(req)
      expect(result.result).toBe('bridged')
    })

    it('maps disconnect with hangup to hangup result', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({ eventType: 'disconnect', callId: 'c-1', cause: 'hangup' })
      const result = await adapter.parseQueueExitWebhook(req)
      expect(result.result).toBe('hangup')
    })
  })

  describe('parseRecordingWebhook', () => {
    it('extracts recording info from recordingAvailable event', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({
        eventType: 'recordingAvailable',
        callId: 'c-abc123',
        recordingId: 'r-xyz789',
        mediaUrl: 'https://voice.bandwidth.com/api/v2/recordings/r-xyz789/media',
        accountId: 'test-account-id',
        applicationId: 'test-app-id',
      })

      const result = await adapter.parseRecordingWebhook(req)
      expect(result.status).toBe('completed')
      expect(result.recordingSid).toBe('r-xyz789')
      expect(result.callSid).toBe('c-abc123')
    })

    it('extracts recording info from recordComplete event', async () => {
      const adapter = createAdapter()
      const req = jsonRequest({
        eventType: 'recordComplete',
        callId: 'c-abc123',
        recordingId: 'r-xyz789',
        accountId: 'test-account-id',
        applicationId: 'test-app-id',
      })

      const result = await adapter.parseRecordingWebhook(req)
      expect(result.status).toBe('completed')
      expect(result.recordingSid).toBe('r-xyz789')
    })
  })

  // --- Webhook Validation ---

  describe('validateWebhook', () => {
    it('returns true for valid basic auth credentials', async () => {
      const adapter = createAdapter()
      const auth = btoa('test-api-token:test-api-secret')
      const req = new Request('http://localhost/telephony/incoming', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })

      const result = await adapter.validateWebhook(req)
      expect(result).toBe(true)
    })

    it('returns false for invalid credentials', async () => {
      const adapter = createAdapter()
      const auth = btoa('wrong-token:wrong-secret')
      const req = new Request('http://localhost/telephony/incoming', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })

      const result = await adapter.validateWebhook(req)
      expect(result).toBe(false)
    })

    it('returns false when no Authorization header', async () => {
      const adapter = createAdapter()
      const req = new Request('http://localhost/telephony/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })

      const result = await adapter.validateWebhook(req)
      expect(result).toBe(false)
    })
  })

  // --- BXML Content Type ---

  describe('content type', () => {
    it('returns application/xml for all BXML responses', async () => {
      const adapter = createAdapter()

      const langMenu = await adapter.handleLanguageMenu({
        callSid: 'c-1',
        callerNumber: '+1555',
        hotlineName: 'Test',
        enabledLanguages: ['en', 'es'],
      })
      expect(langMenu.contentType).toBe('application/xml')

      const incoming = await adapter.handleIncomingCall({
        callSid: 'c-1',
        callerNumber: '+1555',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test',
      })
      expect(incoming.contentType).toBe('application/xml')

      const reject = adapter.rejectCall()
      expect(reject.contentType).toBe('application/xml')
    })
  })
})
