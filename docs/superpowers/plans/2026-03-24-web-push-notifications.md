# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volunteers receive system notifications for incoming calls even when the app tab is closed, via standard Web Push (VAPID).

**Architecture:** Server generates VAPID keypair, stores volunteer push subscriptions in Postgres. During parallel ringing, `ringing.ts` fires `webpush.sendNotification()` for all subscribed volunteers alongside the existing Nostr event. A custom service worker (VitePWA `injectManifest` mode) handles `push` and `notificationclick` events with Answer/Dismiss action buttons.

**Tech Stack:** `web-push` npm package, Web Push API, VitePWA `injectManifest`, `workbox-precaching`, `workbox-routing`, Drizzle ORM, Hono

**Spec:** `docs/superpowers/specs/2026-03-24-web-push-browser-calling-design.md` (Feature A)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/server/db/schema/push-subscriptions.ts` | Drizzle schema for `pushSubscriptions` table |
| `src/server/services/push.ts` | Push subscription CRUD + send push notifications |
| `src/server/routes/notifications.ts` | Hono routes: subscribe, unsubscribe, vapid-public-key |
| `src/client/service-worker.ts` | Custom SW: Workbox precaching + push/notificationclick handlers |
| `src/client/lib/push-subscription.ts` | Client-side push subscribe/unsubscribe logic |

---

### Task 1: Install dependencies and verify Bun compatibility

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install web-push and workbox packages**

```bash
bun add web-push
bun add -d workbox-precaching workbox-routing @types/web-push
```

- [ ] **Step 2: Verify web-push works with Bun**

Create a quick smoke test:
```bash
bun -e "const wp = require('web-push'); const keys = wp.generateVAPIDKeys(); console.log('pub:', keys.publicKey.slice(0,20) + '...'); console.log('priv:', keys.privateKey.slice(0,20) + '...')"
```
Expected: prints truncated base64url keys without errors. If `web-push` fails on Bun's `node:crypto`, switch to `@block65/webcrypto-web-push`.

- [ ] **Step 3: Generate VAPID keypair for dev**

```bash
bun -e "const wp = require('web-push'); const k = wp.generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey); console.log('VAPID_PRIVATE_KEY=' + k.privateKey)"
```
Add the output to `.env`. Add placeholder entries to `.env.example` and `.env.live.example`.

- [ ] **Step 4: Add VAPID env vars to Env interface**

In `src/server/types.ts`, add to the `Env` interface:
```typescript
VAPID_PUBLIC_KEY?: string
VAPID_PRIVATE_KEY?: string
```

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock .env.example .env.live.example src/server/types.ts
git commit -m "feat: add web-push + workbox deps, VAPID env vars"
```

---

### Task 2: Push subscriptions database schema and service

**Files:**
- Create: `src/server/db/schema/push-subscriptions.ts`
- Modify: `src/server/db/schema/index.ts` (re-export)
- Create: `src/server/services/push.ts`
- Modify: `src/server/services/index.ts` (add PushService)
- Test: `src/server/services/push.test.ts`

- [ ] **Step 1: Write the failing test for PushService CRUD**

