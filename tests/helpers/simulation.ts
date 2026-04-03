import type { APIRequestContext } from '@playwright/test'
import type { PlivoInboundSMS } from '@shared/schemas/external/plivo-sms'
import type {
  PlivoCallStatusCallback,
  PlivoIncomingCall,
  PlivoRecordingCallback,
} from '@shared/schemas/external/plivo-voice'
import type { AsteriskBridgeWebhook } from '@shared/schemas/external/sip-bridge'
import type { TwilioInboundSMS, TwilioStatusCallback } from '@shared/schemas/external/twilio-sms'
import type {
  TwilioCallStatusCallback,
  TwilioIncomingCall,
  TwilioRecordingStatusCallback,
} from '@shared/schemas/external/twilio-voice'
import type { VonageInboundSMS } from '@shared/schemas/external/vonage-sms'
import type {
  VonageCallStatusEvent,
  VonageIncomingCall,
  VonageRecordingEvent,
} from '@shared/schemas/external/vonage-voice'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

export type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'
export type MessagingProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'meta'
export type MessagingChannel = 'sms' | 'whatsapp' | 'signal' | 'rcs'

// ─────────────────────────────────────────────────────────────────────────────
// Provider-specific payload builders for telephony
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build provider-specific content type and body for telephony webhooks.
 *
 * - Twilio & SignalWire & Plivo: application/x-www-form-urlencoded
 * - Vonage & Asterisk: application/json
 */

function buildIncomingCallPayload(
  provider: TelephonyProvider,
  params: SimulateCallParams
): { contentType: string; body: string | Record<string, unknown> } {
  const callSid = params.callSid || `CA_sim_${Date.now()}`
  const from = params.callerNumber || '+15550001111'
  const to = params.calledNumber || '+15559998888'

  switch (provider) {
    case 'twilio':
    case 'signalwire':
      return {
        contentType: 'application/x-www-form-urlencoded',
        body: formEncode({
          CallSid: callSid,
          From: from,
          To: to,
          CallStatus: 'ringing',
          Direction: 'inbound',
        } satisfies Partial<TwilioIncomingCall>),
      }
    case 'plivo':
      return {
        contentType: 'application/x-www-form-urlencoded',
        body: formEncode({
          CallUUID: callSid,
          From: from,
          To: to,
          CallStatus: 'ringing',
          Direction: 'inbound',
        } satisfies Partial<PlivoIncomingCall>),
      }
    case 'vonage':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          uuid: callSid,
          conversation_uuid: callSid,
          from: from,
          to: to,
          status: 'started',
          direction: 'inbound',
        } satisfies Partial<VonageIncomingCall>),
      }
    case 'asterisk':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          channelId: callSid,
          callSid: callSid,
          callerNumber: from,
          from: from,
          calledNumber: to,
          to: to,
          state: 'Ring',
        } satisfies AsteriskBridgeWebhook),
      }
  }
}

function buildCallStatusPayload(
  provider: TelephonyProvider,
  params: SimulateCallParams
): { contentType: string; body: string | Record<string, unknown> } {
  const callSid = params.callSid || `CA_sim_${Date.now()}`
  const status = params.status || 'completed'

  switch (provider) {
    case 'twilio':
    case 'signalwire':
      return {
        contentType: 'application/x-www-form-urlencoded',
        body: formEncode({
          CallSid: callSid,
          CallStatus: status as TwilioCallStatusCallback['CallStatus'],
          CallDuration: '30',
        } satisfies Partial<TwilioCallStatusCallback>),
      }
    case 'plivo':
      return {
        contentType: 'application/x-www-form-urlencoded',
        body: formEncode({
          CallUUID: callSid,
          CallStatus: status as PlivoCallStatusCallback['CallStatus'],
          Duration: '30',
        } satisfies Partial<PlivoCallStatusCallback>),
      }
    case 'vonage':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          uuid: callSid,
          conversation_uuid: callSid,
          status: status as VonageCallStatusEvent['status'],
          duration: '30',
        } satisfies Partial<VonageCallStatusEvent>),
      }
    case 'asterisk':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          channelId: callSid,
          callSid: callSid,
          state: status as AsteriskBridgeWebhook['state'],
          status: status,
          duration: 30,
        } satisfies AsteriskBridgeWebhook),
      }
  }
}

