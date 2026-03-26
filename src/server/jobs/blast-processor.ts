/**
 * BlastProcessor — Core delivery engine for broadcast messages.
 *
 * Polls every 30s for blasts in 'sending' or due 'scheduled' status,
 * then delivers to matching subscribers via messaging adapters.
 *
 * Supports: resume after crash (skip already-delivered), cancellation
 * checks at batch boundaries, per-channel rate limiting, opt-out footers.
 */

import type { MessagingChannelType } from '@shared/types'
import { getMessagingAdapter } from '../lib/adapters'
import { decryptFromHub, unwrapHubKeyForServer } from '../lib/crypto'
import type { MessagingAdapter } from '../messaging/adapter'
import type { Services } from '../services'
import { matchesBlastFilters, selectChannel } from '../services/blasts'
import type { Blast, Subscriber, SubscriberChannel } from '../types'

const OPT_OUT_FOOTERS: Record<string, string> = {
  en: 'Reply STOP to unsubscribe',
  es: 'Responda STOP para cancelar la suscripción',
  zh: '回复 STOP 取消订阅',
  tl: 'Mag-reply ng STOP para mag-unsubscribe',
  vi: 'Trả lời STOP để hủy đăng ký',
  ar: 'أرسل STOP لإلغاء الاشتراك',
  fr: 'Répondez STOP pour vous désabonner',
  ht: 'Reponn STOP pou dezabòne',
  ko: 'STOP을 보내 구독을 취소하세요',
  ru: 'Ответьте STOP для отписки',
  hi: 'सदस्यता रद्द करने के लिए STOP भेजें',
  pt: 'Responda STOP para cancelar a assinatura',
  de: 'Antworten Sie STOP zum Abbestellen',
}

/** Per-channel rate-limit delay in milliseconds. */
const CHANNEL_DELAYS: Record<string, number> = {
  sms: 1000,
  whatsapp: 50,
  signal: 500,
  rcs: 200,
}

const BATCH_SIZE = 50

export class BlastProcessor {
  private readonly services: Services
  private readonly serverSecret: string
  private readonly hmacSecret: string
  private processing = false

  constructor(services: Services, serverSecret: string, hmacSecret: string) {
    this.services = services
    this.serverSecret = serverSecret
    this.hmacSecret = hmacSecret
  }

