# Mobile Multi-Hub Background Services

**Date:** 2026-03-20
**Status:** Approved for implementation
**Priority:** P0 — users on shift in multiple hubs receive no calls or notifications from non-active hubs
**Depends on:** `2026-03-20-mobile-multi-hub-switching.md` (spec 1 — hub key infrastructure, HubContext/ActiveHubState)

---

## Problem Statement

Spec 1 (mobile-multi-hub-switching) establishes the UI active hub context and the `hp()` path helper. But active-hub switching alone is insufficient for multi-hub users: a volunteer on shift in Hub A and Hub B must receive calls, relay events, and push notifications from both hubs simultaneously — regardless of which hub is currently displayed in the UI.

Currently:
- Hub keys are loaded only for the active hub — relay events from other hubs cannot be decrypted
- `WakePayload` and `FullPushPayload` carry no `hubId` — the client cannot route an incoming notification to the correct hub
- Linphone is documented in Epic 91 but designed for React Native, which is not the app architecture. No native Linphone integration exists
- The relay WebSocket emits bare `HubEvent` values with no hub attribution — consumers cannot distinguish which hub an event belongs to
- SIP registration (for VoIP calls) is not implemented on mobile at all

This spec implements the background layer: eager hub key loading, hub-attributed relay events, `hubId` in push payloads, per-hub activity indicators in the hub list, and native Linphone integration for iOS (Swift) and Android (Kotlin).

---

## Architecture

### Two Parallel Layers

| Layer | Spec | Scope | Hub keys needed |
|---|---|---|---|
| UI / data browsing | Spec 1 | Active hub only | Active hub |
| Background services | This spec | All hubs simultaneously | All hubs |

The relay WebSocket connection remains single (one connection to strfry). All hub keys are cached eagerly at login. Each incoming relay event is decrypted by trying each cached hub key in turn — first success identifies the source hub. Hub membership is typically single digits, so O(n) per event is negligible.

### Approach: Eager Key Loading + Hub-Tagged Events

- At login: load hub keys for **all** hubs the user belongs to
- Relay events: try all cached keys, emit `(hubId, event)` pairs
- Push payloads: carry `hubId` for routing
- SIP (Linphone): register one account per hub the user is on shift in; accounts added/removed on shift state changes
- VoIP push: `hubId` in payload → accepting a call switches `activeHubId`

---

## Backend Changes

### 1. Add `hubId` to Push Payloads

`apps/worker/types/infra.ts` — add `hubId: string` to `WakePayload` and `FullPushPayload`:

```typescript
export interface WakePayload {
  hubId: string          // NEW — identifies which hub this push belongs to
  type: PushNotificationType
  callId?: string
  conversationId?: string
  channelType?: string
  shiftId?: string
  startsAt?: string
}

export interface FullPushPayload extends WakePayload {
  senderLast4?: string
  previewText?: string
  duration?: number
  callerLast4?: string
  shiftName?: string
  role?: string
}
```

All push dispatch call sites in `push-dispatch.ts` and `voip-push.ts` already operate within a hub context — populate `hubId` from that context. Update the protocol schema and run codegen.

### 2. `hubId` in VoIP Push Payload

`apps/worker/lib/voip-push.ts` — the VoIP push payload sent to Linphone must include `hubId` so the native call handler can route correctly:

```typescript
// Payload sent to APNs (PushKit) and FCM (high-priority)
{
  callId: string,
  caller: string,   // obfuscated caller display
  hubId: string,    // NEW
}
```

### 3. No New Endpoints

Device token registration is already per-user (not per-hub) — correct. One device registration covers all hubs. `GET /hubs/{hubId}/telephony/sip-token` already exists and is hub-scoped. No new server endpoints required.

---

## Eager Hub Key Loading

### At Login (iOS + Android)

After authenticating and receiving the hub list, load hub keys for all hubs before completing the login flow:

**iOS** — in `AppState` post-login, after `switchHub()` from spec 1 has been replaced with eager loading:

```swift
func loadAllHubKeys(hubs: [Hub]) async throws {
    try await withThrowingTaskGroup(of: Void.self) { group in
        for hub in hubs {
            group.addTask {
                let envelope = try await self.apiService.getHubKey(hub.id)
                try self.cryptoService.loadHubKey(hubId: hub.id, envelope: envelope)
            }
        }
        try await group.waitForAll()
    }
}
```

Keys are fetched in parallel. Any individual failure is surfaced (the user may have been removed from a hub between session starts) — log and skip rather than failing the entire login.

**Android** — in `HubRepository.loadInitialHub()`, extended to load all hub keys:

