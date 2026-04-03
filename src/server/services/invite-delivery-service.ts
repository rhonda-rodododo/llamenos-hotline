import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import { getMessagingAdapter } from '../lib/adapters'
import type { CryptoService } from '../lib/crypto-service'
import type { SettingsService } from './settings'

export type InviteDeliveryChannel = 'signal' | 'whatsapp' | 'sms'

export interface SendInviteParams {
  recipientPhone: string // E.164 format
  inviteCode: string
  channel: InviteDeliveryChannel
  expiresAt: Date
  appUrl: string
  crypto: CryptoService
}

export interface SendInviteResult {
  sent: boolean
  channel: InviteDeliveryChannel
  recipientPhoneHash: string
}

/**
 * InviteDeliveryService — sends invite links via Signal, WhatsApp, or SMS.
 *
 * Signal is the primary channel (encrypted). WhatsApp is fallback.
 * SMS is last resort and requires explicit insecure acknowledgment from the admin.
 *
 * Phone numbers are stored as HMAC hashes only — never in plaintext.
 */
export class InviteDeliveryService {
  constructor(private readonly settings: SettingsService) {}

  async sendInvite(params: SendInviteParams): Promise<SendInviteResult> {
    const { recipientPhone, inviteCode, channel, expiresAt, appUrl, crypto } = params

    const inviteLink = `${appUrl}/onboarding?code=${inviteCode}`
    const expiryDate = expiresAt.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    const messageBody = [
      "You've been invited to join the platform.",
      `Accept here: ${inviteLink}`,
      `(Expires ${expiryDate})`,
    ].join(' ')

    const adapter = await getMessagingAdapter(channel, this.settings, crypto)

    const result = await adapter.sendMessage({
      recipientIdentifier: recipientPhone,
      body: messageBody,
      conversationId: `invite:${inviteCode}`,
    })

    if (!result.success) {
      throw new Error(result.error ?? `Failed to send invite via ${channel}`)
    }

    return {
      sent: true,
      channel,
      recipientPhoneHash: crypto.hmac(recipientPhone, HMAC_PHONE_PREFIX),
    }
  }
}
