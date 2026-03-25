# Web Push Notifications & Browser Calling

**Date:** 2026-03-24
**Status:** Draft
**Features:** Background push notifications (Feature A), Browser SIP/VoIP calling (Feature B)

## Overview

Two independent features that improve volunteer availability:

- **Web Push Notifications**: Volunteers receive system notifications for incoming calls even when the app tab is closed or phone screen is locked. Uses standard Web Push (VAPID) — no third-party push services.
- **Browser Calling**: Volunteers can answer calls directly in the browser via WebRTC, without needing a phone number. Provider SDKs (Twilio, Vonage, Plivo) handle VoIP; a separate SIP adapter (JsSIP/SIP.js) will be specced for Asterisk and SIP-only configurations.

These features are independent and can be implemented in parallel.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Push subscription scope | Global per-volunteer | Matches v2 architecture; decryption/security model is hub-independent |
| Push notification actions | Answer + Dismiss buttons | Standard call UX; maps to existing answer/dismiss flows |
| Dual ringing (`both` preference) | Simultaneous phone + browser | Infrastructure already supports parallel ringing; first pickup wins |
| Push subscription cleanup | Passive (410 Gone) | Deactivated volunteers are filtered by ringing query; stale subscriptions are harmless |
| Mic permission | Upfront + just-in-time | Prompt on preference change; re-check on answer since browsers can revoke |
| Push delivery trigger | Direct from ringing logic | No extra hop through Nostr; fire-and-forget alongside existing notification paths |
| Push notification body | Generic "A call is waiting" | Hub names could reveal crisis line nature on lock screens; matches existing `showBrowserNotification` behavior |
| Push TTL | 30 seconds | Incoming calls are time-sensitive; stale push notifications are confusing |
| Push deduplication | SW checks `clients.matchAll()` | Skip push notification if app window is already focused (in-app notification is superior) |
| Push i18n | English-only (MVP) | Service worker lacks i18n framework; acceptable for initial release |
| Push service | Native Web Push (`web-push` library) | Self-hosted, no third-party PII routing, EU/GDPR compatible |
| WebRTC approach | Provider SDK per-adapter | Each SDK handles signaling/SRTP/auth; unified `WebRTCAdapter` interface normalizes lifecycle |
| WebRTC adapter modes | VoIP (provider SDK) vs SIP (JsSIP/SIP.js) | VoIP for Twilio/Vonage/Plivo; SIP mode for Asterisk/SIP-only configs (separate spec) |
| Provider scope | Twilio + Vonage + Plivo | Asterisk/JsSIP is a separate spec; Telnyx deferred |

---

## Feature A: Web Push Notifications

### Server Infrastructure