```kotlin
suspend fun loadAllHubKeys(hubs: List<Hub>) {
    hubs.map { hub ->
        async {
            runCatching {
                val envelope = apiService.getHubKey(hub.id)
                cryptoService.loadHubKey(hub.id, envelope)
            }.onFailure { e ->
                Log.w("HubRepository", "Failed to load key for hub ${hub.id}: ${e.message}")
            }
        }
    }.awaitAll()
}
```

### Consequence for Spec 1 `switchHub()`

`switchHub()` from spec 1 no longer needs to fetch the hub key — it is already cached. It only updates `activeHubId`. The key-fetch-before-commit safety (abort switch on key failure) from spec 1 is no longer needed since keys are pre-loaded; remove that complexity from the switch path.

### Hub Membership Changes

When the relay emits a `hubMemberAdded` or `hubMemberRemoved` event for the current user:
- **Added**: fetch and cache the new hub's key immediately
- **Removed**: evict the departed hub's key from the cache and unregister its Linphone SIP account

### Cache Eviction

Hub key cache cleared on lock and logout, as defined in spec 1.

---

## Multi-Hub Relay Event Routing

### Hub Attribution

Change `WebSocketService` on both platforms to emit `(hubId: String, event: HubEvent)` tuples rather than bare `HubEvent` values. Attribution is determined by decryption:

**iOS:**

```swift
func decryptEvent(_ encryptedContent: String) -> (hubId: String, event: HubEvent)? {
    for (hubId, key) in cryptoService.allHubKeys() {
        if let plaintext = try? cryptoService.decrypt(encryptedContent, using: key),
           let event = try? JSONDecoder().decode(HubEvent.self, from: plaintext) {
            return (hubId, event)
        }
    }
    return nil  // Event not for this user's hubs — ignore
}
```

**Android:**

```kotlin
fun decryptEvent(encryptedContent: String): Pair<String, HubEvent>? {
    for ((hubId, key) in cryptoService.allHubKeys()) {
        val plaintext = runCatching {
            cryptoService.decrypt(encryptedContent, key)
        }.getOrNull() ?: continue
        val event = runCatching {
            json.decodeFromString<HubEvent>(plaintext)
        }.getOrNull() ?: continue
        return hubId to event
    }
    return null
}
```

Events that fail all hub key decryptions are silently ignored — they belong to other hubs or are unrelated relay traffic (consistent with the server-blind security model).

### Event Consumers

All relay event consumers are updated to receive `(hubId, event)` pairs. Consumers that are hub-scoped (e.g. dashboard for active hub) filter by `hubId == activeHubId`. Consumers that are hub-agnostic (e.g. the background call handler, activity indicators) process events from all hubs.

---

## Push Notification Routing

When a push notification arrives with `hubId`:

**On tap (iOS `didReceiveResponse` / Android notification intent):**
1. Read `hubId` from payload
2. Call `hubContext.setActiveHub(hubId)` / `activeHubState.setActiveHub(hubId)` — switches UI to the notification's hub
3. Navigate to the relevant screen (`/calls`, `/conversations`, etc.)

The user lands directly in the correct hub view without manual switching.

**VoIP push (incoming call):**
- Linphone's native push handler fires before the app is in the foreground
- `hubId` is stored alongside `callId` in the native call context
- When the user accepts the call (via CallKit/ConnectionService), `activeHubId` switches to the call's hub
- The in-call screen loads with the correct hub context

---

## Per-Hub Activity Indicators

The hub list screen shows live per-hub status badges driven by relay events:

```swift
// iOS — HubActivityState per hub
struct HubActivityState {
    var isOnShift: Bool = false
    var activeCallCount: Int = 0
    var unreadMessageCount: Int = 0
    var unreadConversationCount: Int = 0
}
```

```kotlin
// Android
data class HubActivityState(
    val isOnShift: Boolean = false,
    val activeCallCount: Int = 0,
    val unreadMessageCount: Int = 0,
    val unreadConversationCount: Int = 0,
)
```

`HubListViewModel` / the equivalent iOS ViewModel maintains a `[hubId: HubActivityState]` map, updated by the relay event stream. Events: `callRing` increments `activeCallCount`, `callAnswered`/`callEnded` decrements, `messageNew` increments `unreadMessageCount`, shift events update `isOnShift`.

---

## Linphone Native Integration

### Why the Epic 91 Design Is Superseded

