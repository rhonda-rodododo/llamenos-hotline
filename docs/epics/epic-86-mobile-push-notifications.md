# Epic 86: Mobile Push Notifications

## Problem Statement

Volunteers need to receive message and shift reminder notifications even when the mobile app is backgrounded or the device is locked. Without push notifications, volunteers would miss new conversation messages and upcoming shifts on mobile.

**Scope clarification:** This epic covers **non-VoIP push only** — messages, shift reminders, and general alerts via `expo-notifications` with direct APNs/FCM. VoIP push (incoming calls via PushKit/CallKit on iOS and FCM high-priority + ConnectionService on Android) is handled entirely by **Epic 91** (Native VoIP Calling), where the Linphone SDK manages VoIP push registration, CallKit/ConnectionService integration, and call notification display natively.

## Current State

### What Exists

**Server-side notification dispatch:**
- `CallRouterDO` (`src/worker/durable-objects/call-router.ts`) publishes Nostr events for calls and messages — this is the **only** notification mechanism today.
- `publishNostrEvent()` helper (line ~472) publishes to the Nostr relay via `NostrPublisher` interface.
- **No push dispatch exists.** No device registration endpoint, no APNs/FCM sender, no push token storage.

**Web app notifications:**
- `src/client/lib/notifications.ts` — Browser Notification API only (`new Notification(...)`) for foreground call alerts.
- PWA service worker (Workbox) — no push event handler, no `PushManager.subscribe()`, no VAPID.
- `notification-prompt-banner.tsx` — UI to request browser notification permission.

**What does NOT exist (all needed for this epic):**
| Component | Status |
|-----------|--------|
| `POST /api/devices/register` endpoint | Does not exist |
| Device/push token storage in any DO | Does not exist |
| Wake key registration or crypto | Does not exist |
| Push dispatch from CallRouterDO | Does not exist |
| FCM sender library | Does not exist |
| APNs sender library | Does not exist |
| Two-tier payload encryption | Does not exist |
| `Env` bindings for FCM/APNs credentials | Does not exist |
| Crypto labels for push encryption | Does not exist |

### Nostr Event Kinds (push should mirror these)

| Constant | Kind | Type | Push? |
|----------|------|------|-------|
| `KIND_CALL_RING` | 1000 | Incoming call | **Epic 91** (VoIP push) |
| `KIND_CALL_UPDATE` | 1001 | Call answered/completed | No (informational) |
| `KIND_CALL_VOICEMAIL` | 1002 | Voicemail received | Yes (this epic) |
| `KIND_MESSAGE_NEW` | 1010 | New conversation message | **Yes (this epic)** |
| `KIND_CONVERSATION_ASSIGNED` | 1011 | Assignment changed | Yes (this epic) |
| `KIND_SHIFT_UPDATE` | 1020 | Schedule changed | **Yes (this epic)** |
| `KIND_PRESENCE_UPDATE` | 20000 | Online counts | No (ephemeral) |
| `KIND_CALL_SIGNAL` | 20001 | WebRTC signaling | No (ephemeral) |

### Server Architecture for Push

**Integration points identified in the codebase:**

1. **`src/worker/durable-objects/call-router.ts` line ~198** — After `publishNostrEvent(KIND_CALL_RING, ...)`, add `dispatchPushToVolunteers()`. This handles call ring push (Epic 91) AND voicemail push (this epic).

2. **`src/worker/durable-objects/conversation-do.ts`** — After message creation, add push dispatch for `KIND_MESSAGE_NEW` to assigned volunteer.

3. **`src/worker/durable-objects/shift-manager-do.ts`** — Add scheduled push dispatch for shift reminders (15 minutes before shift start).

4. **`src/worker/types.ts` `Env` interface** — Needs new bindings: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `FCM_SERVICE_ACCOUNT_KEY`.

5. **`src/shared/crypto-labels.ts`** — Needs `LABEL_PUSH_WAKE` and `LABEL_PUSH_FULL` constants.

### Why Direct APNs/FCM (Not Expo Push Service)

For a security-focused crisis hotline:

