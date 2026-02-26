# Epic 91: Native VoIP Calling — Linphone SDK Turbo Native Module

## Problem Statement

The mobile app needs to receive and handle crisis calls natively — showing the call on the lock screen, integrating with the native phone UI (iOS CallKit, Android ConnectionService), and carrying encrypted voice over SIP/RTP inside the app. The web app has browser WebRTC calling via `@twilio/voice-sdk` (`src/client/lib/webrtc.ts`, 236 LOC), but that's Twilio-specific and browser-only.

Llamenos supports 5 telephony providers (Twilio, SignalWire, Vonage, Plivo, Asterisk) via the `TelephonyAdapter` abstraction. The mobile VoIP layer must be **provider-agnostic**: a single native SIP stack that works with any RFC 3261-compliant SIP endpoint. All 5 providers support standard SIP — this is the universal transport layer.

## Why Linphone SDK

### Alternatives Considered

| Approach | Verdict |
|----------|---------|
| **SIP.js (JS) + react-native-webrtc** | SIP signaling runs in JavaScript — can't run when app is backgrounded. Requires 3+ separate libraries (callkeep, voip-push, webrtc) that must be coordinated. `react-native-callkeep` is stale (last published ~1yr, Expo 54+ issues). |
| **@twilio/voice-react-native-sdk** | Provider-locked to Twilio. Defeats the `TelephonyAdapter` pattern. Significant Android issues (UI freezes, incoming call failures, crashes on RN 0.76+). |
| **react-native-pjsip** | Abandoned (113 open issues, no releases). GPL-3.0 license. Broken on modern RN. |
| **Linphone SDK + Turbo Native Module** | **Selected.** Production-grade native SIP stack (35K+ commits, actively maintained). Handles SIP + media + SRTP/ZRTP + CallKit + ConnectionService + VoIP push ALL natively in a single SDK. Works with any SIP endpoint. AGPLv3 license (Llamenos-compatible). |

### Linphone SDK Overview

