import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { pushSubscriptions } from '@server/db/schema'
import { PushService } from '@server/services/push'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

// Unique prefix per run to avoid test cross-contamination
const RUN_PREFIX = `test-push-${crypto.randomUUID().slice(0, 8)}`

const PUBKEY_A = `${RUN_PREFIX}-pubkey-a`
const PUBKEY_B = `${RUN_PREFIX}-pubkey-b`

function makeEndpoint(label: string) {
  return `https://push.example.com/${RUN_PREFIX}/${label}`
}

let db: ReturnType<typeof createDatabase>
let service: PushService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new PushService(db)
  // Clean up any leftover data from previous failed runs
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_A))
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_B))
})

afterAll(async () => {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_A))
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_B))
})

describe('PushService', () => {
  test('subscribe creates a new push subscription', async () => {
    const endpoint = makeEndpoint('create-1')
    const sub = await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-1',
      p256dhKey: 'p256dh-key-1',
      deviceLabel: 'Chrome on Desktop',
    })

    expect(sub.id).toBeString()
    expect(sub.pubkey).toBe(PUBKEY_A)
    expect(sub.endpoint).toBe(endpoint)
    expect(sub.authKey).toBe('auth-key-1')
    expect(sub.p256dhKey).toBe('p256dh-key-1')
    expect(sub.deviceLabel).toBe('Chrome on Desktop')
    expect(sub.createdAt).toBeString()
    expect(sub.updatedAt).toBeString()
  })

  test('subscribe upserts on duplicate endpoint', async () => {
    const endpoint = makeEndpoint('upsert-1')

    const first = await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-old',
      p256dhKey: 'p256dh-key-old',
    })

    // Re-subscribe with updated keys (browser rotated keys)
    const second = await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-new',
      p256dhKey: 'p256dh-key-new',
      deviceLabel: 'Firefox',
    })

    expect(second.id).toBe(first.id) // Same row
    expect(second.authKey).toBe('auth-key-new')
    expect(second.p256dhKey).toBe('p256dh-key-new')
    expect(second.deviceLabel).toBe('Firefox')

    // Only one row for this endpoint
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(rows.length).toBe(1)
  })

  test('unsubscribe removes subscription by endpoint + pubkey', async () => {
    const endpoint = makeEndpoint('unsub-1')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-x',
      p256dhKey: 'p256dh-key-x',
    })

    await service.unsubscribe(endpoint, PUBKEY_A)

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(rows.length).toBe(0)
  })

  test('unsubscribe rejects mismatched pubkey', async () => {
    const endpoint = makeEndpoint('unsub-mismatch')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-y',
      p256dhKey: 'p256dh-key-y',
    })

    await expect(service.unsubscribe(endpoint, PUBKEY_B)).rejects.toThrow()

    // Subscription still exists
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(rows.length).toBe(1)
  })

  test('removeStaleSubscription deletes by endpoint', async () => {
    const endpoint = makeEndpoint('stale-1')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-z',
      p256dhKey: 'p256dh-key-z',
    })

    await service.removeStaleSubscription(endpoint)

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    expect(rows.length).toBe(0)
  })

  test('getSubscriptionsForPubkeys returns all subscriptions for given pubkeys', async () => {
    const endpointA1 = makeEndpoint('multi-a1')
    const endpointA2 = makeEndpoint('multi-a2')
    const endpointB1 = makeEndpoint('multi-b1')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint: endpointA1,
      authKey: 'ak',
      p256dhKey: 'pk',
    })
    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint: endpointA2,
      authKey: 'ak',
      p256dhKey: 'pk',
    })
    await service.subscribe({
      pubkey: PUBKEY_B,
      endpoint: endpointB1,
      authKey: 'ak',
      p256dhKey: 'pk',
    })

    const results = await service.getSubscriptionsForPubkeys([PUBKEY_A, PUBKEY_B])

    const endpoints = results.map((r) => r.endpoint)
    expect(endpoints).toContain(endpointA1)
    expect(endpoints).toContain(endpointA2)
    expect(endpoints).toContain(endpointB1)

    // Should not contain subscriptions from other test cases that used different prefixes
    expect(results.every((r) => r.pubkey === PUBKEY_A || r.pubkey === PUBKEY_B)).toBeTrue()
  })
})