**VAPID keypair:**
- Generate via `web-push.generateVAPIDKeys()`, store as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env`
- Add `VAPID_PUBLIC_KEY?: string` and `VAPID_PRIVATE_KEY?: string` to the `Env` interface in `src/server/types.ts`
- Public key exposed via `GET /api/notifications/vapid-public-key` (unauthenticated — it's a public key)
- Verify `web-push` npm package compatibility with Bun runtime (Node crypto APIs)

**Database — new `pushSubscriptions` table (Drizzle):**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `pubkey` | text | FK to volunteer identity |
| `endpoint` | text | Unique — browser push endpoint URL |
| `authKey` | text | Web Push auth secret |
| `p256dhKey` | text | Client public key for encryption |
| `deviceLabel` | text, nullable | Simplified label for UI (e.g., "Chrome/Android", "Firefox/Desktop") — not full user-agent string to avoid fingerprinting |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

- One volunteer can have multiple subscriptions (multiple devices/browsers)
- Unique constraint on `endpoint` — re-subscribing from same browser upserts

**API endpoints:**
- `POST /api/notifications/subscribe` — stores/updates a push subscription (authenticated)
- `DELETE /api/notifications/subscribe` — removes a subscription by endpoint (authenticated; verifies the subscription's `pubkey` matches the authenticated volunteer to prevent cross-volunteer unsubscription)

**Push delivery (in `ringing.ts`):**
- After publishing `KIND_CALL_RING` to Nostr relay, query all `pushSubscriptions` for available volunteers
- Fire `webpush.sendNotification()` for each subscription with payload:
  ```json
  { "type": "call:ring", "callSid": "...", "hubId": "..." }
  ```
  Payload intentionally minimal — no hub name, no caller info. Push notifications appear on lock screens; hub names could reveal the nature of the crisis line. `hubId` is included for routing (notification click needs it) but is not displayed.
- Set `TTL: 30` on push messages — calls are time-sensitive; stale notifications arriving minutes later are confusing
- On 410 Gone response, delete the stale subscription
- Fire-and-forget — does not block the ringing flow

### Service Worker & Client

**Service worker `push` event handler:**
- Requires switching VitePWA from `generateSW` to `injectManifest` mode — custom event listeners (`push`, `notificationclick`) cannot be added to auto-generated service workers
- Custom SW source file at `src/service-worker.ts`:
  - Import `precacheAndRoute` from `workbox-precaching` and call `precacheAndRoute(self.__WB_MANIFEST)` to replicate existing precaching
  - Preserve `navigateFallbackDenylist` behavior (exclude `/api/` and `/telephony/` routes) via `registerRoute` with a NavigationRoute
  - Add `push` and `notificationclick` event listeners
- On `push` event:
  1. Check `clients.matchAll({ type: 'window', includeUncontrolled: false })` — if any app window is focused/visible, skip the push notification (in-app ringtone/notification is superior)
  2. Otherwise, parse JSON payload and show notification:
     - Title: "Incoming Call" (generic, no PII)
     - Body: "A call is waiting" (generic — no hub name to avoid revealing crisis line nature on lock screens)
     - Tag: `incoming-call` (replaces existing notification, no stacking)
     - Actions: `[{ action: 'answer', title: 'Answer' }, { action: 'dismiss', title: 'Dismiss' }]`
     - `requireInteraction: true` — stays until acted on
     - Vibration pattern for mobile

**`notificationclick` handler:**
- `dismiss` action: close notification, no further action
- `answer` action or body click: `clients.openWindow('/dashboard?action=answer&callSid=...&hubId=...')` or `clients.focus()` if app is already open, then `postMessage({ type: 'answer-call', callSid, hubId })` the answer intent
- Dashboard route picks up `action=answer` query param, switches to the correct hub context if needed, and triggers the existing answer flow

**Client-side subscription flow:**
- On app load (after auth), check `pushManager.getSubscription()`
- If no subscription and notification permission granted: `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidPublicKey })`
- Send subscription to `POST /api/notifications/subscribe`
- Re-subscribe on every app load to handle endpoint rotation (upsert via unique `endpoint`)
- If permission is `'default'`, existing `NotificationPromptBanner` handles the request — after granting, auto-subscribe to push

**Settings UI:**
- Push notification status: enabled/disabled/unsupported
- Toggle to unsubscribe (`DELETE /api/notifications/subscribe` + `pushSubscription.unsubscribe()`)
- Device list showing active subscriptions (current device highlighted)

---

## Feature B: Browser Calling (Twilio + Vonage + Plivo)

### Client WebRTC Manager

**Architecture — refactor existing `webrtc.ts` into:**
- `WebRTCManager` — owns lifecycle state machine, exposes consistent API to UI
- `TwilioWebRTCAdapter`, `VonageWebRTCAdapter`, `PlivoWebRTCAdapter` — each wraps provider SDK
- Future: `SipWebRTCAdapter` — wraps JsSIP/SIP.js for Asterisk/SIP-only configs (separate spec)

**`WebRTCAdapter` interface:**
```typescript
interface WebRTCAdapter {
  initialize(token: string): Promise<void>
  accept(callSid: string): Promise<void>
  reject(callSid: string): Promise<void>
  disconnect(): void
  setMuted(muted: boolean): void
  on(event: 'incoming', handler: (callSid: string) => void): void
  on(event: 'connected', handler: () => void): void
  on(event: 'disconnected', handler: () => void): void
  on(event: 'error', handler: (error: Error) => void): void
  off(event: 'incoming' | 'connected' | 'disconnected' | 'error', handler: (...args: unknown[]) => void): void
  destroy(): void
}
```

This interface serves as the checklist for provider additions:
- **VoIP providers** (Twilio, Vonage, Plivo): implement using provider's browser SDK
- **SIP-only providers** (Asterisk, or any provider configured for SIP trunking): implement using `SipWebRTCAdapter` with JsSIP/SIP.js + provider's SIP credentials

The adapter factory decides which implementation to use based on the hub's provider configuration and whether it's set up for VoIP or SIP-only.

**Provider SDKs — dynamic import:**
- Twilio: `@twilio/voice-sdk` (already integrated)
- Vonage: `@vonage/client-sdk`
- Plivo: `plivo-browser-sdk`
- Loaded only when the hub's configured provider matches

**Token flow:**
- On app load (if call preference is `browser` or `both`), client calls `GET /api/telephony/webrtc-token` (existing endpoint)
- Server generates provider-specific token via existing `webrtc-tokens.ts`
- Client initializes correct adapter with token
- Token refresh: the `GET /api/telephony/webrtc-token` response must include a `ttl` field (seconds until expiry). Client sets a timer for `ttl - 60s` to re-fetch before expiry. If a token expires mid-call, the active media session is unaffected but new incoming calls cannot be received until re-registration. Provider SDKs also fire `tokenWillExpire` callbacks where available.

**State machine:** `idle → initializing → ready → ringing → connected → ended → error`
- `ended` is transient — transitions back to `ready` after cleanup (device remains registered for next incoming call)
- Adds `ended` state to existing `WebRtcState` type (currently missing)
- `error` state: recoverable via user retry (transitions to `initializing`), matching existing `initWebRtc()` behavior which only blocks when already `ready` or `initializing`

**Microphone permission handling:**
- On preference change to `browser`/`both`: immediately `getUserMedia({ audio: true })` to prompt; show success/failure state in settings
- On incoming call answer: re-check permission before `adapter.accept()`. If denied, show error + suggest phone fallback if available
- Audio device selector (mic + speaker) in call controls

### Server-Side Changes

**Call leg tracking — schema changes:**
- Add `type` column to `callLegs` table as a `pgEnum('call_leg_type', ['phone', 'browser'])` with `.default('phone')` (Drizzle migration)
- Update `CallLeg`, `CreateCallLegData` types in `src/server/types.ts`, and `CallService.createCallLeg()` + `#rowToCallLeg()` in `src/server/services/calls.ts`
- `callPreference: 'both'` volunteers get two leg rows (one phone, one browser)