```typescript
// src/server/services/push.test.ts
import { describe, expect, test, beforeAll } from 'bun:test'
// Import test helpers (follow existing test patterns for DB-backed services)

describe('PushService', () => {
  test('subscribe creates a new push subscription', async () => {
    const sub = await pushService.subscribe({
      pubkey: 'vol_abc123',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test1',
      authKey: 'auth-key-1',
      p256dhKey: 'p256dh-key-1',
      deviceLabel: 'Chrome/Linux',
    })
    expect(sub.id).toBeDefined()
    expect(sub.endpoint).toBe('https://fcm.googleapis.com/fcm/send/test1')
  })

  test('subscribe upserts on duplicate endpoint', async () => {
    await pushService.subscribe({
      pubkey: 'vol_abc123',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test2',
      authKey: 'old-auth',
      p256dhKey: 'old-p256dh',
    })
    const updated = await pushService.subscribe({
      pubkey: 'vol_abc123',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test2',
      authKey: 'new-auth',
      p256dhKey: 'new-p256dh',
    })
    expect(updated.authKey).toBe('new-auth')
    const all = await pushService.getSubscriptionsForPubkey('vol_abc123')
    const matching = all.filter(s => s.endpoint === 'https://fcm.googleapis.com/fcm/send/test2')
    expect(matching).toHaveLength(1)
  })

  test('unsubscribe removes subscription by endpoint + pubkey', async () => {
    await pushService.subscribe({
      pubkey: 'vol_xyz',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test3',
      authKey: 'a', p256dhKey: 'b',
    })
    const deleted = await pushService.unsubscribe('https://fcm.googleapis.com/fcm/send/test3', 'vol_xyz')
    expect(deleted).toBe(true)
  })

  test('unsubscribe rejects mismatched pubkey', async () => {
    await pushService.subscribe({
      pubkey: 'vol_owner',
      endpoint: 'https://fcm.googleapis.com/fcm/send/test4',
      authKey: 'a', p256dhKey: 'b',
    })
    const deleted = await pushService.unsubscribe('https://fcm.googleapis.com/fcm/send/test4', 'vol_attacker')
    expect(deleted).toBe(false)
  })

  test('removeStaleSubscription deletes by endpoint', async () => {
    await pushService.subscribe({
      pubkey: 'vol_stale',
      endpoint: 'https://fcm.googleapis.com/fcm/send/gone',
      authKey: 'a', p256dhKey: 'b',
    })
    await pushService.removeStaleSubscription('https://fcm.googleapis.com/fcm/send/gone')
    const subs = await pushService.getSubscriptionsForPubkey('vol_stale')
    expect(subs.filter(s => s.endpoint.includes('gone'))).toHaveLength(0)
  })

  test('getSubscriptionsForPubkeys returns all subscriptions for given pubkeys', async () => {
    await pushService.subscribe({ pubkey: 'vol_a', endpoint: 'https://e1', authKey: 'a', p256dhKey: 'b' })
    await pushService.subscribe({ pubkey: 'vol_a', endpoint: 'https://e2', authKey: 'a', p256dhKey: 'b' })
    await pushService.subscribe({ pubkey: 'vol_b', endpoint: 'https://e3', authKey: 'a', p256dhKey: 'b' })
    const subs = await pushService.getSubscriptionsForPubkeys(['vol_a', 'vol_b'])
    expect(subs.length).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/server/services/push.test.ts
```
Expected: FAIL — `pushService` module doesn't exist.

- [ ] **Step 3: Create Drizzle schema**

```typescript
// src/server/db/schema/push-subscriptions.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pubkey: text('pubkey').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  authKey: text('auth_key').notNull(),
  p256dhKey: text('p256dh_key').notNull(),
  deviceLabel: text('device_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Re-export from `src/server/db/schema/index.ts`.

- [ ] **Step 4: Generate and apply migration**

```bash
bun run migrate:generate
bun run migrate
```

- [ ] **Step 5: Implement PushService**

```typescript
// src/server/services/push.ts
import { eq, and, inArray } from 'drizzle-orm'
import { pushSubscriptions } from '../db/schema/push-subscriptions'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

interface SubscribeParams {
  pubkey: string
  endpoint: string
  authKey: string
  p256dhKey: string
  deviceLabel?: string | null
}

export class PushService {
  #db: PostgresJsDatabase

  constructor(db: PostgresJsDatabase) {
    this.#db = db
  }

