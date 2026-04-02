/**
 * Test payload factory — generates realistic provider webhook payloads for E2E tests.
 * Only imported from dev-gated routes (ENVIRONMENT !== 'development' guard in dev.ts).
 * Build-time tree-shaking does not apply; runtime guard prevents production reachability.
 */

export type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'
export type TelephonyEvent =
  | 'incoming-call'
  | 'language-selected'
  | 'captcha-response'
  | 'answer-call'
  | 'end-call'
  | 'queue-wait'
  | 'queue-exit'
  | 'recording-complete'
  | 'voicemail'

export type MessagingChannel = 'sms' | 'whatsapp' | 'signal' | 'rcs'
export type MessagingEvent = 'incoming-message' | 'delivery-status'

export type MessagingProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'meta'

export interface SimulateCallParams {
  callSid?: string
  callerNumber?: string
  calledNumber?: string
  digits?: string
  status?: string
  parentCallSid?: string
  userPubkey?: string
  recordingSid?: string
  hubId?: string
}

export interface SimulateMessageParams {
  messageSid?: string
  senderNumber?: string
  body?: string
  mediaUrl?: string
  mediaType?: string
  status?: string
  errorCode?: string
  hubId?: string
}

/** Shape returned by all factory functions */
export interface FactoryResult {
  /** Serialized body — form-encoded string or JSON string */
  body: string
  contentType: string
  /** Headers to include in the simulated webhook POST */
  headers: Record<string, string>
  /** Webhook path to POST to (e.g. '/telephony/incoming') */
  path: string
}