Epic 91 designed a React Native Turbo Native Module (`llamenos-sip`). The Llamenos mobile apps are native SwiftUI (iOS) and Kotlin/Compose (Android) — not React Native. No Turbo Module, no `NativeModules`, no `useVoip()` hook. The Linphone SDK design (provider-agnostic SIP, SRTP, CallKit, ConnectionService, multi-account) is correct and carried forward. Only the integration layer changes.

### iOS — `LinphoneService.swift`

A `@Observable` singleton owning the Linphone `Core`, integrated via `linphone-sdk-swift` (SPM package or CocoaPods). Injected into the SwiftUI environment alongside `HubContext`.

**Initialization (once at app start):**

```swift
@Observable
final class LinphoneService {
    private var core: Core?

    func initialize() throws {
        let core = try Factory.Instance.createCore(
            configPath: nil, factoryConfigPath: nil, systemContext: nil
        )
        core.callkitEnabled = true          // Linphone handles CallKit internally
        core.mediaEncryption = .SRTP
        core.mediaEncryptionMandatory = true
        // Prefer Opus codec
        core.audioPayloadTypes.forEach { $0.enable = ($0.mimeType == "opus" || $0.mimeType == "PCMU") }
        try core.start()
        self.core = core
    }
}
```

Linphone's internal `PKPushRegistry` delegate handles VoIP PushKit. No separate PushKit setup needed in the app — Linphone registers when `core.start()` is called.

**SIP registration per hub on shift:**

```swift
func registerHubAccount(hubId: String, sipParams: SipTokenResponse) throws {
    guard let core else { throw LinphoneError.notInitialized }
    let params = try core.createAccountParams()
    // identity, server address, credentials from sipParams
    // push notification config — APNs VoIP token from Linphone's PKPushRegistry
    let account = try core.createAccount(params: params)
    account.params?.pushNotificationAllowed = true
    try core.addAccount(account: account)
    hubAccounts[hubId] = account
}

func unregisterHubAccount(hubId: String) {
    guard let account = hubAccounts.removeValue(forKey: hubId) else { return }
    core?.removeAccount(account: account)
}
```

**Shift state integration:** `ShiftViewModel` calls `linphoneService.registerHubAccount()` when a shift starts and `unregisterHubAccount()` when it ends. Linphone maintains persistent SIP registration (keep-alive) for all active shift accounts.

**CallKit:** Handled entirely by Linphone SDK internally (`core.callkitEnabled = true`). Incoming SIP INVITEs trigger `CXProvider.reportNewIncomingCall()` automatically. The app receives call state changes via `CoreDelegate` callbacks.

**Call answer → hub switch:**

```swift
// CoreDelegate callback
func onCallStateChanged(core: Core, call: Call, state: Call.State, message: String) {
    if state == .IncomingReceived {
        // Extract hubId from call's custom headers or push payload context
        if let hubId = call.remoteParams?.customHeader(name: "X-Hub-Id") {
            hubContext.setActiveHub(hubId)
        }
    }
}
```

### Android — `LinphoneService.kt`

A Hilt `@Singleton` service wrapping `org.linphone:linphone-sdk-android` via Gradle dependency.

```kotlin
@Singleton
class LinphoneService @Inject constructor(
    @ApplicationContext private val context: Context,
    private val activeHubState: ActiveHubState,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private var core: Core? = null
    private val hubAccounts = mutableMapOf<String, Account>()

    fun initialize() {
        val factory = Factory.instance()
        val core = factory.createCore(null, null, context)
        core.isCallkitIntegrationEnabled = true  // ConnectionService
        core.mediaEncryption = MediaEncryption.SRTP
        core.isMediaEncryptionMandatory = true
        core.audioPayloadTypes.forEach { it.enable(it.mimeType == "opus" || it.mimeType == "PCMU") }
        core.start()
        this.core = core
        setupCoreListener()
    }

    fun registerHubAccount(hubId: String, sipParams: SipTokenResponse) {
        val core = this.core ?: return
        val params = core.createAccountParams()
        // identity, server, credentials, FCM push token from sipParams
        val account = core.createAccount(params)
        core.addAccount(account)
        hubAccounts[hubId] = account
    }

    fun unregisterHubAccount(hubId: String) {
        val account = hubAccounts.remove(hubId) ?: return
        core?.removeAccount(account)
    }

    private fun setupCoreListener() {
        core?.addListener(object : CoreListenerStub() {
            override fun onCallStateChanged(
                core: Core, call: Call, state: Call.State, message: String
            ) {
                if (state == Call.State.IncomingReceived) {
                    val hubId = call.remoteParams?.getCustomHeader("X-Hub-Id")
                    if (hubId != null) {
                        scope.launch { activeHubState.setActiveHub(hubId) }
                    }
                }
            }
        })
    }
}
```