  async subscribe(params: SubscribeParams) {
    const [result] = await this.#db
      .insert(pushSubscriptions)
      .values({
        pubkey: params.pubkey,
        endpoint: params.endpoint,
        authKey: params.authKey,
        p256dhKey: params.p256dhKey,
        deviceLabel: params.deviceLabel ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          authKey: params.authKey,
          p256dhKey: params.p256dhKey,
          deviceLabel: params.deviceLabel ?? null,
          pubkey: params.pubkey,
          updatedAt: new Date(),
        },
      })
      .returning()
    return result
  }

  async unsubscribe(endpoint: string, pubkey: string): Promise<boolean> {
    const result = await this.#db
      .delete(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.pubkey, pubkey),
      ))
      .returning()
    return result.length > 0
  }

  async removeStaleSubscription(endpoint: string) {
    await this.#db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
  }

  async getSubscriptionsForPubkey(pubkey: string) {
    return this.#db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.pubkey, pubkey))
  }

  async getSubscriptionsForPubkeys(pubkeys: string[]) {
    if (pubkeys.length === 0) return []
    return this.#db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.pubkey, pubkeys))
  }
}
```

Add `PushService` to the `Services` interface and `createServices()` in `src/server/services/index.ts` (follow existing service registration pattern).

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test src/server/services/push.test.ts
```
Expected: All 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/push-subscriptions.ts src/server/services/push.ts src/server/services/push.test.ts src/server/services/index.ts src/server/db/schema/index.ts
git commit -m "feat: add PushService with subscription CRUD"
```

---

### Task 3: Notification API routes

**Files:**
- Create: `src/server/routes/notifications.ts`
- Modify: `src/server/app.ts`
- Test: `tests/api/notifications.spec.ts`

- [ ] **Step 1: Write the failing API tests**

```typescript
// tests/api/notifications.spec.ts
import { test, expect } from '@playwright/test'
// Use authedRequest helper (follow existing API test patterns in tests/api/)

