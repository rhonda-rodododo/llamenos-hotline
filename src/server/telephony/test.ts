import type { ConnectionTestResult } from '@shared/types'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  RingUsersParams,
  TelephonyAdapter,
  TelephonyResponse,
  VoicemailParams,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
  WebhookVerificationResult,
} from './adapter'

/**
 * TestAdapter — telephony adapter for E2E testing.
 * Returns valid TwiML responses without making real API calls.
 * Parses both Twilio-format form-encoded and JSON (Asterisk/Vonage) webhook bodies.
 *
 * Activated via USE_TEST_ADAPTER=true env var as a fallback
 * when no real telephony provider is configured.
 */
export class TestAdapter implements TelephonyAdapter {
  private twiml(xml: string): TelephonyResponse {
    return { contentType: 'text/xml', body: xml.trim() }
  }

  /**
   * Parse a webhook request body supporting both form-encoded (Twilio/SignalWire/Plivo)
   * and JSON (Vonage/Asterisk) payloads. Returns a unified flat key-value map where
   * JSON fields are normalised to their Twilio equivalents where possible.
   */
  private async parseWebhookBody(request: Request): Promise<Record<string, string>> {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const json = (await request.clone().json()) as Record<string, unknown>
      // Normalise Vonage / Asterisk / generic JSON field names to Twilio equivalents
      return {
        CallSid: String(json.CallSid ?? json.callSid ?? json.uuid ?? json.channelId ?? ''),
        From: String(json.From ?? json.from ?? json.callerNumber ?? json.callerIdNumber ?? ''),
        To: String(json.To ?? json.to ?? json.calledNumber ?? json.destination_number ?? ''),
        CallStatus: String(
          json.CallStatus ?? json.callStatus ?? json.state ?? json.status ?? 'ringing'
        ),
        Digits: String(json.Digits ?? json.digits ?? json.dtmf ?? ''),
        RecordingStatus: String(
          json.RecordingStatus ??
            json.recordingStatus ??
            (json.recordingStatus === 'done' ? 'completed' : '')
        ),
        RecordingSid: String(json.RecordingSid ?? json.recordingSid ?? json.recordingName ?? ''),
        QueueTime: String(json.QueueTime ?? json.queueTime ?? '0'),
        QueueResult: String(json.QueueResult ?? json.result ?? json.reason ?? ''),
      }
    }
    const form = await request.clone().formData()
    const result: Record<string, string> = {}
    for (const [key, value] of form.entries()) {
      result[key] = String(value)
    }
    return result
  }

  // --- TwiML Response Methods ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `?hub=${encodeURIComponent(params.hubId)}` : ''
    const langOptions = (params.enabledLanguages ?? ['en'])
      .map((lang, i) => `<Say>For ${lang}, press ${i + 1}</Say>`)
      .join('\n      ')
    return this.twiml(`
      <Response>
        <Gather numDigits="1" action="/telephony/language-selected${hp}" method="POST" timeout="8">
          ${langOptions}
        </Gather>
        <Redirect method="POST">/telephony/language-selected?auto=1${hp ? `&amp;${hp.slice(1)}` : ''}</Redirect>
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
          <Gather numDigits="${params.captchaDigits.length}" action="/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST" timeout="10">
            <Say>Please enter the digits: ${params.captchaDigits.split('').join(', ')}</Say>
          </Gather>
          <Hangup/>
        </Response>
      `)
    }

    return this.twiml(`
      <Response>
        <Say>Welcome to ${params.hotlineName}.</Say>
        <Enqueue waitUrl="/telephony/wait-music?lang=${lang}${hp}" action="/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST">${params.callSid}</Enqueue>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    if (params.digits === params.expectedDigits) {
      return this.twiml(`
        <Response>
          <Enqueue waitUrl="/telephony/wait-music?lang=${params.callerLanguage}${hp}" method="POST">${params.callSid}</Enqueue>
        </Response>
      `)
    }

    // Retry: re-Gather with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      return this.twiml(`
        <Response>
          <Gather numDigits="${params.newCaptchaDigits.length}" action="/telephony/captcha?callSid=${params.callSid}&amp;lang=${params.callerLanguage}${hp}" method="POST" timeout="10">
            <Say>That was incorrect. Please try again: ${params.newCaptchaDigits.split('').join(', ')}</Say>
          </Gather>
          <Redirect method="POST">/telephony/captcha?callSid=${params.callSid}&amp;lang=${params.callerLanguage}${hp}</Redirect>
        </Response>
      `)
    }

    return this.twiml('<Response><Hangup/></Response>')
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    return this.twiml(`
      <Response>
        <Dial record="record-from-answer" recordingStatusCallback="${params.callbackUrl}/telephony/call-recording?parentCallSid=${params.parentCallSid}&amp;pubkey=${params.userPubkey}${hp}" recordingStatusCallbackEvent="completed">
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
        <Record maxLength="${params.maxRecordingSeconds ?? 120}" action="/telephony/voicemail-complete?callSid=${params.callSid}&amp;lang=${params.callerLanguage}${hp}" recordingStatusCallback="${params.callbackUrl}/telephony/voicemail-recording?callSid=${params.callSid}${hp}" recordingStatusCallbackEvent="completed" />
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
        <Say>Please hold. Someone will be with you shortly.</Say>
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

  handleUnavailable(_lang: string, _audioUrls?: AudioUrlMap): TelephonyResponse {
    return this.twiml(`
      <Response>
        <Say>We are sorry, no one is available to take your call at this time. Please try again later. Goodbye.</Say>
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
  async ringUsers(_params: RingUsersParams): Promise<string[]> {
    return []
  }
  async cancelRinging(_callSids: string[], _exceptSid?: string): Promise<void> {}

  // --- Webhook Validation (always passes) ---

  async validateWebhook(_request: Request): Promise<boolean> {
    return true
  }

  // --- Recording (not available in test) ---

  deletedRecordings: string[] = []

  async getCallRecording(_callSid: string): Promise<ArrayBuffer | null> {
    return null
  }
  async getRecordingAudio(_recordingSid: string): Promise<ArrayBuffer | null> {
    return null
  }
  async deleteRecording(recordingSid: string): Promise<void> {
    this.deletedRecordings.push(recordingSid)
  }

  // --- Webhook Parsing (Twilio form-body format) ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const fields = await this.parseWebhookBody(request)
    return {
      callSid: fields.CallSid,
      callerNumber: fields.From,
      calledNumber: fields.To || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const fields = await this.parseWebhookBody(request)
    return {
      callSid: fields.CallSid,
      callerNumber: fields.From,
      digits: fields.Digits || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const fields = await this.parseWebhookBody(request)
    return {
      digits: fields.Digits || '',
      callerNumber: fields.From || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const fields = await this.parseWebhookBody(request)
    const raw = fields.CallStatus
    const STATUS_MAP: Record<string, WebhookCallStatus['status']> = {
      initiated: 'initiated',
      ringing: 'ringing',
      'in-progress': 'answered',
      answered: 'answered',
      completed: 'completed',
      busy: 'busy',
      'no-answer': 'no-answer',
      failed: 'failed',
      canceled: 'failed',
    }
    return { status: STATUS_MAP[raw] ?? 'failed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const fields = await this.parseWebhookBody(request)
    return { queueTime: Number.parseInt(fields.QueueTime || '0', 10) }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const fields = await this.parseWebhookBody(request)
    const raw = fields.QueueResult
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
    const fields = await this.parseWebhookBody(request)
    const raw = fields.RecordingStatus
    return {
      status: raw === 'completed' ? 'completed' : 'failed',
      recordingSid: fields.RecordingSid || undefined,
      callSid: fields.CallSid || undefined,
    }
  }

  // --- Health ---

  async testConnection(): Promise<ConnectionTestResult> {
    return { connected: true, latencyMs: 0 }
  }

  async verifyWebhookConfig(
    _phoneNumber: string,
    expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    return {
      configured: true,
      expectedUrl: `${expectedBaseUrl}/telephony/incoming`,
      actualUrl: `${expectedBaseUrl}/telephony/incoming`,
    }
  }
}