  /**
   * Single poll iteration — find and process one blast.
   * Called by setInterval every 30s.
   */
  async processOnce(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      const pending = await this.services.blasts.findBlastsToProcess()
      if (pending.length === 0) return

      // Promote any scheduled blasts to 'sending'
      for (const blast of pending) {
        if (blast.status === 'scheduled') {
          await this.services.blasts.updateBlast(blast.id, { status: 'sending' })
          await this.services.records.addAuditEntry(blast.hubId, 'blastScheduled', 'system', {
            blastId: blast.id,
            name: blast.name,
          })
        }
      }

      // Process the first sending blast
      const toProcess = pending.find((b) => b.status === 'sending') ?? pending[0]
      await this.processBlast(toProcess)
    } finally {
      this.processing = false
    }
  }

  /**
   * Process a single blast: filter subscribers, send messages, record deliveries.
   */
  async processBlast(blast: Blast): Promise<void> {
    let hubKey: Uint8Array
    try {
      hubKey = await this._getHubKey(blast.hubId)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`[blast-processor] Failed to get hub key for blast ${blast.id}:`, errorMsg)
      await this.services.blasts.updateBlast(blast.id, {
        status: 'failed' as string,
        error: `Hub key error: ${errorMsg}`,
      })
      await this.services.records.addAuditEntry(blast.hubId, 'blastFailed', 'system', {
        blastId: blast.id,
        name: blast.name,
        error: `Hub key error: ${errorMsg}`,
      })
      return
    }

    // Load all subscribers for this hub
    const allSubscribers = await this.services.blasts.listSubscribers(blast.hubId)

    // Filter by blast targeting criteria
    const eligible = allSubscribers.filter((sub) =>
      matchesBlastFilters(sub, blast.targetChannels, blast.targetTags, blast.targetLanguages)
    )

    // Skip already-delivered (for resume after crash)
    const delivered = await this.services.blasts.getDeliveredSubscriberIds(blast.id)
    const remaining = eligible.filter((sub) => !delivered.has(sub.id))

    // Update total recipients stat
    await this.services.blasts.updateBlast(blast.id, {
      stats: { totalRecipients: eligible.length },
    })

    let sentCount = delivered.size // start from already-delivered count
    let failedCount = 0

    // Process in batches
    for (let i = 0; i < remaining.length; i++) {
      // Check for cancellation at batch boundaries
      if (i > 0 && i % BATCH_SIZE === 0) {
        const current = await this.services.blasts.getBlast(blast.id)
        if (current?.status === 'cancelled') {
          await this.services.blasts.updateBlast(blast.id, {
            stats: { sent: sentCount, failed: failedCount },
          })
          await this.services.records.addAuditEntry(blast.hubId, 'blastCancelled', 'system', {
            blastId: blast.id,
            name: blast.name,
            sent: sentCount,
            remaining: remaining.length - i,
          })
          return
        }

        // Update stats at batch boundary
        await this.services.blasts.updateBlast(blast.id, {
          stats: { sent: sentCount, failed: failedCount },
        })
      }

      const sub = remaining[i]
      const channel = selectChannel(sub, blast.targetChannels)
      if (!channel) {
        failedCount++
        continue
      }

      try {
        // Decrypt subscriber identifier using hub key
        const identifier = await this._decryptIdentifier(sub.encryptedIdentifier!, hubKey)
        if (!identifier) {
          failedCount++
          await this.services.blasts.createDelivery({
            blastId: blast.id,
            subscriberId: sub.id,
            channelType: channel.type,
            status: 'failed',
            error: 'Failed to decrypt identifier',
          })
          continue
        }

        // Get messaging adapter for this channel
        const adapter = await this._getAdapter(channel.type, blast.hubId)

        // Build message with opt-out footer
        const footer = OPT_OUT_FOOTERS[sub.language ?? 'en'] ?? OPT_OUT_FOOTERS.en
        const body = `${blast.content}\n\n${footer}`

        // Send the message
        const result = await adapter.sendMessage({
          recipientIdentifier: identifier,
          body,
        })

        if (result.success) {
          sentCount++
          await this.services.blasts.createDelivery({
            blastId: blast.id,
            subscriberId: sub.id,
            channelType: channel.type,
            status: 'sent',
          })
        } else {
          failedCount++
          await this.services.blasts.createDelivery({
            blastId: blast.id,
            subscriberId: sub.id,
            channelType: channel.type,
            status: 'failed',
            error: result.error ?? 'Send failed',
          })
        }

        // Rate limit between sends
        const delay = CHANNEL_DELAYS[channel.type] ?? CHANNEL_DELAYS.sms
        await new Promise((resolve) => setTimeout(resolve, delay))
      } catch (err) {
        failedCount++
        const errorMsg = err instanceof Error ? err.message : String(err)
        await this.services.blasts.createDelivery({
          blastId: blast.id,
          subscriberId: sub.id,
          channelType: channel.type,
          status: 'failed',
          error: errorMsg,
        })
      }
    }

    // Final status update
    await this.services.blasts.updateBlast(blast.id, {
      status: 'sent',
      sentAt: new Date(),
      stats: { sent: sentCount, failed: failedCount },
    })

    await this.services.records.addAuditEntry(blast.hubId, 'blastSent', 'system', {
      blastId: blast.id,
      name: blast.name,
      totalRecipients: eligible.length,
      sent: sentCount,
      failed: failedCount,
    })
  }

  // ── Overridable helpers for testing ──

  /** Get the hub's decrypted hub key. Override in tests. */
  async _getHubKey(hubId: string): Promise<Uint8Array> {
    const envelopes = await this.services.settings.getHubKeyEnvelopes(hubId)
    return unwrapHubKeyForServer(this.serverSecret, envelopes)
  }

  /** Decrypt an encrypted subscriber identifier. Override in tests. */
  async _decryptIdentifier(encrypted: string, hubKey: Uint8Array): Promise<string | null> {
    return decryptFromHub(encrypted, hubKey)
  }

  /** Get a messaging adapter for the given channel type. Override in tests. */
  async _getAdapter(channel: MessagingChannelType, hubId: string): Promise<MessagingAdapter> {
    return getMessagingAdapter(channel, this.services.settings, this.hmacSecret, hubId)
  }
}

/**
 * Schedule the blast processor to run every 30 seconds.
 * Call once during server startup.
 */
export function scheduleBlastProcessor(
  services: Services,
  serverSecret: string,
  hmacSecret: string
): NodeJS.Timeout {
  const processor = new BlastProcessor(services, serverSecret, hmacSecret)
  // Run once immediately on startup (resume any in-progress blasts)
  processor
    .processOnce()
    .catch((err) => console.error('[blast-processor] Initial run failed:', err))
  return setInterval(() => {
    processor.processOnce().catch((err) => console.error('[blast-processor] Poll failed:', err))
  }, 30_000)
}
