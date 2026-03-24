import type { ConnectionTestResult } from '@shared/types'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  RingVolunteersParams,
  TelephonyAdapter,
  TelephonyResponse,
  VoicemailParams,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
} from './adapter'

/**
 * TestAdapter — telephony adapter for E2E testing.
 * Returns valid TwiML responses without making real API calls.
 * Parses Twilio-format form-encoded webhook bodies.
 *
 * Activated via USE_TEST_ADAPTER=true env var as a fallback
 * when no real telephony provider is configured.
 */
export class TestAdapter implements TelephonyAdapter {
  private twiml(xml: string): TelephonyResponse {
    return { contentType: 'text/xml', body: xml.trim() }
  }

  // --- TwiML Response Methods ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `?hub=${encodeURIComponent(params.hubId)}` : ''
    const langOptions = (params.enabledLanguages ?? ['en'])
      .map((lang, i) => `<Say>For ${lang}, press ${i + 1}</Say>`)
      .join('\n      ')
    return this.twiml(`
      <Response>
        <Gather numDigits="1" action="/api/telephony/language-selected${hp}" method="POST" timeout="8">
          ${langOptions}
        </Gather>
        <Redirect method="POST">/api/telephony/language-selected?auto=1${hp ? `&amp;${hp.slice(1)}` : ''}</Redirect>
      </Response>
    `)
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage || 'en'
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''

    if (params.rateLimited) {
      return this.rejectCall()
    }

    if (params.voiceCaptchaEnabled && params.captchaDigits) {
      return this.twiml(`
        <Response>
          <Gather numDigits="${params.captchaDigits.length}" action="/api/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST" timeout="10">
            <Say>Please enter the digits: ${params.captchaDigits.split('').join(', ')}</Say>
          </Gather>
          <Hangup/>
        </Response>
      `)
    }

    return this.twiml(`
      <Response>
        <Say>Welcome to ${params.hotlineName}.</Say>
        <Enqueue waitUrl="/api/telephony/wait-music?lang=${lang}${hp}" action="/api/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST">${params.callSid}</Enqueue>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    if (params.digits === params.expectedDigits) {
      return this.twiml(`
        <Response>
          <Enqueue waitUrl="/api/telephony/wait-music?lang=${params.callerLanguage}${hp}" method="POST">${params.callSid}</Enqueue>
        </Response>
      `)
    }
    return this.twiml('<Response><Hangup/></Response>')
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    return this.twiml(`
      <Response>
        <Dial record="record-from-answer" recordingStatusCallback="${params.callbackUrl}/api/telephony/call-recording?parentCallSid=${params.parentCallSid}&amp;pubkey=${params.volunteerPubkey}${hp}" recordingStatusCallbackEvent="completed">
          <Queue>${params.parentCallSid}</Queue>
        </Dial>
      </Response>
    `)
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    return this.twiml(`
      <Response>
        <Say>Please leave a message after the beep.</Say>
        <Record maxLength="${params.maxRecordingSeconds ?? 120}" action="/api/telephony/voicemail-complete?callSid=${params.callSid}&amp;lang=${params.callerLanguage}${hp}" recordingStatusCallback="${params.callbackUrl}/api/telephony/voicemail-recording?callSid=${params.callSid}${hp}" recordingStatusCallbackEvent="completed" />
        <Hangup/>
      </Response>
    `)
  }

  async handleWaitMusic(
    _lang: string,
    _audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    if (queueTime && queueTimeout && queueTime >= queueTimeout) {
      return this.twiml('<Response><Leave/></Response>')
    }
    return this.twiml(`
      <Response>
        <Say>Please hold. A volunteer will be with you shortly.</Say>
        <Pause length="10"/>
      </Response>
    `)
  }

  handleVoicemailComplete(_lang: string): TelephonyResponse {
    return this.twiml(`
      <Response>
        <Say>Thank you for your message. Goodbye.</Say>
        <Hangup/>
      </Response>
    `)
  }

  rejectCall(): TelephonyResponse {
    return this.twiml('<Response><Reject reason="rejected"/></Response>')
  }

  emptyResponse(): TelephonyResponse {
    return this.twiml('<Response/>')
  }

  // --- Call Control (no-ops for test) ---

  async hangupCall(_callSid: string): Promise<void> {}
  async ringVolunteers(_params: RingVolunteersParams): Promise<string[]> {
    return []
  }
  async cancelRinging(_callSids: string[], _exceptSid?: string): Promise<void> {}

  // --- Webhook Validation (always passes) ---

  async validateWebhook(_request: Request): Promise<boolean> {
    return true
  }

  // --- Recording (not available in test) ---

  async getCallRecording(_callSid: string): Promise<ArrayBuffer | null> {
    return null
  }
  async getRecordingAudio(_recordingSid: string): Promise<ArrayBuffer | null> {
    return null
  }

  // --- Webhook Parsing (Twilio form-body format) ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const form = await request.clone().formData()
    return {
      callSid: form.get('CallSid') as string,
      callerNumber: form.get('From') as string,
      calledNumber: (form.get('To') as string) || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const form = await request.clone().formData()
    return {
      callSid: form.get('CallSid') as string,
      callerNumber: form.get('From') as string,
      digits: (form.get('Digits') as string) || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const form = await request.clone().formData()
    return {
      digits: (form.get('Digits') as string) || '',
      callerNumber: (form.get('From') as string) || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const form = await request.clone().formData()
    const raw = form.get('CallStatus') as string
    const STATUS_MAP: Record<string, WebhookCallStatus['status']> = {
      initiated: 'initiated',
      ringing: 'ringing',
      'in-progress': 'answered',
      completed: 'completed',
      busy: 'busy',
      'no-answer': 'no-answer',
      failed: 'failed',
      canceled: 'failed',
    }
    return { status: STATUS_MAP[raw] ?? 'failed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const form = await request.clone().formData()
    return { queueTime: Number.parseInt((form.get('QueueTime') as string) || '0', 10) }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const form = await request.clone().formData()
    const raw = form.get('QueueResult') as string
    const RESULT_MAP: Record<string, WebhookQueueResult['result']> = {
      leave: 'leave',
      'queue-full': 'queue-full',
      error: 'error',
      bridged: 'bridged',
      hangup: 'hangup',
    }
    return { result: RESULT_MAP[raw] ?? 'error' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const form = await request.clone().formData()
    const raw = form.get('RecordingStatus') as string
    return {
      status: raw === 'completed' ? 'completed' : 'failed',
      recordingSid: (form.get('RecordingSid') as string) || undefined,
      callSid: (form.get('CallSid') as string) || undefined,
    }
  }

  // --- Health ---

  async testConnection(): Promise<ConnectionTestResult> {
    return { connected: true, latencyMs: 0 }
  }
}