test.describe('Notification API', () => {
  test('GET /api/notifications/vapid-public-key returns key', async ({ request }) => {
    const res = await request.get('/api/notifications/vapid-public-key')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.publicKey).toBeTruthy()
    expect(typeof body.publicKey).toBe('string')
  })

  test('POST /api/notifications/subscribe stores subscription', async () => {
    // Use authedRequest for authenticated endpoint
    const res = await authedRequest('POST', '/api/notifications/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-api-1',
      keys: { auth: 'test-auth', p256dh: 'test-p256dh' },
      deviceLabel: 'Chrome/Test',
    })
    expect(res.status).toBe(200)
  })

  test('POST /api/notifications/subscribe rejects unauthenticated', async ({ request }) => {
    const res = await request.post('/api/notifications/subscribe', {
      data: { endpoint: 'https://test', keys: { auth: 'a', p256dh: 'b' } },
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE /api/notifications/subscribe removes subscription', async () => {
    // Subscribe first
    await authedRequest('POST', '/api/notifications/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-delete',
      keys: { auth: 'a', p256dh: 'b' },
    })
    const res = await authedRequest('DELETE', '/api/notifications/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-delete',
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx playwright test tests/api/notifications.spec.ts
```
Expected: FAIL — routes don't exist (404s).

- [ ] **Step 3: Implement notification routes**

```typescript
// src/server/routes/notifications.ts
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const notifications = new Hono<AppEnv>()

// Public — VAPID public key is not a secret
notifications.get('/vapid-public-key', (c) => {
  const publicKey = (c.env as Record<string, string>).VAPID_PUBLIC_KEY
  if (!publicKey) {
    return c.json({ error: 'Web Push not configured' }, 503)
  }
  return c.json({ publicKey })
})

// Authenticated — store push subscription
notifications.post('/subscribe', async (c) => {
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const body = await c.req.json<{
    endpoint: string
    keys: { auth: string; p256dh: string }
    deviceLabel?: string
  }>()

  if (!body.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
    return c.json({ error: 'Missing required fields: endpoint, keys.auth, keys.p256dh' }, 400)
  }

  await services.push.subscribe({
    pubkey,
    endpoint: body.endpoint,
    authKey: body.keys.auth,
    p256dhKey: body.keys.p256dh,
    deviceLabel: body.deviceLabel,
  })

  return c.json({ ok: true })
})

// Authenticated — remove push subscription (verifies pubkey ownership)
notifications.delete('/subscribe', async (c) => {
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const body = await c.req.json<{ endpoint: string }>()

  if (!body.endpoint) {
    return c.json({ error: 'Missing required field: endpoint' }, 400)
  }

  const deleted = await services.push.unsubscribe(body.endpoint, pubkey)
  if (!deleted) {
    return c.json({ error: 'Subscription not found or not owned by you' }, 404)
  }

  return c.json({ ok: true })
})

export default notifications
```

- [ ] **Step 4: Mount routes in app.ts**

In `src/server/app.ts`:
- Import: `import notificationsRoutes from './routes/notifications'`
- Mount the VAPID key endpoint as public (before auth):
  ```typescript
  api.route('/notifications', notificationsRoutes)
  ```
  Note: The `/vapid-public-key` sub-route is public. The `/subscribe` and `/subscribe` (DELETE) routes need auth — add auth middleware in the route file or mount under the authenticated router. Follow whichever pattern makes more sense given the existing `app.ts` structure. The VAPID key must be public (unauthenticated), so split the mounting: public GET under `api`, authenticated POST/DELETE under `authenticated`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx playwright test tests/api/notifications.spec.ts
```
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/notifications.ts src/server/app.ts tests/api/notifications.spec.ts
git commit -m "feat: add notification subscribe/unsubscribe API routes"
```

---

### Task 4: Push delivery in ringing flow

**Files:**
- Modify: `src/server/lib/ringing.ts`
- Modify: `src/server/services/push.ts` (add `sendPushToVolunteers` method)
- Test: `src/server/lib/ringing.test.ts` (or extend existing)

- [ ] **Step 1: Write the failing test for push delivery**

Test that `sendPushToVolunteers` calls `webpush.sendNotification` with correct payload and TTL, and handles 410 Gone by deleting the subscription.

```typescript
// In push.test.ts or a new ringing-push.test.ts
import { describe, expect, test, mock } from 'bun:test'

describe('PushService.sendPushToVolunteers', () => {
  test('sends push to all subscriptions for given pubkeys', async () => {
    // Setup: create subscriptions for 2 volunteers
    // Mock webpush.sendNotification
    // Call sendPushToVolunteers(['vol_a', 'vol_b'], { type: 'call:ring', callSid: 'CA123', hubId: 'hub1' })
    // Assert: sendNotification called once per subscription
    // Assert: payload is JSON with correct shape
    // Assert: options include TTL: 30 and urgency: 'high'
  })

  test('deletes subscription on 410 Gone', async () => {
    // Setup: create subscription, mock sendNotification to throw { statusCode: 410 }
    // Call sendPushToVolunteers
    // Assert: subscription was deleted from DB
  })

  test('ignores other push errors without deleting', async () => {
    // Setup: mock sendNotification to throw { statusCode: 500 }
    // Call sendPushToVolunteers
    // Assert: subscription still exists
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/server/services/push.test.ts
```

- [ ] **Step 3: Implement sendPushToVolunteers**

Add to `PushService`:

```typescript
async sendPushToVolunteers(
  pubkeys: string[],
  data: { type: string; callSid: string; hubId: string },
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return

  const webpush = await import('web-push')
  webpush.default.setVapidDetails(
    'mailto:admin@llamenos.org',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  )

  const subscriptions = await this.getSubscriptionsForPubkeys(pubkeys)
  const payload = JSON.stringify(data)

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.default.sendNotification(
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
```

- [ ] **Step 4: Wire push delivery into ringing.ts**

In `src/server/lib/ringing.ts`, after the `publishNostrEvent` call (line 79), add:

```typescript
// Send Web Push notifications to all available volunteers (fire-and-forget)
const availablePubkeys = available.map((v) => v.pubkey)
services.push.sendPushToVolunteers(
  availablePubkeys,
  { type: 'call:ring', callSid, hubId: hubId ?? 'global' },
  env
).catch((err) => console.warn('[ringing] push notification failed:', err))
```

This is fire-and-forget — `.catch()` prevents unhandled rejection, does not block ringing flow.

- [ ] **Step 5: Run tests**

```bash
bun test src/server/services/push.test.ts
```
Expected: PASS.

- [ ] **Step 6: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 7: Commit**

```bash
git add src/server/services/push.ts src/server/lib/ringing.ts src/server/services/push.test.ts
git commit -m "feat: fire Web Push notifications during parallel ringing"
```

---

### Task 5: Custom service worker with push handlers

**Files:**
- Create: `src/client/service-worker.ts`
- Modify: `vite.config.ts` (switch to `injectManifest`)

- [ ] **Step 1: Create custom service worker**

```typescript
// src/client/service-worker.ts
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { createHandlerBoundToURL } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Workbox precaching — VitePWA injects the manifest at build time
precacheAndRoute(self.__WB_MANIFEST)

// Navigation fallback — replicate existing navigateFallbackDenylist behavior
const navigationHandler = createHandlerBoundToURL('index.html')
registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//, /^\/telephony\//],
  })
)

// --- Web Push notification handler ---

self.addEventListener('push', (event) => {
  if (!event.data) return

  event.waitUntil(
    (async () => {
      // Check if any app window is focused — skip push if in-app notification is active
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: false,
      })
      const hasFocusedWindow = windowClients.some((c) => c.focused)
      if (hasFocusedWindow) return

      const data = event.data.json() as { type: string; callSid: string; hubId: string }

      await self.registration.showNotification('Incoming Call', {
        body: 'A call is waiting',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'incoming-call',
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        data: { callSid: data.callSid, hubId: data.hubId },
        actions: [
          { action: 'answer', title: 'Answer' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      })
    })()
  )
})

// --- Notification click handler ---

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const { callSid, hubId } = event.notification.data as { callSid: string; hubId: string }
  const targetUrl = `/dashboard?action=answer&callSid=${callSid}&hubId=${hubId}`

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: 'window' })

      // If app is already open, focus it and send a message
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'answer-call',
            callSid,
            hubId,
          })
          return client.focus()
        }
      }

      // Otherwise open a new window
      return self.clients.openWindow(targetUrl)
    })()
  )
})
```

- [ ] **Step 2: Switch VitePWA to injectManifest mode**

In `vite.config.ts`, replace the `VitePWA({...})` block:

```typescript
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src/client',
  filename: 'service-worker.ts',
  registerType: 'autoUpdate',
  includeAssets: ['favicon.svg', 'apple-touch-icon.svg'],
  manifest: {
    name: 'Hotline',
    short_name: 'Hotline',
    description: 'Secure communication app',
    theme_color: '#1a1a2e',
    background_color: '#0a0a0a',
    display: 'standalone',
    orientation: 'portrait',
    scope: '/',
    start_url: '/',
    icons: [
      {
        src: 'pwa-192x192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
      },
      {
        src: 'pwa-512x512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  },
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
  },
  devOptions: {
    enabled: false,
  },
}),
```

Key changes from current config:
- Added `strategies: 'injectManifest'`
- Added `srcDir: 'src/client'` and `filename: 'service-worker.ts'`
- Moved `globPatterns` from `workbox` to `injectManifest`
- Removed `workbox` block (no `navigateFallback`/`navigateFallbackDenylist` — handled in SW source)

- [ ] **Step 3: Verify build succeeds**

```bash
bun run build
```
Expected: Build succeeds, service worker is compiled and manifest is injected. Check `dist/client/` for the compiled SW file.

- [ ] **Step 4: Commit**

```bash
git add src/client/service-worker.ts vite.config.ts
git commit -m "feat: custom service worker with Web Push handlers (injectManifest)"
```

---

### Task 6: Client-side push subscription management

**Files:**
- Create: `src/client/lib/push-subscription.ts`
- Modify: `src/client/lib/notifications.ts` (integrate push subscribe after permission grant)

- [ ] **Step 1: Write push-subscription module**

```typescript
// src/client/lib/push-subscription.ts