/** Encode an object as application/x-www-form-urlencoded */
export function encodeForm(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

/** Generate a random SID in the style of each provider */
export function randomCallSid(provider: TelephonyProvider): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (provider === 'twilio' || provider === 'signalwire') return `CA${hex}`
  if (provider === 'vonage') return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`
  if (provider === 'plivo') return hex.toUpperCase()
  return `ast-${hex.slice(0, 12)}`
}

export function randomMessageSid(provider: MessagingProvider): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return provider === 'twilio' || provider === 'signalwire' ? `SM${hex}` : hex
}

// -------------------------------------------------------------------
// Asterisk — JSON from ARI bridge
// Validation: X-Bridge-Signature (HMAC-SHA256) + X-Bridge-Timestamp
// Bypassed in dev by telephony router middleware (CF-Connecting-IP check)
// -------------------------------------------------------------------

export function buildAsteriskTelephonyPayload(
  event: TelephonyEvent,
  params: SimulateCallParams
): FactoryResult {
  const callSid = params.callSid ?? randomCallSid('asterisk')
  const callerNumber = params.callerNumber ?? '+15555550100'
  const calledNumber = params.calledNumber ?? '+18005550100'
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  // ARI bridge events all share the same base shape
  type AriBody = Record<string, string | number | Record<string, string>>

  switch (event) {
    case 'incoming-call': {
      const body: AriBody = {
        event: 'incoming',
        channelId: callSid,
        callerNumber,
        calledNumber,
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/incoming${hubQ}`,
      }
    }
    case 'language-selected': {
      const body: AriBody = {
        event: 'digits',
        channelId: callSid,
        digits: params.digits ?? '1',
        callerNumber,
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/language-selected${hubQ}`,
      }
    }
    case 'captcha-response': {
      const body: AriBody = {
        event: 'digits',
        channelId: callSid,
        digits: params.digits ?? '5',
        callerNumber,
        metadata: { type: 'captcha' },
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/captcha${hubQ}`,
      }
    }
    case 'answer-call': {
      const body: AriBody = { event: 'status', channelId: callSid, state: 'up' }
      const qp = new URLSearchParams()
      if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
      if (params.userPubkey) qp.set('pubkey', params.userPubkey)
      if (params.hubId) qp.set('hub', params.hubId)
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/user-answer${qp.size ? `?${qp}` : ''}`,
      }
    }
    case 'end-call': {
      const body: AriBody = {
        event: 'status',
        channelId: callSid,
        state: 'down',
        status: params.status ?? 'completed',
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/call-status${hubQ}`,
      }
    }
    case 'queue-wait': {
      const body: AriBody = { event: 'queue_wait', channelId: callSid, queueTime: 30 }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/wait-music${hubQ}`,
      }
    }
    case 'queue-exit': {
      const body: AriBody = {
        event: 'queue_exit',
        channelId: callSid,
        result: 'bridged',
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/queue-exit${hubQ}`,
      }
    }
    case 'recording-complete': {
      const recordingName = params.recordingSid ?? `rec-${callSid}`
      const body: AriBody = {
        event: 'recording',
        channelId: callSid,
        recordingStatus: 'done', // adapter maps 'done' → 'completed'
        recordingName,
        recordingSid: recordingName,
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/call-recording${hubQ}`,
      }
    }
    case 'voicemail': {
      const recordingName = params.recordingSid ?? `voicemail-${callSid}`
      const body: AriBody = {
        event: 'recording',
        channelId: callSid,
        recordingStatus: 'done', // adapter maps 'done' → 'completed'
        recordingName,
        recordingSid: recordingName,
      }
      return {
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: {},
        path: `/telephony/voicemail-recording${hubQ}`,
      }
    }
  }
}

// -------------------------------------------------------------------
// Twilio + SignalWire — form-encoded
// Validation: HMAC-SHA1 via X-Twilio-Signature (or X-SignalWire-Signature)
// Bypassed in dev via telephony router middleware
// -------------------------------------------------------------------

export function buildTwilioTelephonyPayload(
  event: TelephonyEvent,
  params: SimulateCallParams,
  provider: 'twilio' | 'signalwire' = 'twilio'
): FactoryResult {
  const callSid = params.callSid ?? randomCallSid(provider)
  const callerNumber = params.callerNumber ?? '+15555550100'
  const calledNumber = params.calledNumber ?? '+18005550100'
  const hubQ = params.hubId ? `hub=${params.hubId}` : ''
  const sep = hubQ ? '?' : ''

  const form = (fields: Record<string, string>, path: string): FactoryResult => ({
    body: encodeForm(fields),
    contentType: 'application/x-www-form-urlencoded',
    headers: {},
    path,
  })

  switch (event) {
    case 'incoming-call':
      return form(
        { CallSid: callSid, From: callerNumber, To: calledNumber },
        `/telephony/incoming${sep}${hubQ}`
      )
    case 'language-selected':
      return form(
        { CallSid: callSid, From: callerNumber, Digits: params.digits ?? '1' },
        `/telephony/language-selected${sep}${hubQ}`
      )
    case 'captcha-response':
      return form(
        { Digits: params.digits ?? '5', From: callerNumber },
        `/telephony/captcha${sep}${hubQ}`
      )
    case 'answer-call': {
      const qp = new URLSearchParams()
      if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
      if (params.userPubkey) qp.set('pubkey', params.userPubkey)
      if (params.hubId) qp.set('hub', params.hubId)
      return form(
        { CallSid: callSid, CallStatus: 'in-progress' },
        `/telephony/user-answer${qp.size ? `?${qp}` : ''}`
      )
    }
    case 'end-call':
      return form(
        { CallSid: callSid, CallStatus: params.status ?? 'completed' },
        `/telephony/call-status${sep}${hubQ}`
      )
    case 'queue-wait':
      return form({ QueueTime: '30' }, `/telephony/wait-music${sep}${hubQ}`)
    case 'queue-exit':
      return form(
        { QueueResult: 'bridged', CallSid: callSid },
        `/telephony/queue-exit${sep}${hubQ}`
      )
    case 'recording-complete': {
      const recordingSid = params.recordingSid ?? `RE${callSid.slice(2)}`
      return form(
        { RecordingStatus: 'completed', RecordingSid: recordingSid, CallSid: callSid },
        `/telephony/call-recording${sep}${hubQ}`
      )
    }
    case 'voicemail': {
      const recordingSid = params.recordingSid ?? `RE${callSid.slice(2)}`
      return form(
        { RecordingStatus: 'completed', RecordingSid: recordingSid, CallSid: callSid },
        `/telephony/voicemail-recording${sep}${hubQ}`
      )
    }
  }
}

// -------------------------------------------------------------------
// Vonage — JSON
// Validation: HMAC-SHA256 via query param signature + 5-min timestamp
// Bypassed in dev via telephony router middleware
// -------------------------------------------------------------------

export function buildVonageTelephonyPayload(
  event: TelephonyEvent,
  params: SimulateCallParams
): FactoryResult {
  const callSid = params.callSid ?? randomCallSid('vonage')
  const callerNumber = params.callerNumber ?? '+15555550100'
  const calledNumber = params.calledNumber ?? '+18005550100'
  const hubQ = params.hubId ? `hub=${params.hubId}` : ''
  const sep = hubQ ? '?' : ''

  const json = (body: unknown, path: string): FactoryResult => ({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: {},
    path,
  })

  switch (event) {
    case 'incoming-call':
      return json(
        { uuid: callSid, conversation_uuid: callSid, from: callerNumber, to: calledNumber },
        `/telephony/incoming${sep}${hubQ}`
      )
    case 'language-selected':
      return json(
        {
          uuid: callSid,
          conversation_uuid: callSid,
          from: callerNumber,
          dtmf: { digits: params.digits ?? '1' },
        },
        `/telephony/language-selected${sep}${hubQ}`
      )
    case 'captcha-response':
      return json(
        { from: callerNumber, dtmf: { digits: params.digits ?? '5' } },
        `/telephony/captcha${sep}${hubQ}`
      )
    case 'answer-call': {
      const qp = new URLSearchParams()
      if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
      if (params.userPubkey) qp.set('pubkey', params.userPubkey)
      if (params.hubId) qp.set('hub', params.hubId)
      return json(
        { uuid: callSid, conversation_uuid: callSid, status: 'answered' },
        `/telephony/user-answer${qp.size ? `?${qp}` : ''}`
      )
    }
    case 'end-call':
      return json(
        { uuid: callSid, conversation_uuid: callSid, status: params.status ?? 'completed' },
        `/telephony/call-status${sep}${hubQ}`
      )
    case 'queue-wait':
      return json({ uuid: callSid, duration: 30 }, `/telephony/wait-music${sep}${hubQ}`)
    case 'queue-exit':
      return json({ uuid: callSid, status: 'answered' }, `/telephony/queue-exit${sep}${hubQ}`)
    case 'recording-complete':
      return json(
        { uuid: callSid, recording_url: `https://api.nexmo.com/media/download?id=${callSid}` },
        `/telephony/call-recording${sep}${hubQ}`
      )
    case 'voicemail':
      return json(
        { uuid: callSid, recording_url: `https://api.nexmo.com/media/download?id=${callSid}` },
        `/telephony/voicemail-recording${sep}${hubQ}`
      )
  }
}

