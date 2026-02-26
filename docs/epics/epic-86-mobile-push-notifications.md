# Epic 86: Mobile Push Notifications

## Problem Statement

Volunteers need to receive incoming call and message notifications even when the mobile app is backgrounded or the device is locked. Without push notifications, volunteers would miss calls entirely on mobile, defeating the purpose of the mobile app.

## Requirements

### Functional Requirements

1. **iOS VoIP push** — APNs VoIP push with CallKit integration for incoming calls
2. **Android FCM** — High-priority data messages for incoming calls
3. **Message notifications** — Push for new conversation messages
4. **Shift reminders** — Push notifications before shift starts
5. **Notification tap** — Navigate to relevant screen on tap
6. **Push token registration** — Register device push tokens with server
7. **Encrypted payloads** — Two-tier encryption (wake key + pubkey) per Epic 75 spec

### Non-Functional Requirements

- Call notification within 1 second of ring start
- iOS: CallKit UI shown within 30 seconds of VoIP push (Apple requirement)
- Push payload encrypted — Apple/Google see only opaque ciphertext
- Battery efficient — no persistent background connections

## Technical Design

### Architecture

Per Epic 75's push notification design:

1. **Wake key** — Device-specific symmetric key stored in Keychain/Keystore, accessible without PIN
2. **Two-tier decryption**:
   - Wake key decrypts minimal payload (callId, signal type) — no PIN needed
   - nsec decrypts full payload (caller details) — requires PIN unlock

### Server-Side

New API endpoint:
```
POST /api/devices/register
{
  platform: 'ios' | 'android',
  pushToken: string,
  voipToken?: string,        // iOS only
  wakeKeyPublic: string,     // Device-specific wake key
}
```

Server sends push on:
- Incoming call (to all on-shift volunteer devices)
- New message in assigned conversation
- Shift starting in 15 minutes

### iOS Implementation

- **expo-notifications** for regular push
- **VoIP push** requires native module (react-native-voip-push-notification)
- **CallKit** via react-native-callkeep for native call UI
- Wake key stored in Keychain with `kSecAttrAccessibleAfterFirstUnlock`

### Android Implementation

- **expo-notifications** with FCM high-priority data messages
- **Foreground service** for active call (prevents process kill)
- **Full-screen intent** for incoming call on lock screen
- Wake key stored in Android Keystore (no auth required)

### Notification Categories

| Category | Priority | Sound | Vibration | Action |
|----------|----------|-------|-----------|--------|
| Incoming call | Critical | Ringtone | Yes | Answer / Decline |
| New message | High | Default | Yes | Open conversation |
| Shift reminder | Normal | Default | No | Open shifts |

## Files to Create/Modify

### Mobile (`~/projects/llamenos-mobile`)
- `src/lib/push-notifications.ts` — Expo Notifications setup + token registration
- `src/lib/wake-key.ts` — Wake key generation, storage, encryption/decryption
- `src/lib/background-tasks.ts` — Background handlers for push processing
- Native iOS module for VoIP push (if expo-notifications insufficient)

### Server (`~/projects/llamenos`)
- `src/worker/api/devices.ts` — Device registration endpoint
- `src/worker/lib/push.ts` — Push dispatch logic (APNs + FCM)
- `src/worker/durable-objects/call-router.ts` — Add push sending on incoming call

## Acceptance Criteria

- [ ] Push token registered with server on app launch
- [ ] Incoming call notification received when app is backgrounded
- [ ] iOS: CallKit UI shown within 30s of VoIP push
- [ ] Android: Full-screen intent shown on lock screen for calls
- [ ] Message notification received and tappable → opens conversation
- [ ] Shift reminder notification 15 minutes before shift
- [ ] Push payload encrypted (wake key tier works without PIN)
- [ ] Full call details available only after PIN unlock

## Dependencies

- **Epic 83** (Mobile Foundation) — API client, key management
- **Epic 84** (Mobile Core Screens) — screens to navigate to on notification tap
- **Epic 75** (Native Call Clients) — push architecture spec, wake key design