/** Convert base64url VAPID key to Uint8Array for PushManager.subscribe() */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** Detect simplified device label from navigator.userAgent */
function getDeviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : /Win/.test(ua) ? 'Windows' : 'Desktop'
  return `${browser}/${os}`
}

/** Fetch VAPID public key from server */
async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/notifications/vapid-public-key')
    if (!res.ok) return null
    const { publicKey } = await res.json()
    return publicKey ?? null
  } catch {
    return null
  }
}

/**
 * Subscribe to Web Push notifications.
 * Call after notification permission is granted and user is authenticated.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (Notification.permission !== 'granted') return false

  const vapidKey = await getVapidPublicKey()
  if (!vapidKey) return false

  try {
    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
    }

    const json = subscription.toJSON()
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        deviceLabel: getDeviceLabel(),
      }),
    })

    return true
  } catch (err) {
    console.warn('[push] Subscribe failed:', err)
    return false
  }
}

/**
 * Unsubscribe from Web Push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return true

    // Server-side removal
    await fetch('/api/notifications/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })

    // Browser-side removal
    await subscription.unsubscribe()
    return true
  } catch (err) {
    console.warn('[push] Unsubscribe failed:', err)
    return false
  }
}

/**
 * Check if push notifications are currently active.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription !== null
  } catch {
    return false
  }
}

/**
 * Check if push notifications are supported by this browser.
 */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