**ConnectionService:** Handled internally by Linphone when `core.isCallkitIntegrationEnabled = true`. Incoming calls show as a full-screen foreground notification on the lock screen via Android's native telecom stack.

**FCM VoIP push:** Linphone's FCM integration handles high-priority data messages from the server's `voip-push.ts`. The `hubId` in the FCM payload is available in the `LinphoneService` push handler to pre-switch the hub before the call UI appears.

### Provider SIP Config Mapping

`GET /hubs/{hubId}/telephony/sip-token` returns provider-specific SIP params. The mobile client maps these to Linphone account configuration:

| Provider | domain | transport | auth | encryption |
|---|---|---|---|---|
| Twilio | `{account}.pstn.twilio.com` | tls | SIP digest | SRTP |
| SignalWire | `{space}.signalwire.com` | tls | SIP digest | SRTP |
| Plivo | `phone.plivo.com` | tls | SIP endpoint creds | SRTP |
| Asterisk | `{host}` | tls/wss | PJSIP creds | ZRTP |
| Vonage | via Asterisk gateway | tls | Asterisk creds | ZRTP |

### Linphone SDK Dependencies

**iOS:** `linphone-sdk-swift` via CocoaPods (`pod 'linphone-sdk'`) or direct XCFramework. Add to `apps/ios/` Podfile or `project.yml`. Requires physical device for CallKit testing (simulator does not support CallKit).

**Android:** `implementation 'org.linphone:linphone-sdk-android:5.x.x'` in `apps/android/app/build.gradle`. Maven repository: `maven { url "https://linphone.org/maven_repository/" }`.

**AGPLv3 license:** Linphone SDK is AGPLv3. Llamenos is AGPLv3-compatible. Source for the native integration must remain available — it lives in this repo.

### Required Permissions

**iOS** (`apps/ios/project.yml` / `Info.plist`):
- `NSMicrophoneUsageDescription` — answering crisis calls
- `UIBackgroundModes`: `voip`, `audio`
- PushKit entitlement (`aps-environment` for VoIP)

**Android** (`apps/android/app/src/main/AndroidManifest.xml` — several already present):
- `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`
- `BLUETOOTH`, `BLUETOOTH_CONNECT`
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_PHONE_CALL` (already declared)
- `USE_FULL_SCREEN_INTENT`, `MANAGE_OWN_CALLS`

---

## Security Notes

- SIP credentials are hub-specific, fetched fresh via `GET /hubs/{hubId}/telephony/sip-token`, never persisted to disk
- VoIP push payloads carry only `callId`, `caller` (obfuscated), and `hubId` — no PII in the push payload
- Media encryption: SRTP mandatory for all providers, ZRTP where supported (Asterisk, direct SIP)
- Linphone's native push handlers run before JS context — Llamenos has no JS context, but the equivalent applies: Linphone handles PushKit/FCM before the SwiftUI/Compose layer, which is required by Apple's iOS 13+ VoIP push mandate

---

## Implementation Order

1. **Backend: add `hubId` to push payloads** — small, unblocks everything else
2. **Eager hub key loading** — prerequisite for relay event routing
3. **Hub-attributed relay events** — `(hubId, event)` tuples, update all consumers
4. **Per-hub activity indicators** — depends on attributed events
5. **Push notification routing** — depends on `hubId` in payload (step 1)
6. **Linphone SDK integration** — iOS then Android; largest piece, independent of steps 1-5 except VoIP push routing

---

## Success Criteria

- Hub keys for all user's hubs are loaded at login; relay events from any hub are decrypted correctly
- `WakePayload.hubId` and `FullPushPayload.hubId` populated on all push dispatch paths; codegen updated
- Tapping a push notification for Hub B while Hub A is active switches the UI to Hub B and navigates to the correct screen
- Per-hub activity badges (on shift, active call, unread count) update live from relay events for all hubs, not just the active hub
- iOS: Linphone `Core` initializes with SRTP + Opus; SIP REGISTER succeeds for each hub the user is on shift in; incoming call appears on lock screen via CallKit; accepting the call switches `activeHubId` to the call's hub
- Android: same via `LinphoneService.kt` and ConnectionService; FCM high-priority data message wakes app from background
- Shift start → SIP account registered for that hub's provider; shift end → account unregistered
- VoIP push arrives with `hubId`; accepting call switches active hub
- No regressions for single-hub users
- Hub key cache cleared on lock and logout (same as spec 1)
- `clearHubKeys()` verified by unit test: after `lock()`, `cryptoService.hubKeyCount == 0`