1. **No third-party intermediary** — Expo Push Service is a proxy that sees push token + payload. Direct APNs/FCM eliminates this intermediary.
2. **Encrypted payloads** — Direct dispatch lets us send opaque ciphertext. Expo's service requires structured JSON.
3. **Self-hosted compatibility** — Operators running their own server need to send push without an Expo account.
4. **Worker-compatible libraries exist:**
   - **APNs**: `@fivesheepco/cloudflare-apns2` (v13.0.0) — uses HTTP/2 via Cloudflare proxy to `api.push.apple.com`. Works in Workers/Durable Objects.
   - **FCM**: `fcm-cloudflare-workers` — Google FCM HTTP v1 API via service account JWT. Works in Workers.

### expo-notifications Capabilities

`expo-notifications` handles:
- Device token retrieval: `getDevicePushTokenAsync()` returns native APNs/FCM token (not Expo push token)
- Notification display when app is backgrounded
- Notification categories with action buttons
- Badge count management
- Background notification handlers via `setNotificationHandler()`
- Tap handling via `addNotificationResponseReceivedListener()`
- Foreground display control

`expo-notifications` does **NOT** handle:
- VoIP push (PushKit) — requires native module (handled by Linphone SDK in Epic 91)
- CallKit/ConnectionService integration — native only (Epic 91)
- Persistent background connections — not needed with push

## Requirements

### Functional Requirements

1. **Push token registration** — Register device APNs/FCM token with server on app launch and token refresh
2. **Message notifications** — Push when new message arrives in assigned/waiting conversation
3. **Voicemail notifications** — Push when voicemail left on a call
4. **Shift reminders** — Push 15 minutes before shift starts
5. **Conversation assignment** — Push when conversation assigned to volunteer
6. **Notification tap** — Navigate to relevant screen (conversation, shifts, etc.)
7. **Notification categories** — Action buttons on notifications (e.g., "Open", "Mark Read")
8. **Encrypted payloads** — Two-tier encryption: wake key decrypts minimal metadata, nsec decrypts full content
9. **Badge count** — Unread count on app icon
10. **Foreground handling** — Display in-app banner when notification received while app is open

### Non-Functional Requirements

- Message notification within 2 seconds of server receipt
- Push payload encrypted — Apple/Google see only opaque ciphertext
- Battery efficient — no persistent background connections (push only)
- Failed push delivery handled gracefully (stale tokens cleaned up)
- Self-hosted operators can configure their own APNs/FCM credentials

## Technical Design

### Phase 1: Client — Push Token Registration

```typescript
// src/lib/push-notifications.ts

import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { apiClient } from './api-client'

export async function registerForPush(): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return

  // Get NATIVE token (not Expo push token)
  const tokenData = await Notifications.getDevicePushTokenAsync()
  // tokenData.type: 'ios' | 'android'
  // tokenData.data: string (APNs device token or FCM registration token)

  await apiClient.post('/api/devices/register', {
    platform: Platform.OS,  // 'ios' | 'android'
    pushToken: tokenData.data,
    wakeKeyPublic: await getOrCreateWakeKey(),
  })
}

// Re-register on token refresh
Notifications.addPushTokenListener((token) => {
  apiClient.post('/api/devices/register', {
    platform: Platform.OS,
    pushToken: token.data,
    wakeKeyPublic: getWakeKeyPublic(),
  }).catch(() => {})  // Silent retry on next launch
})
```

### Phase 2: Wake Key — Two-Tier Push Encryption

The wake key enables decrypting push payloads without requiring the volunteer's PIN (nsec is locked until PIN entry). This allows showing minimal notification content (e.g., "New message in conversation") on the lock screen.

```typescript
// src/lib/wake-key.ts

import * as SecureStore from 'expo-secure-store'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { randomBytes } from '@noble/ciphers/crypto.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { LABEL_PUSH_WAKE } from '@/shared/crypto-labels'

const WAKE_KEY_STORE_KEY = 'llamenos:wake-key'

// Generate or retrieve wake key (secp256k1 keypair)
export async function getOrCreateWakeKey(): Promise<string> {
  let privHex = await SecureStore.getItemAsync(WAKE_KEY_STORE_KEY, {
    // Accessible without user authentication (needed for background push)
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  })

  if (!privHex) {
    const privBytes = randomBytes(32)
    privHex = bytesToHex(privBytes)
    await SecureStore.setItemAsync(WAKE_KEY_STORE_KEY, privHex, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    })
  }

  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privHex), true))
}

// Decrypt wake-tier payload (no PIN needed)
export async function decryptWakePayload(encrypted: string): Promise<WakePayload> {
  const privHex = await SecureStore.getItemAsync(WAKE_KEY_STORE_KEY)
  if (!privHex) throw new Error('No wake key')
  // ECIES decrypt using LABEL_PUSH_WAKE domain separation
  return JSON.parse(eciesDecrypt(encrypted, hexToBytes(privHex), LABEL_PUSH_WAKE))
}
```