```

- [ ] **Step 2: Integrate push subscription into notification permission flow**

In `src/client/lib/notifications.ts`, after `requestPermission()` returns `true`, call `subscribeToPush()`:

```typescript
import { subscribeToPush } from './push-subscription'

export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') {
    // Already granted — ensure push subscription is active
    subscribeToPush() // fire-and-forget
    return true
  }
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  if (result === 'granted') {
    subscribeToPush() // fire-and-forget
  }
  return result === 'granted'
}
```

- [ ] **Step 3: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/push-subscription.ts src/client/lib/notifications.ts
git commit -m "feat: client-side push subscription management"
```

---

### Task 7: Handle push notification answer intent on dashboard

**Files:**
- Modify: Dashboard route component (check existing route file for dashboard)
- Modify: `src/client/lib/hooks.ts` (handle service worker postMessage)

- [ ] **Step 1: Add service worker message listener**

In `src/client/lib/hooks.ts` (or the dashboard component), add a listener for `answer-call` messages from the service worker:

```typescript
// In the useCalls hook or dashboard component
useEffect(() => {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'answer-call') {
      const { callSid, hubId } = event.data
      // Switch hub context if needed, then trigger answerCall
      answerCall(callSid)
    }
  }
  navigator.serviceWorker?.addEventListener('message', handler)
  return () => navigator.serviceWorker?.removeEventListener('message', handler)
}, [answerCall])
```

- [ ] **Step 2: Handle URL query params for notification click (new window case)**

In the dashboard route, check for `action=answer` query param on mount:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  if (params.get('action') === 'answer') {
    const callSid = params.get('callSid')
    if (callSid) {
      answerCall(callSid)
      // Clean URL
      window.history.replaceState({}, '', '/dashboard')
    }
  }
}, [])
```

- [ ] **Step 3: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/hooks.ts src/client/routes/
git commit -m "feat: handle push notification answer intent on dashboard"
```

---

### Task 8: E2E tests and final verification

**Files:**
- Test: `tests/api/notifications.spec.ts` (ensure all pass)
- Test: `tests/ui/notification-pwa.spec.ts` (extend with push tests)

- [ ] **Step 1: Run all existing tests to verify no regressions**

```bash
bun run test:unit
bunx playwright test tests/api/
```

- [ ] **Step 2: Add push-specific E2E tests**

In `tests/ui/notification-pwa.spec.ts`, add tests for:
- Settings page shows push notification toggle
- Push subscription status is displayed correctly

Note: Full push event testing is limited in Playwright (can't trigger real push events). Test the `notificationclick` routing via `page.evaluate` to verify the SW handler logic.

- [ ] **Step 3: Run full test suite**

```bash
bun run test:all
```

- [ ] **Step 4: Final typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add Web Push notification tests"
```