function buildRecordingPayload(
  provider: TelephonyProvider,
  params: SimulateCallParams
): { contentType: string; body: string | Record<string, unknown> } {
  const callSid = params.callSid || `CA_sim_${Date.now()}`
  const recordingSid = params.recordingSid || `RE_sim_${Date.now()}`

  switch (provider) {
    case 'twilio':
    case 'signalwire':
      return {
        contentType: 'application/x-www-form-urlencoded',
        body: formEncode({
          CallSid: callSid,
          RecordingStatus: 'completed',
          RecordingSid: recordingSid,
          RecordingUrl: `https://api.twilio.com/recordings/${recordingSid}`,
        } satisfies Partial<TwilioRecordingStatusCallback>),
      }
    case 'plivo':
      return {
        contentType: 'application/x-www-form-urlencoded',
        body: formEncode({
          CallUUID: callSid,
          RecordUrl: `https://api.plivo.com/recordings/${recordingSid}`,
          RecordingID: recordingSid,
        } satisfies Partial<PlivoRecordingCallback>),
      }
    case 'vonage':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          conversation_uuid: callSid,
          recording_url: `https://api.vonage.com/recordings/${recordingSid}`,
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
        } satisfies Partial<VonageRecordingEvent>),
      }
    case 'asterisk':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          channelId: callSid,
          callSid: callSid,
          recordingStatus: 'done',
          recordingName: recordingSid,
          recordingSid: recordingSid,
        } satisfies AsteriskBridgeWebhook),
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider-specific payload builders for messaging
// ─────────────────────────────────────────────────────────────────────────────