// -------------------------------------------------------------------
// Plivo — form-encoded
// Validation: HMAC-SHA256 via X-Plivo-Signature-V3 + nonce header
// Bypassed in dev via telephony router middleware
// -------------------------------------------------------------------

export function buildPlivoTelephonyPayload(
  event: TelephonyEvent,
  params: SimulateCallParams
): FactoryResult {
  const callSid = params.callSid ?? randomCallSid('plivo')
  const callerNumber = params.callerNumber ?? '+15555550100'
  const calledNumber = params.calledNumber ?? '+18005550100'
  const hubQ = params.hubId ? `hub=${params.hubId}` : ''
  const sep = hubQ ? '?' : ''

  const form = (fields: Record<string, string>, path: string): FactoryResult => ({
    body: encodeForm(fields),
    contentType: 'application/x-www-form-urlencoded',
    headers: {},
    path,
  })

  switch (event) {
    case 'incoming-call':
      return form(
        { CallUUID: callSid, From: callerNumber, To: calledNumber },
        `/telephony/incoming${sep}${hubQ}`
      )
    case 'language-selected':
      return form(
        { CallUUID: callSid, From: callerNumber, Digits: params.digits ?? '1' },
        `/telephony/language-selected${sep}${hubQ}`
      )
    case 'captcha-response':
      return form(
        { Digits: params.digits ?? '5', From: callerNumber },
        `/telephony/captcha${sep}${hubQ}`
      )
    case 'answer-call': {
      const qp = new URLSearchParams()
      if (params.parentCallSid) qp.set('parentCallSid', params.parentCallSid)
      if (params.userPubkey) qp.set('pubkey', params.userPubkey)
      if (params.hubId) qp.set('hub', params.hubId)
      return form(
        { CallUUID: callSid, CallStatus: 'in-progress' },
        `/telephony/user-answer${qp.size ? `?${qp}` : ''}`
      )
    }
    case 'end-call':
      return form(
        { CallUUID: callSid, CallStatus: params.status ?? 'completed' },
        `/telephony/call-status${sep}${hubQ}`
      )
    case 'queue-wait':
      return form({ ConferenceDuration: '30' }, `/telephony/wait-music${sep}${hubQ}`)
    case 'queue-exit':
      return form(
        { ConferenceAction: 'enter', CallUUID: callSid },
        `/telephony/queue-exit${sep}${hubQ}`
      )
    case 'recording-complete': {
      const recordingId = params.recordingSid ?? `REC_${callSid}`
      return form(
        {
          RecordUrl: `https://api.plivo.com/recordings/${recordingId}.mp3`,
          RecordingID: recordingId,
          CallUUID: callSid,
        },
        `/telephony/call-recording${sep}${hubQ}`
      )
    }
    case 'voicemail': {
      const recordingId = params.recordingSid ?? `REC_${callSid}`
      return form(
        {
          RecordUrl: `https://api.plivo.com/recordings/${recordingId}.mp3`,
          RecordingID: recordingId,
          CallUUID: callSid,
        },
        `/telephony/voicemail-recording${sep}${hubQ}`
      )
    }
  }
}

