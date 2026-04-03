import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { MessagingChannelType } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { TelnyxCallControlClient } from '../../telephony/telnyx-api'
import type { MessageDeliveryStatus } from '../../types'
import type {
  ChannelStatus,
  IncomingMessage,
  MessageStatusUpdate,
  MessagingAdapter,
  SendMediaParams,
  SendMessageParams,
  SendResult,
} from '../adapter'

/**
 * TelnyxSMSAdapter — Telnyx Messaging API v2 implementation.
 *
 * Telnyx uses JSON webhooks (not form-encoded like Twilio),
 * ed25519 signature verification, and a REST API at api.telnyx.com/v2/messages.
 */
export class TelnyxSMSAdapter implements MessagingAdapter {
  readonly channelType: MessagingChannelType = 'sms' as const

  private apiKey: string
  private phoneNumber: string
  private crypto: CryptoService
  private telnyxClient: TelnyxCallControlClient

  constructor(apiKey: string, phoneNumber: string, crypto: CryptoService) {
    this.apiKey = apiKey
    this.phoneNumber = phoneNumber
    this.crypto = crypto
    this.telnyxClient = new TelnyxCallControlClient(apiKey)
  }

  async parseIncomingMessage(request: Request): Promise<IncomingMessage> {
    const body = (await request.clone().json()) as TelnyxWebhookEvent
    const payload = body.data?.payload ?? body.data

    const from = payload?.from?.phone_number ?? ''
    const text = payload?.text ?? undefined
    const id = payload?.id ?? ''

    const mediaUrls: string[] = []
    const mediaTypes: string[] = []
    if (Array.isArray(payload?.media)) {
      for (const m of payload.media) {
        if (m.url) mediaUrls.push(m.url)
        if (m.content_type) mediaTypes.push(m.content_type)
      }
    }

    return {
      channelType: this.channelType,
      externalId: id,
      senderIdentifier: from,
      senderIdentifierHash: this.crypto.hmac(from, HMAC_PHONE_PREFIX),
      body: text,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      mediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
      timestamp: payload?.received_at ?? new Date().toISOString(),
      metadata: {
        to: payload?.to?.[0]?.phone_number ?? this.phoneNumber,
      },
    }
  }

  async validateWebhook(request: Request): Promise<boolean> {
    const signature = request.headers.get('telnyx-signature-ed25519')
    const timestamp = request.headers.get('telnyx-timestamp')

    if (!signature || !timestamp) return false

    // Reject if timestamp is > 5 minutes old (replay attack prevention)
    const ts = Number.parseInt(timestamp, 10)
    if (Number.isNaN(ts)) return false
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > 300) return false

    try {
      const rawBody = await request.clone().text()
      return await this.telnyxClient.verifyWebhookSignature(signature, timestamp, rawBody)
    } catch {
      return false
    }
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const body = {
      from: this.phoneNumber,
      to: params.recipientIdentifier,
      text: params.body,
    }

    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = (await res.json()) as { data?: { id?: string } }
      return { success: true, externalId: data.data?.id ?? '' }
    }

    const errorData = (await res.json().catch(() => null)) as {
      errors?: Array<{ detail?: string }>
    } | null
    return {
      success: false,
      error: errorData?.errors?.[0]?.detail ?? `Telnyx API returned ${res.status}`,
    }
  }

  async sendMediaMessage(params: SendMediaParams): Promise<SendResult> {
    const body = {
      from: this.phoneNumber,
      to: params.recipientIdentifier,
      text: params.body,
      media_urls: [params.mediaUrl],
    }

    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = (await res.json()) as { data?: { id?: string } }
      return { success: true, externalId: data.data?.id ?? '' }
    }

    const errorData = (await res.json().catch(() => null)) as {
      errors?: Array<{ detail?: string }>
    } | null
    return {
      success: false,
      error: errorData?.errors?.[0]?.detail ?? `Telnyx API returned ${res.status}`,
    }
  }

  async getChannelStatus(): Promise<ChannelStatus> {
    try {
      // Verify API key by fetching messaging profile
      const res = await fetch('https://api.telnyx.com/v2/messaging_profiles', {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })

      if (res.ok) {
        return {
          connected: true,
          details: {
            provider: 'telnyx',
            channel: 'sms',
            phoneNumber: this.phoneNumber,
          },
        }
      }

      return {
        connected: false,
        error: `Telnyx API returned ${res.status}`,
      }
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : 'Unknown error connecting to Telnyx',
      }
    }
  }

  async parseStatusWebhook(request: Request): Promise<MessageStatusUpdate | null> {
    try {
      const body = (await request.clone().json()) as TelnyxWebhookEvent
      const payload = body.data?.payload ?? body.data
      const eventType = body.data?.event_type ?? ''
      const id = payload?.id ?? ''

      if (!id) return null

      // Map Telnyx event types to normalized status
      const statusMap: Record<string, MessageDeliveryStatus> = {
        'message.sent': 'sent',
        'message.finalized': 'delivered',
        'message.failed': 'failed',
      }

      const status = statusMap[eventType]
      if (!status) return null

      return {
        externalId: id,
        status,
        failureReason:
          status === 'failed' && Array.isArray(payload?.errors)
            ? payload.errors.map((e: { detail?: string }) => e.detail).join('; ')
            : undefined,
        timestamp: payload?.completed_at ?? payload?.sent_at ?? new Date().toISOString(),
      }
    } catch {
      return null
    }
  }
}

// Telnyx webhook event structure (v2 API)
interface TelnyxWebhookEvent {
  data: {
    event_type: string
    id: string
    occurred_at: string
    payload: {
      id: string
      direction: string
      from?: { phone_number: string; carrier?: string; line_type?: string }
      to?: Array<{ phone_number: string }>
      text?: string
      media?: Array<{ url: string; content_type: string }>
      received_at?: string
      sent_at?: string
      completed_at?: string
      errors?: Array<{ code: string; title: string; detail?: string }>
      [key: string]: unknown
    }
    record_type: string
  }
}
