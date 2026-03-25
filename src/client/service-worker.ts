/**
 * Custom service worker for Llámenos Hotline.
 *
 * Uses Workbox injectManifest mode — VitePWA injects self.__WB_MANIFEST at build time.
 * Handles precaching, SPA navigation routing, push notifications, and notification clicks.
 */

/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

// Precache all assets injected by VitePWA at build time
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback — exclude API and telephony webhook paths
const handler = createHandlerBoundToURL('/index.html')
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//, /^\/telephony\//],
})
registerRoute(navigationRoute)

// Push notification handler
self.addEventListener('push', (event: PushEvent) => {
  async function handlePush() {
    // If a focused window already exists, skip showing a notification —
    // the app is visible and will handle the push event via WebSocket/relay.
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    const hasFocusedWindow = windowClients.some((c) => c.focused)
    if (hasFocusedWindow) return

    let callSid = ''
    let hubId = ''

    if (event.data) {
      try {
        const payload = event.data.json() as {
          callSid?: string
          hubId?: string
        }
        callSid = payload.callSid ?? ''
        hubId = payload.hubId ?? ''
      } catch {
        // Ignore malformed push payloads
      }
    }

    // Always generic — never display caller info or hub names on lock screens (security requirement)
    const body = 'A call is waiting'

    // `vibrate` and `actions` are part of the Push API Notification extension
    // (not in the base NotificationOptions DOM type), so we cast here.
    const options = {
      body,
      tag: 'incoming-call',
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: { callSid, hubId },
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    } as NotificationOptions
    await self.registration.showNotification('Incoming Call', options)
  }

  event.waitUntil(handlePush())
})

// Notification click handler
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  // Both 'answer' action and clicking the notification body navigate/focus the app
  const notifData = event.notification.data as { callSid?: string; hubId?: string }
  const callSid = notifData?.callSid ?? ''
  const hubId = notifData?.hubId ?? ''

  const params = new URLSearchParams({ action: 'answer' })
  if (callSid) params.set('callSid', callSid)
  if (hubId) params.set('hubId', hubId)
  const targetUrl = `/?${params.toString()}`

  async function handleClick() {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    // Focus an existing window and send it the answer intent
    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage({ type: 'ANSWER_CALL', callSid, hubId })
        return
      }
    }

    // No existing window — open a new one with the action encoded in the URL
    await self.clients.openWindow(targetUrl)
  }

  event.waitUntil(handleClick())
})