/** Build a telephony webhook payload for any provider x event combination */
export function buildTelephonyPayload(
  provider: TelephonyProvider,
  event: TelephonyEvent,
  params: SimulateCallParams = {}
): FactoryResult {
  switch (provider) {
    case 'asterisk':
      return buildAsteriskTelephonyPayload(event, params)
    case 'twilio':
      return buildTwilioTelephonyPayload(event, params, 'twilio')
    case 'signalwire':
      return buildTwilioTelephonyPayload(event, params, 'signalwire')
    case 'vonage':
      return buildVonageTelephonyPayload(event, params)
    case 'plivo':
      return buildPlivoTelephonyPayload(event, params)
  }
}

// -------------------------------------------------------------------
// SMS messaging factories
// -------------------------------------------------------------------

function buildTwilioSmsPayload(
  event: MessagingEvent,
  params: SimulateMessageParams,
  channel: 'sms' = 'sms'
): FactoryResult {
  const msgSid = params.messageSid ?? randomMessageSid('twilio')
  const from = params.senderNumber ?? '+15555550200'
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  if (event === 'incoming-message') {
    const fields: Record<string, string> = {
      From: from,
      To: '+18005550100',
      Body: params.body ?? 'Test message',
      MessageSid: msgSid,
    }
    if (params.mediaUrl) {
      fields.NumMedia = '1'
      fields.MediaUrl0 = params.mediaUrl
      fields.MediaContentType0 = params.mediaType ?? 'image/jpeg'
    } else {
      fields.NumMedia = '0'
    }
    return {
      body: encodeForm(fields),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path: `/api/messaging/${channel}/webhook${hubQ}`,
    }
  }
  // delivery-status
  return {
    body: encodeForm({
      MessageSid: msgSid,
      MessageStatus: params.status ?? 'delivered',
      ...(params.errorCode ? { ErrorCode: params.errorCode } : {}),
    }),
    contentType: 'application/x-www-form-urlencoded',
    headers: {},
    path: `/api/messaging/${channel}/webhook${hubQ}`,
  }
}

function buildVonageSmsPayload(
  event: MessagingEvent,
  params: SimulateMessageParams
): FactoryResult {
  const msgId = params.messageSid ?? randomMessageSid('vonage')
  const from = (params.senderNumber ?? '+15555550200').replace('+', '')
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  if (event === 'incoming-message') {
    return {
      body: JSON.stringify({
        msisdn: from,
        messageId: msgId,
        text: params.body ?? 'Test message',
        to: '18005550100',
        type: 'text',
        'message-timestamp': new Date().toISOString(),
      }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/sms/webhook${hubQ}`,
    }
  }
  return {
    body: JSON.stringify({ messageId: msgId, status: params.status ?? 'delivered' }),
    contentType: 'application/json',
    headers: {},
    path: `/api/messaging/sms/webhook${hubQ}`,
  }
}

function buildPlivoSmsPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
  const msgId = params.messageSid ?? randomMessageSid('plivo')
  const from = params.senderNumber ?? '+15555550200'
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  if (event === 'incoming-message') {
    const fields: Record<string, string> = {
      From: from,
      To: '+18005550100',
      Text: params.body ?? 'Test message',
      MessageUUID: msgId,
    }
    if (params.mediaUrl) fields.Media0 = params.mediaUrl
    return {
      body: encodeForm(fields),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path: `/api/messaging/sms/webhook${hubQ}`,
    }
  }
  return {
    body: encodeForm({ MessageUUID: msgId, Status: params.status ?? 'delivered' }),
    contentType: 'application/x-www-form-urlencoded',
    headers: {},
    path: `/api/messaging/sms/webhook${hubQ}`,
  }
}

// -------------------------------------------------------------------
// WhatsApp — Meta Cloud API (JSON) and Twilio mode (form)
// -------------------------------------------------------------------

function buildWhatsappPayload(
  event: MessagingEvent,
  params: SimulateMessageParams,
  mode: 'meta' | 'twilio' = 'meta'
): FactoryResult {
  const msgId = params.messageSid ?? randomMessageSid('meta')
  const from = (params.senderNumber ?? '+15555550200').replace('+', '')
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  if (mode === 'twilio') {
    if (event === 'incoming-message') {
      return {
        body: encodeForm({
          From: `whatsapp:+${from}`,
          To: 'whatsapp:+18005550100',
          Body: params.body ?? 'Test message',
          MessageSid: msgId,
          NumMedia: '0',
        }),
        contentType: 'application/x-www-form-urlencoded',
        headers: {},
        path: `/api/messaging/whatsapp/webhook${hubQ}`,
      }
    }
    return {
      body: encodeForm({ MessageSid: msgId, MessageStatus: params.status ?? 'delivered' }),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      path: `/api/messaging/whatsapp/webhook${hubQ}`,
    }
  }

  // Meta Cloud API — nested entry/changes/value structure
  if (event === 'incoming-message') {
    return {
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: msgId,
                      from,
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      type: 'text',
                      text: { body: params.body ?? 'Test message' },
                    },
                  ],
                  contacts: [{ profile: { name: 'Test Caller' }, wa_id: from }],
                  metadata: {
                    phone_number_id: '123456789',
                    display_phone_number: '+18005550100',
                  },
                },
              },
            ],
          },
        ],
      }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/whatsapp/webhook${hubQ}`,
    }
  }
  // delivery-status
  return {
    body: JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: msgId,
                    status: params.status ?? 'delivered',
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    recipient_id: from,
                  },
                ],
                metadata: {
                  phone_number_id: '123456789',
                  display_phone_number: '+18005550100',
                },
              },
            },
          ],
        },
      ],
    }),
    contentType: 'application/json',
    headers: {},
    path: `/api/messaging/whatsapp/webhook${hubQ}`,
  }
}