**Wake payload (minimal, no PII):**
```typescript
interface WakePayload {
  type: 'message' | 'voicemail' | 'shift_reminder' | 'assignment'
  // message: conversationId, channelType
  // voicemail: callId
  // shift_reminder: shiftId, startsAt
  // assignment: conversationId
}
```

**Full payload (requires nsec unlock):**
```typescript
interface FullPushPayload extends WakePayload {
  // message: sender contact last4, preview text (encrypted)
  // voicemail: duration, caller last4 (encrypted)
  // shift_reminder: shift name, role
}
```

### Phase 3: Notification Categories & Handlers

```typescript
// src/lib/notification-categories.ts

import * as Notifications from 'expo-notifications'

export async function setupNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('message', [
    { identifier: 'open', buttonTitle: 'Open', options: { opensAppToForeground: true } },
    { identifier: 'markRead', buttonTitle: 'Mark Read', options: { opensAppToForeground: false } },
  ])

  await Notifications.setNotificationCategoryAsync('voicemail', [
    { identifier: 'open', buttonTitle: 'Listen', options: { opensAppToForeground: true } },
  ])

  await Notifications.setNotificationCategoryAsync('shift', [
    { identifier: 'open', buttonTitle: 'View Shifts', options: { opensAppToForeground: true } },
  ])
}
```

### Phase 4: Background & Foreground Handlers

```typescript
// src/lib/notification-handlers.ts

import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { decryptWakePayload } from './wake-key'

// Background handler — runs when notification received while app is in background
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data
    const wake = await decryptWakePayload(data.encrypted)

    return {
      shouldShowAlert: true,
      shouldPlaySound: wake.type !== 'shift_reminder',
      shouldSetBadge: true,
      priority: wake.type === 'voicemail'
        ? Notifications.AndroidNotificationPriority.HIGH
        : Notifications.AndroidNotificationPriority.DEFAULT,
    }
  },
})

// Tap handler — navigate to relevant screen
export function setupNotificationTapHandler(): void {
  Notifications.addNotificationResponseReceivedListener(async (response) => {
    const data = response.notification.request.content.data
    const wake = await decryptWakePayload(data.encrypted)

    switch (wake.type) {
      case 'message':
      case 'assignment':
        router.push(`/conversation/${wake.conversationId}`)
        break
      case 'voicemail':
        router.push(`/call/${wake.callId}`)
        break
      case 'shift_reminder':
        router.push('/(tabs)/shifts')
        break
    }

    // Handle action buttons
    if (response.actionIdentifier === 'markRead') {
      // Mark conversation as read via API
    }
  })
}
```

### Phase 5: Server — Device Registration API

```typescript
// src/worker/api/devices.ts

interface DeviceRegistration {
  platform: 'ios' | 'android'
  pushToken: string
  wakeKeyPublic: string  // secp256k1 compressed public key (hex)
}

// POST /api/devices/register
// Stores device record in IdentityDO keyed by volunteer pubkey
// Handles token refresh (upserts by platform+pushToken)
// Returns 204 on success
```

**Storage in IdentityDO:**

```typescript
// Key: `devices:${volunteerPubkey}`
// Value: DeviceRecord[]
interface DeviceRecord {
  platform: 'ios' | 'android'
  pushToken: string
  wakeKeyPublic: string
  registeredAt: string
  lastSeenAt: string
}
```

**Token cleanup:** On 410 (APNs) or `NotRegistered` (FCM) response, remove stale device record.

### Phase 6: Server — Push Dispatch Service

```typescript
// src/worker/lib/push-dispatch.ts

import { ApnsClient } from '@fivesheepco/cloudflare-apns2'
import { FcmClient } from './fcm-client'  // Wrapper around fcm-cloudflare-workers

export interface PushDispatcher {
  sendToVolunteer(
    volunteerPubkey: string,
    wakePayload: WakePayload,
    fullPayload: FullPushPayload
  ): Promise<void>

  sendToAllOnShift(
    wakePayload: WakePayload,
    fullPayload: FullPushPayload
  ): Promise<void>
}
```