[linphone-sdk](https://github.com/BelledonneCommunications/linphone-sdk) by Belledonne Communications (French company):

- **SIP signaling**: Full RFC 3261 — REGISTER, INVITE, BYE, REFER, SUBSCRIBE, MESSAGE, INFO
- **Media**: Native audio/video codecs (Opus, G.722, G.711, Speex), ICE/STUN/TURN for NAT traversal
- **Encryption**: SRTP, ZRTP, DTLS-SRTP — and post-quantum encryption (Crystals-KYBER)
- **iOS**: Native CallKit integration, PushKit VoIP push handling, background audio
- **Android**: Native ConnectionService integration, FCM push handling, foreground service
- **License**: AGPLv3 (open source) or commercial license from Belledonne
- **Platforms**: iOS (arm64), Android (arm64-v8a, x86_64), Desktop (Linux/Windows/macOS)

**No production-quality React Native wrapper exists.** All existing npm packages (`react-native-linphone`, `react-native-linphone-sdk`, etc.) are abandoned or near-zero adoption. We build a **Turbo Native Module** wrapping the iOS (Swift) and Android (Kotlin) SDKs.

## Current State

### Web App WebRTC Architecture (`src/client/lib/webrtc.ts`)

```typescript
// Current web approach — provider-specific, browser-only
switch (provider) {
  case 'twilio':
  case 'signalwire':
    const { Device } = await import('@twilio/voice-sdk')
    // ... browser WebRTC via Twilio Voice SDK
    break
  case 'vonage':
  case 'plivo':
    // Punted — "using WebSocket notification mode"
    break
}
```

### WebRTC Token Endpoint

`GET /api/telephony/webrtc-token` returns provider-specific credentials. Needs extending to return standard SIP connection parameters (SIP domain, WSS URL, credentials) that Linphone SDK can consume.

### Parallel Ringing Architecture (`src/worker/services/ringing.ts`)

1. Server calls each volunteer's phone number via `adapter.ringVolunteers()`
2. Server publishes `KIND_CALL_RING` (kind 1000) to Nostr relay
3. For mobile: server ALSO sends VoIP push (APNs/FCM) to registered devices
4. Call preferences: `'phone'` | `'browser'` | `'both'`
5. First answer wins — `adapter.cancelRinging()` stops other channels

### Provider SIP Support

All 5 providers support standard SIP for call delivery:

| Provider | SIP Transport | Endpoint Format | Auth |
|----------|---------------|-----------------|------|
| **Twilio** | SIP over WSS/TLS | `wss://chunderm.twilio.com/signal` | JWT / SIP digest |
| **SignalWire** | SIP over WSS | `wss://{space}.signalwire.com` | SIP digest |
| **Plivo** | SIP over WSS | `wss://phone.plivo.com/ws` | SIP endpoint creds |
| **Asterisk** | SIP over WSS (chan_pjsip) | `wss://{host}:8089/ws` | SIP digest |
| **Vonage** | SIP Connect (server-to-server) | Via Asterisk SIP gateway | SIP digest via gateway |

**Vonage**: Does not support SIP-over-WebSocket for client registration. Solution: Route Vonage calls through an Asterisk instance as a SIP gateway. Vonage SIP Connect delivers calls to Asterisk; volunteers register to Asterisk via standard SIP. Admin configures the Asterisk gateway endpoint in hub settings.

## Requirements

### Functional Requirements

1. **Turbo Native Module** (`llamenos-sip`) — React Native bridge wrapping Linphone SDK for iOS (Swift) and Android (Kotlin)
2. **SIP registration** — Provider-agnostic SIP REGISTER via WSS to any configured endpoint
3. **CallKit (iOS)** — Incoming calls show on lock screen, notification center, native call screen via Linphone's built-in CallKit integration
4. **ConnectionService (Android)** — Incoming calls show as foreground notification, full-screen intent for lock screen
5. **VoIP push** — iOS PushKit + Android FCM for waking app on incoming call, handled natively by Linphone SDK
6. **Call controls** — Answer, decline, hangup, mute/unmute, speaker toggle, hold — all via native call UI
7. **DTMF** — Touch-tone sending during call
8. **Media encryption** — SRTP mandatory, ZRTP where supported (Asterisk, direct SIP)
9. **Provider mapping** — Server returns SIP connection params, mobile Linphone SDK connects

### Non-Functional Requirements

- Incoming calls visible on lock screen (both platforms)
- iOS 13+ PushKit mandate: Linphone SDK reports to CallKit immediately in native push handler, before JS context starts
- Audio routing: earpiece by default, speaker toggle, Bluetooth device discovery
- Codec: Opus preferred (wideband audio quality for voice clarity)
- STUN/TURN for NAT traversal
- < 3 second answer-to-voice latency
- Background operation: SIP registration maintained via keep-alive, push notifications for incoming calls when app is suspended
- Works with all 5 telephony providers (Vonage via Asterisk SIP gateway)

## Technical Design

### Phase 1: Turbo Native Module Structure

```
llamenos-mobile/
  modules/
    llamenos-sip/
      package.json            — Module metadata
      src/
        index.ts              — JS/TS API surface
        types.ts              — TypeScript type definitions
      ios/
        LlamenosSip.swift     — Swift wrapper around Linphone SDK
        LlamenosSip.mm        — ObjC++ bridge (required for Turbo Modules)
        LlamenosSipModule.swift — Module registration
      android/
        src/main/java/org/llamenos/sip/
          LlamenosSipModule.kt   — Kotlin wrapper around Linphone SDK
          LlamenosSipPackage.kt  — Module registration
        build.gradle              — Linphone SDK Maven dependency
      llamenos-sip.podspec       — CocoaPods spec with Linphone SDK dep
```

### Phase 2: JS API Surface

The Turbo Native Module exposes a minimal, clean API to React Native:

```typescript
// modules/llamenos-sip/src/index.ts

export interface SipConfig {
  /** SIP server domain (e.g., "chunderm.twilio.com") */
  domain: string
  /** SIP transport URI (e.g., "sip:chunderm.twilio.com;transport=tls") */
  transport: string
  /** SIP username for REGISTER */
  username: string
  /** SIP password/token for REGISTER */
  password: string
  /** Display name for caller ID */
  displayName: string
  /** STUN/TURN servers */
  iceServers: Array<{ url: string; username?: string; password?: string }>
  /** Media encryption mode */
  mediaEncryption: 'srtp' | 'zrtp' | 'dtls-srtp' | 'none'
}

export type CallState =
  | 'idle'
  | 'incoming'
  | 'outgoing'
  | 'connecting'
  | 'connected'
  | 'paused'
  | 'ended'
  | 'error'

export type RegistrationState =
  | 'none'
  | 'registering'
  | 'registered'
  | 'failed'
  | 'unregistering'

export interface CallInfo {
  callId: string
  remoteAddress: string
  displayName: string
  duration: number
  state: CallState
  isMuted: boolean
  isSpeaker: boolean
}

// Event callbacks (emitted from native to JS)
export interface SipEvents {
  onRegistrationState: (state: RegistrationState, reason?: string) => void
  onCallState: (callId: string, state: CallState, info: CallInfo) => void
  onCallReceived: (callId: string, remoteAddress: string, displayName: string) => void
  onAudioDeviceChanged: (device: string) => void
}

// Imperative API
export interface LlamenosSipModule {
  /** Initialize Linphone Core with app-specific settings */
  initialize(): Promise<void>

  /** Configure and register with a SIP server */
  register(config: SipConfig): Promise<void>

  /** Unregister from SIP server */
  unregister(): Promise<void>

  /** Answer an incoming call */
  answerCall(callId: string): Promise<void>

  /** Decline an incoming call */
  declineCall(callId: string): Promise<void>

  /** Hang up an active call */
  hangup(callId: string): Promise<void>

  /** Toggle mute on active call */
  setMuted(callId: string, muted: boolean): Promise<void>

  /** Toggle speaker on active call */
  setSpeaker(on: boolean): Promise<void>

  /** Send DTMF tone during active call */
  sendDtmf(callId: string, digit: string): Promise<void>

  /** Put call on hold */
  holdCall(callId: string): Promise<void>

  /** Resume held call */
  resumeCall(callId: string): Promise<void>

  /** Register for VoIP push notifications (returns device token) */
  registerPushNotifications(): Promise<string>

  /** Clean shutdown */
  destroy(): Promise<void>
}
```

### Phase 3: iOS Implementation (Swift)

```swift
// modules/llamenos-sip/ios/LlamenosSip.swift
import linphonesw // Linphone Swift SDK
import CallKit
import PushKit

@objc(LlamenosSip)
class LlamenosSip: NSObject {
    private var core: Core?
    private var account: Account?

    // Linphone SDK handles CallKit integration internally
    // when configured with useCallKit = true

    @objc func initialize(_ resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
        do {
            let factory = Factory.Instance
            // Configure logging, codecs, etc.
            let core = try factory.createCore(
                configPath: nil,
                factoryConfigPath: nil,
                systemContext: nil
            )

            // Enable CallKit
            core.callkitEnabled = true

            // Audio codecs: prefer Opus
            for codec in core.audioPayloadTypes {
                codec.enable = (codec.mimeType == "opus" || codec.mimeType == "PCMU")
            }

            // Media encryption
            core.mediaEncryption = .SRTP
            core.mediaEncryptionMandatory = true

            // Start the core
            try core.start()
            self.core = core

            resolve(nil)
        } catch {
            reject("INIT_ERROR", error.localizedDescription, error)
        }
    }

    @objc func register(_ config: NSDictionary,
                        resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
        guard let core = self.core else {
            reject("NO_CORE", "Core not initialized", nil)
            return
        }

        do {
            let domain = config["domain"] as! String
            let username = config["username"] as! String
            let password = config["password"] as! String
            let transport = config["transport"] as? String ?? "tls"

            // Create auth info
            let authInfo = try Factory.Instance.createAuthInfo(
                username: username,
                userid: nil,
                passwd: password,
                ha1: nil,
                realm: nil,
                domain: domain
            )
            core.addAuthInfo(info: authInfo)

            // Create account params
            let params = try core.createAccountParams()
            let sipAddress = try Factory.Instance.createAddress(
                addr: "sip:\(username)@\(domain)"
            )
            try params.setIdentityaddress(newValue: sipAddress)

            let serverAddress = try Factory.Instance.createAddress(
                addr: "sip:\(domain);transport=\(transport)"
            )
            try params.setServeraddress(newValue: serverAddress)

            params.registerEnabled = true
            params.publishEnabled = false

            // Configure push notification params (iOS PushKit)
            let pushParams = params.pushNotificationConfig
            pushParams?.provider = "apns.voip"
            pushParams?.voipToken = self.voipToken // From registerPushNotifications()

            // STUN/TURN
            if let iceServers = config["iceServers"] as? [[String: String]] {
                let natPolicy = try core.createNatPolicy()
                natPolicy.stunEnabled = true
                natPolicy.iceEnabled = true
                if let first = iceServers.first, let url = first["url"] {
                    natPolicy.stunServer = url
                }
                params.natPolicy = natPolicy
            }

            let account = try core.createAccount(params: params)
            try core.addAccount(account: account)
            core.defaultAccount = account
            self.account = account

            resolve(nil)
        } catch {
            reject("REGISTER_ERROR", error.localizedDescription, error)
        }
    }

    @objc func answerCall(_ callId: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
        guard let call = findCall(callId) else {
            reject("NO_CALL", "Call not found", nil)
            return
        }
        do {
            try call.accept()
            resolve(nil)
        } catch {
            reject("ANSWER_ERROR", error.localizedDescription, error)
        }
    }

    // ... declineCall, hangup, setMuted, setSpeaker, sendDtmf, etc.
    // Each delegates to the corresponding Linphone Core method
}
```

**Key point**: Linphone SDK handles CallKit integration internally. When `core.callkitEnabled = true`, incoming SIP INVITEs automatically trigger `CXProvider.reportNewIncomingCall()`. We do NOT need `react-native-callkeep` as a separate dependency.

### Phase 4: Android Implementation (Kotlin)

```kotlin
// modules/llamenos-sip/android/src/main/java/org/llamenos/sip/LlamenosSipModule.kt
import org.linphone.core.*

class LlamenosSipModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var core: Core? = null
    private var account: Account? = null

    override fun getName() = "LlamenosSip"

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            val factory = Factory.instance()
            factory.setDebugMode(BuildConfig.DEBUG, "LlamenosSip")

            val core = factory.createCore(null, null, reactApplicationContext)

            // Audio codecs
            for (codec in core.audioPayloadTypes) {
                codec.enable(codec.mimeType == "opus" || codec.mimeType == "PCMU")
            }

            // Media encryption
            core.mediaEncryption = MediaEncryption.SRTP
            core.isMediaEncryptionMandatory = true

            // Enable self-managed ConnectionService
            core.isCallkitIntegrationEnabled = true

            core.start()
            this.core = core
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun register(config: ReadableMap, promise: Promise) {
        val core = this.core ?: run {
            promise.reject("NO_CORE", "Core not initialized")
            return
        }

        try {
            val domain = config.getString("domain")!!
            val username = config.getString("username")!!
            val password = config.getString("password")!!

            val authInfo = Factory.instance().createAuthInfo(
                username, null, password, null, null, domain, null
            )
            core.addAuthInfo(authInfo)

            val params = core.createAccountParams()
            val identity = Factory.instance().createAddress("sip:$username@$domain")
            params.identityAddress = identity

            val server = Factory.instance().createAddress("sip:$domain;transport=tls")
            params.serverAddress = server
            params.isRegisterEnabled = true

            // Configure FCM push
            params.pushNotificationConfig?.provider = "fcm"
            params.pushNotificationConfig?.param = fcmToken

            val account = core.createAccount(params)
            core.addAccount(account)
            core.defaultAccount = account
            this.account = account

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("REGISTER_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun answerCall(callId: String, promise: Promise) {
        val call = findCall(callId)
        if (call == null) {
            promise.reject("NO_CALL", "Call not found")
            return
        }
        call.accept()
        promise.resolve(null)
    }

    // ... other methods
}
```

### Phase 5: Provider Config Mapping

The server extends `GET /api/telephony/webrtc-token` to return standardized SIP parameters:

```typescript
// Server response (extended)
interface SipTokenResponse {
  provider: string
  sip: {
    domain: string       // SIP server domain
    transport: string    // "tls", "tcp", "wss"
    username: string     // SIP REGISTER username
    password: string     // SIP REGISTER password/token
    iceServers: Array<{ url: string; username?: string; password?: string }>
    mediaEncryption: 'srtp' | 'zrtp' | 'dtls-srtp'
  }
}

// Client mapping (React Native)
async function connectToProvider() {
  const { sip } = await api.getSipToken()
  await LlamenosSip.register({
    domain: sip.domain,
    transport: sip.transport,
    username: sip.username,
    password: sip.password,
    iceServers: sip.iceServers,
    mediaEncryption: sip.mediaEncryption,
    displayName: 'Llamenos Volunteer',
  })
}
```

Per-provider SIP config:

| Provider | domain | transport | username | password | encryption |
|----------|--------|-----------|----------|----------|------------|
| Twilio | `{account}.pstn.twilio.com` | tls | SIP endpoint username | SIP endpoint password | srtp |
| SignalWire | `{space}.signalwire.com` | tls | SIP endpoint username | SIP endpoint password | srtp |
| Plivo | `phone.plivo.com` | tls | Plivo endpoint username | Plivo endpoint password | srtp |
| Asterisk | `{host}` | tls/wss | PJSIP endpoint username | PJSIP endpoint password | zrtp |
| Vonage | (via Asterisk gateway) | tls | Asterisk endpoint username | Asterisk endpoint password | zrtp |

### Phase 6: VoIP Push Notifications

Linphone SDK handles VoIP push natively on both platforms:

**iOS (PushKit):**
- Linphone SDK registers a `PKPushRegistry` delegate
- When VoIP push arrives, SDK immediately reports to CallKit (iOS 13+ mandate handled internally)
- JS context doesn't need to be running — the native SDK handles the push → CallKit → answer flow
- Push token obtained via `LlamenosSip.registerPushNotifications()`

**Android (FCM):**
- Linphone SDK receives FCM data messages
- Triggers foreground service with incoming call notification
- `USE_FULL_SCREEN_INTENT` permission enables lock-screen display

**Server-side push dispatch:**

```typescript
// In ringing service, alongside Nostr relay broadcast
for (const volunteer of mobileVolunteers) {
  if (volunteer.sipPushToken) {
    if (volunteer.platform === 'ios') {
      // APNs VoIP push
      await sendApnsVoipPush(volunteer.sipPushToken, {
        callId: callSid,
        caller: callerDisplay,
      })
    } else {
      // FCM data message
      await sendFcmDataMessage(volunteer.sipPushToken, {
        type: 'incoming_call',
        callId: callSid,
        caller: callerDisplay,
      })
    }
  }
}
```

### Phase 7: React Integration

```typescript
// src/lib/voip.ts — React hooks for VoIP
import { useEffect, useState, useCallback } from 'react'
import { NativeEventEmitter, NativeModules } from 'react-native'
import type { CallState, CallInfo, RegistrationState, SipConfig } from 'llamenos-sip'

const { LlamenosSip } = NativeModules
const sipEmitter = new NativeEventEmitter(LlamenosSip)

export function useVoip() {
  const [registrationState, setRegistrationState] = useState<RegistrationState>('none')
  const [activeCall, setActiveCall] = useState<CallInfo | null>(null)

  useEffect(() => {
    const regSub = sipEmitter.addListener('onRegistrationState', (state) => {
      setRegistrationState(state)
    })

    const callSub = sipEmitter.addListener('onCallState', (callId, state, info) => {
      if (state === 'ended' || state === 'idle') {
        setActiveCall(null)
      } else {
        setActiveCall(info)
      }
    })

    return () => {
      regSub.remove()
      callSub.remove()
    }
  }, [])

  const answerCall = useCallback(async (callId: string) => {
    await LlamenosSip.answerCall(callId)
  }, [])

  const hangup = useCallback(async (callId: string) => {
    await LlamenosSip.hangup(callId)
  }, [])

  const toggleMute = useCallback(async (callId: string, muted: boolean) => {
    await LlamenosSip.setMuted(callId, muted)
  }, [])

  const toggleSpeaker = useCallback(async (on: boolean) => {
    await LlamenosSip.setSpeaker(on)
  }, [])

  return {
    registrationState,
    activeCall,
    answerCall,
    hangup,
    toggleMute,
    toggleSpeaker,
  }
}
```

### Permissions

**iOS** (`app.json`):
```json
{
  "ios": {
    "infoPlist": {
      "NSMicrophoneUsageDescription": "Llamenos needs microphone access to answer crisis calls",
      "UIBackgroundModes": ["voip", "audio", "fetch"]
    }
  }
}
```

**Android** (`app.json`):
```json
{
  "android": {
    "permissions": [
      "RECORD_AUDIO",
      "MODIFY_AUDIO_SETTINGS",
      "BLUETOOTH",
      "BLUETOOTH_CONNECT",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_PHONE_CALL",
      "USE_FULL_SCREEN_INTENT",
      "MANAGE_OWN_CALLS"
    ]
  }
}
```

## Files to Create

### Turbo Native Module (`~/projects/llamenos-mobile/modules/llamenos-sip/`)

```
package.json
src/
  index.ts                 — JS/TS API surface + types
  types.ts                 — TypeScript type definitions
ios/
  LlamenosSip.swift        — Swift implementation wrapping Linphone Core
  LlamenosSip.mm           — ObjC++ bridge for Turbo Module
  LlamenosSipModule.swift  — Module registration
android/
  src/main/java/org/llamenos/sip/
    LlamenosSipModule.kt   — Kotlin implementation wrapping Linphone Core
    LlamenosSipPackage.kt  — Module registration
  build.gradle             — Linphone SDK Maven dep
llamenos-sip.podspec       — CocoaPods spec with Linphone SDK dep
```

### React Integration (`~/projects/llamenos-mobile/src/`)

```
src/
  lib/
    voip.ts               — useVoip() hook + VoIP initialization
    voip-config.ts        — Provider config mapping (server token → SipConfig)
  components/
    ActiveCallScreen.tsx  — In-call UI (mute, speaker, hangup, DTMF)
    IncomingCallCard.tsx  — Incoming call overlay (shown via Nostr event)
```

### Server (`~/projects/llamenos`)

```
src/worker/
  routes/webrtc.ts        — Extend with SIP connection params
  routes/push.ts          — New: VoIP push token registration + dispatch
  services/ringing.ts     — Extend to dispatch VoIP pushes alongside Nostr events
```

## Acceptance Criteria

- [ ] Turbo Native Module compiles for iOS (arm64)
- [ ] Turbo Native Module compiles for Android (arm64-v8a, x86_64)
- [ ] Linphone Core initializes with Opus + SRTP enabled
- [ ] SIP REGISTER succeeds with Twilio SIP endpoint
- [ ] SIP REGISTER succeeds with SignalWire SIP endpoint
- [ ] SIP REGISTER succeeds with Plivo SIP endpoint
- [ ] SIP REGISTER succeeds with Asterisk chan_pjsip endpoint
- [ ] Incoming call shows on iOS lock screen via CallKit
- [ ] Incoming call shows on Android via ConnectionService foreground notification
- [ ] User can answer call from native call screen → audio connected
- [ ] User can decline call from native call screen → SIP 603 Decline sent
- [ ] User can hangup from native call screen → SIP BYE sent
- [ ] Mute/unmute works from native call UI and in-app UI
- [ ] Speaker toggle works
- [ ] DTMF tones can be sent during call
- [ ] SRTP encryption is active on all calls
- [ ] iOS VoIP push wakes app from killed state → CallKit shows immediately
- [ ] Android FCM high-priority wakes app → ConnectionService notification shows
- [ ] Voice quality: Opus codec negotiated, < 200ms RTT
- [ ] Audio routing: earpiece default, speaker toggle, Bluetooth discovery
- [ ] VoIP push token registered with server per volunteer
- [ ] Server dispatches VoIP push alongside Nostr relay events on incoming call
- [ ] SIP token endpoint returns standardized connection parameters
- [ ] Vonage calls route through Asterisk SIP gateway successfully

## Dependencies

- **Epic 83** (Mobile Foundation) — React Native project must build
- **Epic 84** (Mobile Core Screens) — Nostr relay integration for call state updates
- **Epic 86** (Push Notifications) — General push infrastructure (VoIP push is separate but coordinated)

## Blocks

- **Epic 88** (E2E Tests) — Need to test VoIP call flow
- **Epic 89** (UI Polish) — Call screen accessibility, haptics on answer

## Known Risks

1. **Linphone SDK build size**: The SDK adds ~15-20MB per platform to the app binary. This is acceptable for a VoIP app but should be noted for download size considerations.

2. **Expo compatibility**: Linphone SDK is a native dependency that requires a development build (`expo prebuild`). It cannot run in Expo Go. This is expected — any VoIP library requires native modules.

3. **Twilio SIP endpoint setup**: Twilio's SIP Registration for WebRTC clients is separate from their Voice SDK. Need to create a Twilio SIP Domain + Credential List per hub, and configure the `TelephonyAdapter` to provision these alongside the TwiML App.

4. **iOS simulator**: CallKit does not work on iOS simulator. Requires physical device for all VoIP testing.

5. **AGPLv3 compliance**: The Linphone SDK is AGPLv3. Llamenos is AGPLv3-compatible. Ensure the mobile app's license declaration covers this dependency. Source code for the native module must be available.

6. **Linphone SDK updates**: Pin to a specific SDK version and test before upgrading. The SDK's API can change between major versions.