**Browser leg creation in `ringVolunteers()`:**
- VoIP providers route incoming calls to registered browser devices via their signaling mechanism, but the server must include browser client identities in the dial instructions:
  - **Twilio**: TwiML `<Dial>` must include `<Client>identity</Client>` noun alongside `<Number>` nouns for browser-preference volunteers. The identity is the volunteer's pubkey (used during `Device.register()`).
  - **Vonage**: NCCO `connect` action with `type: 'app'` and the volunteer's user ID targets their browser SDK
  - **Plivo**: XML `<Dial>` with `<User>` element targets the browser endpoint
- The `ringVolunteers` adapter method signature already accepts a volunteers list — extend each volunteer entry to include `{ pubkey, phone?, browserIdentity? }` so the adapter knows which dial directives to emit. **This is a breaking change** to `RingVolunteersParams` (currently `phone: string` is required). All 5 adapter implementations must be updated to handle the optional fields. Adapters not covered in this spec (SignalWire, Asterisk) should ignore `browserIdentity` for now.
- For each browser-preference volunteer, create a `callLegs` row with `type: 'browser'`

**Answer endpoint — `POST /api/calls/{callSid}/answer` (significant extension required):**
- The current handler only sets `assignedPubkey` and `status: 'in-progress'` on `activeCalls`. It does not touch `callLegs` or invoke `cancelRinging()`. This must be extended to:
- Accept `{ type: 'browser' }` to distinguish connection method
- On answer:
  1. Query `callLegs` by `callSid`; mark the answered leg as `in-progress`
  2. Update all other legs to `cancelled`
  3. Invoke `adapter.cancelRinging()` to hang up outstanding phone legs
  4. For `'both'` volunteers: answering on browser cancels their own phone leg too
- Race condition: the existing `assignedPubkey` check on the `activeCalls` row handles simultaneous answers (first write wins). Leg cancellation runs after the assignment succeeds, so only the winner's legs survive.

**No new adapter methods needed** for the answer/bridge flow — VoIP providers bridge the browser connection automatically when the client SDK accepts the incoming call. The `ringBrowserVolunteer` pattern is only needed for SIP-mode providers (Asterisk spec).

---

## Testing Strategy

### Web Push

**Unit tests (`bun:test`):**
- `pushSubscriptions` CRUD (create, upsert on duplicate endpoint, delete, 410 cleanup)
- Push payload construction (correct JSON, no PII — callSid and hubId only, no human-readable names)
- VAPID key loading and validation