function buildIncomingMessagePayload(
  provider: MessagingProvider,
  channel: MessagingChannel,
  params: SimulateMessageParams
): { contentType: string; body: string | Record<string, unknown> } {
  const messageSid = params.messageSid || `SM_sim_${Date.now()}`
  const from = params.senderNumber || '+15550001111'
  const messageBody = params.body || 'Test message'

  // SMS channel
  if (channel === 'sms') {
    switch (provider) {
      case 'twilio':
      case 'signalwire':
      case 'asterisk': // Asterisk SMS delegates to an external provider (Twilio-compatible)
        return {
          contentType: 'application/x-www-form-urlencoded',
          body: formEncode({
            ...({
              MessageSid: messageSid,
              From: from,
              To: '+15559998888',
              Body: messageBody,
              NumMedia: params.mediaUrl ? '1' : '0',
            } satisfies Partial<TwilioInboundSMS>),
            ...(params.mediaUrl ? { MediaUrl0: params.mediaUrl } : {}),
            ...(params.mediaType ? { MediaContentType0: params.mediaType } : {}),
          }),
        }
      case 'plivo':
        return {
          contentType: 'application/x-www-form-urlencoded',
          body: formEncode({
            ...({
              MessageUUID: messageSid,
              From: from,
              To: '+15559998888',
              Text: messageBody,
              Type: 'sms',
            } satisfies Partial<PlivoInboundSMS>),
            ...(params.mediaUrl ? { Media0: params.mediaUrl } : {}),
          }),
        }
      case 'vonage':
        return {
          contentType: 'application/json',
          body: JSON.stringify({
            messageId: messageSid,
            msisdn: from.replace(/^\+/, ''),
            to: '15559998888',
            text: messageBody,
            type: 'text',
            'message-timestamp': new Date().toISOString(),
          } satisfies Partial<VonageInboundSMS>),
        }
      case 'meta':
        // Meta doesn't do SMS
        return {
          contentType: 'application/json',
          body: JSON.stringify({}),
        }
    }
  }

  // WhatsApp channel
  if (channel === 'whatsapp') {
    switch (provider) {
      case 'twilio':
      case 'signalwire':
        return {
          contentType: 'application/x-www-form-urlencoded',
          body: formEncode({
            ...({
              MessageSid: messageSid,
              From: `whatsapp:${from}`,
              To: 'whatsapp:+15559998888',
              Body: messageBody,
              NumMedia: params.mediaUrl ? '1' : '0',
            } satisfies Partial<TwilioInboundSMS>),
            ...(params.mediaUrl ? { MediaUrl0: params.mediaUrl } : {}),
            ...(params.mediaType ? { MediaContentType0: params.mediaType } : {}),
          }),
        }
      case 'meta':
        return {
          contentType: 'application/json',
          body: JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [
              {
                id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
                changes: [
                  {
                    value: {
                      messaging_product: 'whatsapp',
                      messages: [
                        {
                          id: messageSid,
                          from: from.replace(/^\+/, ''),
                          timestamp: String(Math.floor(Date.now() / 1000)),
                          type: 'text',
                          text: { body: messageBody },
                        },
                      ],
                      contacts: [
                        {
                          profile: { name: 'Test User' },
                          wa_id: from.replace(/^\+/, ''),
                        },
                      ],
                    },
                    field: 'messages',
                  },
                ],
              },
            ],
          }),
        }
      default:
        // Other providers don't typically do WhatsApp
        return {
          contentType: 'application/json',
          body: JSON.stringify({}),
        }
    }
  }

  // Signal channel
  if (channel === 'signal') {
    // Signal uses JSON from signal-cli-rest-api
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        envelope: {
          source: from,
          sourceUuid: `signal-uuid-${from}`,
          sourceName: 'Test User',
          sourceDevice: 1,
          timestamp: Date.now(),
          dataMessage: {
            message: messageBody,
            timestamp: Date.now(),
            ...(params.mediaUrl
              ? {
                  attachments: [
                    {
                      id: `att_${Date.now()}`,
                      contentType: params.mediaType || 'image/png',
                    },
                  ],
                }
              : {}),
          },
        },
      }),
    }
  }

  // RCS channel
  if (channel === 'rcs') {
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        agentId: 'test-agent',
        senderId: from,
        message: {
          messageId: messageSid,
          text: messageBody,
          sendTime: new Date().toISOString(),
          ...(params.mediaUrl
            ? {
                userFile: {
                  payload: {
                    fileUri: params.mediaUrl,
                    mimeType: params.mediaType || 'image/png',
                  },
                },
              }
            : {}),
        },
      }),
    }
  }

  // Fallback (shouldn't reach here with valid channel)
  return { contentType: 'application/json', body: JSON.stringify({}) }
}