// -------------------------------------------------------------------
// Signal (signal-cli bridge) and RCS (Google RBM)
// -------------------------------------------------------------------

function buildSignalPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
  const from = params.senderNumber ?? '+15555550200'
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  // signal-cli-rest-api bridge format — matches SignalWebhookPayload in signal/types.ts
  // Fields: envelope.source (phone), envelope.sourceUuid (optional), envelope.timestamp
  return {
    body: JSON.stringify({
      envelope: {
        source: from,
        sourceUuid: undefined,
        timestamp: Date.now(),
        dataMessage:
          event === 'incoming-message'
            ? { message: params.body ?? 'Test message', timestamp: Date.now() }
            : undefined,
      },
    }),
    contentType: 'application/json',
    headers: {},
    path: `/api/messaging/signal/webhook${hubQ}`,
  }
}

function buildRcsPayload(event: MessagingEvent, params: SimulateMessageParams): FactoryResult {
  const msgId = params.messageSid ?? randomMessageSid('twilio')
  const from = params.senderNumber ?? '+15555550200'
  const hubQ = params.hubId ? `?hub=${params.hubId}` : ''

  if (event === 'incoming-message') {
    return {
      body: JSON.stringify({
        message: { text: params.body ?? 'Test message', messageId: msgId },
        senderPhoneNumber: from,
        messageId: msgId,
      }),
      contentType: 'application/json',
      headers: {},
      path: `/api/messaging/rcs/webhook${hubQ}`,
    }
  }
  return {
    body: JSON.stringify({
      event: { deliveryStatus: params.status ?? 'DELIVERED', messageId: msgId },
      senderPhoneNumber: from,
    }),
    contentType: 'application/json',
    headers: {},
    path: `/api/messaging/rcs/webhook${hubQ}`,
  }
}

/** Build a messaging webhook payload for any provider x channel x event combination */
export function buildMessagingPayload(
  provider: MessagingProvider,
  channel: MessagingChannel,
  event: MessagingEvent,
  params: SimulateMessageParams = {}
): FactoryResult {
  if (channel === 'whatsapp') {
    return buildWhatsappPayload(event, params, provider === 'twilio' ? 'twilio' : 'meta')
  }
  if (channel === 'signal') return buildSignalPayload(event, params)
  if (channel === 'rcs') return buildRcsPayload(event, params)
  // sms
  switch (provider) {
    case 'vonage':
      return buildVonageSmsPayload(event, params)
    case 'plivo':
      return buildPlivoSmsPayload(event, params)
    case 'asterisk':
      return buildTwilioSmsPayload(event, params) // delegates to Twilio format
    default:
      return buildTwilioSmsPayload(event, params) // twilio + signalwire
  }
}