**APNs integration (`@fivesheepco/cloudflare-apns2`):**

```typescript
// Works in Cloudflare Workers — uses HTTP/2 via CF proxy
const apns = new ApnsClient({
  team: env.APNS_TEAM_ID,
  keyId: env.APNS_KEY_ID,
  signingKey: env.APNS_KEY_P8,
  defaultTopic: 'org.llamenos.mobile',
})

// Build notification
const notification = new Notification(deviceToken, {
  aps: {
    alert: { title: 'New Message', body: '...' },
    badge: unreadCount,
    sound: 'default',
    'mutable-content': 1,  // Allow notification service extension to decrypt
    category: 'message',
  },
  encrypted: encryptedWakePayload,  // Custom key — ECIES encrypted
  encryptedFull: encryptedFullPayload,
})
```

**FCM integration (`fcm-cloudflare-workers`):**

```typescript
// FCM HTTP v1 API — works in Workers
// Uses data-only messages for encrypted payloads
const message = {
  token: deviceToken,
  data: {
    encrypted: encryptedWakePayload,
    encryptedFull: encryptedFullPayload,
    type: 'message',  // For notification channel routing
  },
  android: {
    priority: 'high',
    notification: {
      channelId: 'messages',
      title: 'New Message',
      body: '...',
      sound: 'default',
    },
  },
}
```

### Phase 7: Server — Push Encryption

```typescript
// src/worker/lib/push-encryption.ts

import { LABEL_PUSH_WAKE, LABEL_PUSH_FULL } from '@shared/crypto-labels'

// Encrypt wake-tier payload for a specific device
function encryptWakePayload(
  payload: WakePayload,
  deviceWakeKeyPublic: string
): string {
  // ECIES: ephemeral keypair → ECDH → HKDF(LABEL_PUSH_WAKE) → XChaCha20-Poly1305
  return eciesEncrypt(JSON.stringify(payload), deviceWakeKeyPublic, LABEL_PUSH_WAKE)
}

// Encrypt full payload for volunteer's nsec
function encryptFullPayload(
  payload: FullPushPayload,
  volunteerPubkey: string
): string {
  // ECIES: ephemeral keypair → ECDH → HKDF(LABEL_PUSH_FULL) → XChaCha20-Poly1305
  return eciesEncrypt(JSON.stringify(payload), volunteerPubkey, LABEL_PUSH_FULL)
}
```

### Phase 8: Integration Points in Existing DOs

**ConversationDO — New message push:**
```typescript
// After saving new inbound message:
// 1. Publish Nostr event (existing)
this.publishNostrEvent(KIND_MESSAGE_NEW, { conversationId, channelType })

// 2. Dispatch push to assigned volunteer (new)
await pushDispatcher.sendToVolunteer(assignedVolunteerPubkey, {
  type: 'message',
  conversationId,
  channelType,
}, {
  type: 'message',
  conversationId,
  channelType,
  senderLast4: contact.last4,  // encrypted in full tier
})
```

**ShiftManagerDO — Shift reminder push:**

A new scheduled handler (Cron Trigger or Durable Object alarm) runs every 5 minutes, checks for shifts starting within 15 minutes, and dispatches push to each assigned volunteer:

```typescript
// Alarm handler in ShiftManagerDO
async alarm(): Promise<void> {
  const upcomingShifts = await this.getShiftsStartingWithin(15 * 60 * 1000)
  for (const shift of upcomingShifts) {
    for (const volunteerPubkey of shift.assignedVolunteers) {
      await pushDispatcher.sendToVolunteer(volunteerPubkey, {
        type: 'shift_reminder',
        shiftId: shift.id,
        startsAt: shift.startTime,
      }, { ... })
    }
  }
  // Schedule next alarm in 5 minutes
  this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000)
}
```

**CallRouterDO — Voicemail push:**
```typescript
// After handleVoicemailLeft:
// 1. Publish Nostr event (existing)
this.publishNostrEvent(KIND_CALL_VOICEMAIL, { callId, startedAt })

// 2. Dispatch push to all on-shift volunteers (new)
await pushDispatcher.sendToAllOnShift({
  type: 'voicemail',
  callId,
}, { ... })
```

### Android Notification Channels

