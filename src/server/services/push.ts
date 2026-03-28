import { and, eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import type { Database } from '../db'
import { pushSubscriptions } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'

export interface PushSubscriptionData {
  pubkey: string
  endpoint: string
  authKey: string
  p256dhKey: string
  deviceLabel?: string
}

export interface PushSubscription {
  id: string
  pubkey: string
  endpoint: string
  authKey: string
  p256dhKey: string
  deviceLabel: string | null
  createdAt: string
  updatedAt: string
}

export class PushService {
  #vapidConfigured = false

  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  #rowToSubscription(row: typeof pushSubscriptions.$inferSelect): PushSubscription {
    return {
      id: row.id,
      pubkey: row.pubkey,
      endpoint: row.endpoint,
      authKey: row.authKey,
      p256dhKey: row.p256dhKey,
      deviceLabel: row.deviceLabel,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  /** Create or update a push subscription (upsert on endpoint). */
  async subscribe(data: PushSubscriptionData): Promise<PushSubscription> {
    const now = new Date()
    const [row] = await this.db
      .insert(pushSubscriptions)
      .values({
        pubkey: data.pubkey,
        endpoint: data.endpoint,
        authKey: data.authKey,
        p256dhKey: data.p256dhKey,
        deviceLabel: data.deviceLabel ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          pubkey: data.pubkey,
          authKey: data.authKey,
          p256dhKey: data.p256dhKey,
          deviceLabel: data.deviceLabel ?? null,
          updatedAt: now,
        },
      })
      .returning()
    return this.#rowToSubscription(row)
  }

  /** Remove a subscription by endpoint, verifying ownership by pubkey. */
  async unsubscribe(endpoint: string, pubkey: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1)

    if (rows.length === 0) {
      return // Already gone — idempotent
    }

    const [row] = rows
    if (row.pubkey !== pubkey) {
      throw new AppError(403, 'Cannot unsubscribe a subscription belonging to a different user')
    }

    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.pubkey, pubkey)))
  }

  /** Remove a stale subscription by endpoint only (called when push delivery fails). */
  async removeStaleSubscription(endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  }

  /** Get all subscriptions for a single volunteer pubkey. */
  async getSubscriptionsForPubkey(pubkey: string): Promise<PushSubscription[]> {
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.pubkey, pubkey))
    return rows.map((r) => this.#rowToSubscription(r))
  }

  /** Get all subscriptions for a list of volunteer pubkeys. */
  async getSubscriptionsForPubkeys(pubkeys: string[]): Promise<PushSubscription[]> {
    if (pubkeys.length === 0) return []
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.pubkey, pubkeys))
    return rows.map((r) => this.#rowToSubscription(r))
  }

  /**
   * Send Web Push notifications to all subscriptions for the given volunteer pubkeys.
   * Stale subscriptions (410/404) are automatically removed.
   * Non-fatal delivery errors are logged but do not throw.
   */
  async sendPushToVolunteers(
    pubkeys: string[],
    data: { type: string; callSid: string; hubId: string },
    env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }
  ): Promise<void> {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return

    // Configure VAPID once (idempotent — same values each call, but avoids repeated setup)
    if (!this.#vapidConfigured) {
      webpush.setVapidDetails(
        'mailto:admin@llamenos.org',
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
      )
      this.#vapidConfigured = true
    }

    const subscriptions = await this.getSubscriptionsForPubkeys(pubkeys)
    const payload = JSON.stringify(data)

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { auth: sub.authKey, p256dh: sub.p256dhKey } },
            payload,
            { TTL: 30, urgency: 'high' }
          )
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 410 || statusCode === 404) {
            await this.removeStaleSubscription(sub.endpoint)
          } else {
            console.warn('[push] Failed to send push:', sub.endpoint, err)
          }
        }
      })
    )
  }
}