**API integration tests (`tests/api/`):**
- `POST /api/notifications/subscribe` — stores subscription, rejects unauthenticated
- `DELETE /api/notifications/subscribe` — removes by endpoint
- `GET /api/notifications/vapid-public-key` — returns public key
- Push delivery during ringing — mock `webpush.sendNotification()`, verify called for each subscription
- 410 Gone handling — stale subscriptions deleted

**E2E tests (`tests/ui/`):**
- Notification prompt banner for volunteers without push
- Settings page push toggle and device list
- `notificationclick` routing via `page.evaluate`

### Browser Calling

**Unit tests (`bun:test`):**
- `WebRTCManager` state machine transitions
- Adapter factory selects correct adapter for provider
- Token refresh logic

**API integration tests (`tests/api/`):**
- `GET /api/telephony/webrtc-token` — returns provider-specific token (authenticated)
- `POST /api/calls/{callSid}/answer` with `type: 'browser'` — marks browser leg, cancels others
- `'both'` volunteers: two legs created, answering one cancels both

**E2E tests (`tests/ui/`):**
- Call preference selector in settings (phone/browser/both)
- Mic permission prompt on browser preference selection
- WebRTC adapter initialization on dashboard load (mocked provider SDK)
- Answer/reject/mute/hangup controls

---

## Files to Create or Modify

### New Files
- `src/service-worker.ts` — custom SW source for `injectManifest` mode (Workbox precaching + push/notificationclick handlers)
- `src/server/db/schema/push-subscriptions.ts` — Drizzle table
- `src/server/routes/notifications.ts` — subscribe/unsubscribe/vapid endpoints
- `src/server/services/push.ts` — push delivery service
- `src/client/lib/webrtc/manager.ts` — `WebRTCManager`
- `src/client/lib/webrtc/adapters/twilio.ts` — `TwilioWebRTCAdapter`
- `src/client/lib/webrtc/adapters/vonage.ts` — `VonageWebRTCAdapter`
- `src/client/lib/webrtc/adapters/plivo.ts` — `PlivoWebRTCAdapter`
- `src/client/lib/webrtc/types.ts` — `WebRTCAdapter` interface + shared types
- `src/client/lib/push-subscription.ts` — client-side push subscribe/unsubscribe
- Drizzle migration for `pushSubscriptions` table and `callLegs.type` column

### Modified Files
- `src/server/lib/ringing.ts` — add Web Push delivery after Nostr event
- `src/server/app.ts` — mount notifications routes
- `src/client/lib/webrtc.ts` — refactor into `webrtc/manager.ts` (delete original)
- `src/client/lib/notifications.ts` — integrate push subscription after permission grant
- `src/client/components/notification-prompt-banner.tsx` — add push subscription flow
- `src/client/routes/` — settings page push toggle, dashboard answer-from-notification
- `src/server/db/schema/` — add `type` column to `callLegs`
- `src/server/services/calls.ts` — handle `type: 'browser'` in answer flow, cancel by type, update `createCallLeg()` + `#rowToCallLeg()`
- `src/server/types.ts` — add VAPID env vars to `Env`, update `CallLeg`/`CreateCallLegData` types, update `RingVolunteersParams`
- `src/server/telephony/adapter.ts` — update `RingVolunteersParams` volunteer entry type (`phone` optional, add `browserIdentity`)
- `src/server/telephony/twilio.ts` — emit `<Client>` noun in TwiML for browser volunteers
- `src/server/telephony/vonage.ts` — emit `type: 'app'` NCCO action for browser volunteers
- `src/server/telephony/plivo.ts` — emit `<User>` element in XML for browser volunteers
- `src/server/telephony/signalwire.ts` — ignore `browserIdentity` for now
- `src/server/telephony/asterisk.ts` — ignore `browserIdentity` for now
- `src/server/telephony/webrtc-tokens.ts` — add `ttl` to response
- `src/server/routes/webrtc.ts` — include `ttl` field in token response
- `src/server/routes/calls.ts` — extend answer endpoint with leg cancellation + `cancelRinging()`
- `vite.config.ts` — service worker configuration for push event handler
- `.env.example` / `.env.live.example` — add VAPID env vars

---

## Out of Scope

- Asterisk/JsSIP/SIP.js adapter (separate spec)
- Telnyx WebRTC support
- SignalWire WebRTC token generation
- Push notification analytics/delivery tracking
- End-to-end encryption of push payloads (payload already contains no PII)
- Video calling