Android requires notification channels (API 26+). Configure in `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["expo-notifications", {
        "androidMode": "default",
        "androidCollapsedTitle": "#{unread_notifications} new notifications"
      }]
    ],
    "android": {
      "notificationChannels": [
        {
          "channelId": "messages",
          "name": "Messages",
          "importance": 4,
          "sound": "default",
          "vibrationPattern": [0, 250, 250, 250]
        },
        {
          "channelId": "voicemail",
          "name": "Voicemails",
          "importance": 4,
          "sound": "default"
        },
        {
          "channelId": "shifts",
          "name": "Shift Reminders",
          "importance": 3,
          "sound": "default",
          "vibrationPattern": [0, 250]
        }
      ]
    }
  }
}
```

### Env Bindings Required

```typescript
// Additions to src/worker/types.ts Env interface
interface Env {
  // ... existing bindings ...

  // APNs (iOS push)
  APNS_KEY_P8: string       // Apple Push Notification auth key (PEM format)
  APNS_KEY_ID: string       // Key ID from Apple Developer Portal
  APNS_TEAM_ID: string      // Apple Developer Team ID

  // FCM (Android push)
  FCM_SERVICE_ACCOUNT_KEY: string  // Google Cloud service account JSON
}
```

## Files to Create/Modify

### Mobile (`~/projects/llamenos-mobile`)
- `src/lib/push-notifications.ts` — Token registration, permission request, token refresh listener
- `src/lib/wake-key.ts` — Wake key generation, storage in SecureStore, ECIES decrypt
- `src/lib/notification-categories.ts` — Category setup (message, voicemail, shift)
- `src/lib/notification-handlers.ts` — Background handler, tap navigation, action button handlers
- `app.json` — Android notification channels config, expo-notifications plugin

### Server (`~/projects/llamenos`)
- `src/worker/api/devices.ts` — `POST /api/devices/register` endpoint
- `src/worker/lib/push-dispatch.ts` — PushDispatcher with APNs/FCM clients
- `src/worker/lib/push-encryption.ts` — Two-tier ECIES payload encryption
- `src/worker/lib/fcm-client.ts` — FCM HTTP v1 wrapper for Workers
- `src/shared/crypto-labels.ts` — Add `LABEL_PUSH_WAKE`, `LABEL_PUSH_FULL`
- `src/worker/types.ts` — Add `Env` bindings, `DeviceRecord` type, `Volunteer.devices` field
- `src/worker/durable-objects/identity-do.ts` — Device storage (`devices:${pubkey}` key)
- `src/worker/durable-objects/call-router.ts` — Add voicemail push dispatch
- `src/worker/durable-objects/conversation-do.ts` — Add message push dispatch
- `src/worker/durable-objects/shift-manager-do.ts` — Add shift reminder alarm + push

### Dependencies to Install

```bash
# Mobile
npx expo install expo-notifications

# Server
bun add @fivesheepco/cloudflare-apns2 fcm-cloudflare-workers
```

## Acceptance Criteria

- [ ] Push token registered with server on app launch (both iOS and Android)
- [ ] Token refresh handled automatically (re-registers with server)
- [ ] Wake key generated and stored in SecureStore (accessible without PIN)
- [ ] New message push received when app is backgrounded
- [ ] Voicemail push received when app is backgrounded
- [ ] Shift reminder push received 15 minutes before shift
- [ ] Conversation assignment push received
- [ ] Push payload encrypted — Apple/Google see only opaque ciphertext
- [ ] Wake-tier decryption works without PIN (minimal metadata only)
- [ ] Full-tier decryption works after PIN unlock (detailed content)
- [ ] Notification tap navigates to correct screen (conversation, shifts, call)
- [ ] Notification categories with action buttons work (Open, Mark Read)
- [ ] Android notification channels configured (messages, voicemail, shifts)
- [ ] Badge count updates on app icon
- [ ] Foreground notifications display as in-app banners
- [ ] Stale push tokens cleaned up on APNs 410 / FCM NotRegistered

## Dependencies

- **Epic 83** (Mobile Foundation) — API client, key management, expo-secure-store
- **Epic 84** (Mobile Core Screens) — screens to navigate to on notification tap
- **Epic 91** (Native VoIP Calling) — handles all VoIP/call push separately via Linphone SDK

## Does NOT Include

- VoIP push (PushKit/FCM high-priority for calls) — **Epic 91**
- CallKit / ConnectionService call UI — **Epic 91**
- Incoming call ring notification — **Epic 91**
- Web push (service worker Push API) — future, not needed for mobile