function buildDeliveryStatusPayload(
  provider: MessagingProvider,
  channel: MessagingChannel,
  params: SimulateMessageParams
): { contentType: string; body: string | Record<string, unknown> } {
  const messageSid = params.messageSid || `SM_sim_${Date.now()}`
  const status = params.status || 'delivered'

  if (channel === 'sms' || (channel === 'whatsapp' && provider !== 'meta')) {
    switch (provider) {
      case 'twilio':
      case 'signalwire':
      case 'asterisk':
        return {
          contentType: 'application/x-www-form-urlencoded',
          body: formEncode({
            ...({
              MessageSid: messageSid,
              MessageStatus: status as TwilioStatusCallback['MessageStatus'],
            } satisfies Partial<TwilioStatusCallback>),
            ...(params.errorCode ? { ErrorCode: params.errorCode } : {}),
          }),
        }
      default:
        return { contentType: 'application/json', body: JSON.stringify({}) }
    }
  }

  if (channel === 'whatsapp' && provider === 'meta') {
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [
                    {
                      id: messageSid,
                      status: status,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      }),
    }
  }

  // Signal/RCS don't have standard delivery status webhooks via the same route
  return { contentType: 'application/json', body: JSON.stringify({}) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function hubQuery(hubId?: string): string {
  return hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Telephony simulation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulate an incoming call webhook by POSTing to /telephony/incoming.
 * Uses the provider-specific payload format that the TelephonyAdapter parses.
 */
export async function simulateIncomingCall(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const { contentType, body } = buildIncomingCallPayload(provider, params)
  const res = await request.post(`/telephony/incoming${hubQuery(params.hubId)}`, {
    headers: { 'Content-Type': contentType },
    data: body,
  })
  return { status: res.status(), body: await res.text() }
}

/**
 * Simulate a call status callback by POSTing to /telephony/call-status.
 * The parentCallSid is passed as a query parameter (as Twilio does via callback URL).
 * Defaults to status 'completed' to simulate call hangup.
 */
export async function simulateEndCall(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const resolvedParams = { ...params, status: params.status || 'completed' }
  const { contentType, body } = buildCallStatusPayload(provider, resolvedParams)
  const queryParts: string[] = []
  if (params.parentCallSid)
    queryParts.push(`parentCallSid=${encodeURIComponent(params.parentCallSid)}`)
  if (params.userPubkey) queryParts.push(`pubkey=${encodeURIComponent(params.userPubkey)}`)
  if (params.hubId) queryParts.push(`hub=${encodeURIComponent(params.hubId)}`)
  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  const res = await request.post(`/telephony/call-status${query}`, {
    headers: { 'Content-Type': contentType },
    data: body,
  })
  return { status: res.status(), body: await res.text() }
}

/**
 * Simulate a voicemail recording webhook by POSTing to /telephony/voicemail-recording.
 * This is the recording status callback fired after a voicemail is recorded.
 */
export async function simulateVoicemail(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const { contentType, body } = buildRecordingPayload(provider, params)
  const queryParts: string[] = []
  if (params.callSid) queryParts.push(`callSid=${encodeURIComponent(params.callSid)}`)
  if (params.hubId) queryParts.push(`hub=${encodeURIComponent(params.hubId)}`)
  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  const res = await request.post(`/telephony/voicemail-recording${query}`, {
    headers: { 'Content-Type': contentType },
    data: body,
  })
  return { status: res.status(), body: await res.text() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging simulation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulate an incoming message webhook by POSTing to /api/messaging/:channel/webhook.
 * Uses provider-specific payload format that the MessagingAdapter parses.
 *
 * Routes:
 *   - SMS:      POST /api/messaging/sms/webhook
 *   - WhatsApp: POST /api/messaging/whatsapp/webhook
 *   - Signal:   POST /api/messaging/signal/webhook
 *   - RCS:      POST /api/messaging/rcs/webhook
 */
export async function simulateIncomingMessage(
  request: APIRequestContext,
  provider: MessagingProvider,
  channel: MessagingChannel,
  params: SimulateMessageParams = {}
): Promise<{ status: number; body: string }> {
  const { contentType, body } = buildIncomingMessagePayload(provider, channel, params)
  const res = await request.post(`/api/messaging/${channel}/webhook${hubQuery(params.hubId)}`, {
    headers: { 'Content-Type': contentType },
    data: body,
  })
  return { status: res.status(), body: await res.text() }
}

/**
 * Simulate a delivery status webhook by POSTing to /api/messaging/:channel/webhook.
 * Delivery status updates go to the same webhook route as incoming messages;
 * the adapter's parseStatusWebhook method differentiates them.
 */
export async function simulateDeliveryStatus(
  request: APIRequestContext,
  provider: MessagingProvider,
  channel: MessagingChannel,
  params: SimulateMessageParams = {}
): Promise<{ status: number; body: string }> {
  const { contentType, body } = buildDeliveryStatusPayload(provider, channel, params)
  const res = await request.post(`/api/messaging/${channel}/webhook${hubQuery(params.hubId)}`, {
    headers: { 'Content-Type': contentType },
    data: body,
  })
  return { status: res.status(), body: await res.text() }
}
