# Mobile Multi-Hub — UI Switching + Background Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real hub switching on iOS and Android (both UI context and background services) so multi-hub users can browse any hub and receive calls/notifications/relay events from all hubs simultaneously.

**Architecture:** HubContext (@Observable iOS singleton) and ActiveHubState (Hilt @Singleton Android StateFlow) provide hub context without circular dependencies. The hp() path helper in APIService prefixes hub-scoped API paths. All hub keys loaded eagerly at login; relay events decrypted with all cached keys to attribute hub; Linphone SDK provides native SIP calling with one account per hub-on-shift.

**Tech Stack:** iOS SwiftUI @Observable, Swift, linphone-sdk-swift (CocoaPods or XCFramework), Bun/Hono backend; Android Kotlin/Compose, Hilt DI, Kotlin Coroutines/StateFlow/DataStore, linphone-sdk-android (Gradle)

---

## File Map

**New files:**
- `apps/ios/Sources/Services/HubContext.swift` — @Observable active hub state, UserDefaults persistence
- `apps/ios/Sources/Services/LinphoneService.swift` — Linphone Core wrapper, SIP accounts per hub
- `apps/android/app/src/main/java/org/llamenos/hotline/hub/ActiveHubState.kt` — StateFlow-backed hub ID, DataStore persistence
- `apps/android/app/src/main/java/org/llamenos/hotline/hub/HubRepository.kt` — switchHub(), loadAllHubKeys()
- `apps/android/app/src/main/java/org/llamenos/hotline/di/CoroutineScopeModule.kt` — @ApplicationScope CoroutineScope Hilt module
- `apps/android/app/src/main/java/org/llamenos/hotline/LlamenosApplication.kt` — @HiltAndroidApp, calls linphoneService.initialize()
- `apps/android/app/src/main/java/org/llamenos/hotline/telephony/LinphoneService.kt` — Linphone Core wrapper

**Modified files:**
- `apps/worker/types/infra.ts` — add hubId to WakePayload/FullPushPayload
- `apps/worker/lib/push-dispatch.ts` — populate hubId in all sendToVolunteer/sendToAllOnShift call sites
- `apps/worker/lib/voip-push.ts` — populate hubId in VoIP APNs/FCM payloads
- `apps/ios/Sources/App/LlamenosApp.swift` — create HubContext @State, inject into environment, pass to AppState
- `apps/ios/Sources/App/AppState.swift` — add loadAllHubKeys(), wire HubContext into init
- `apps/ios/Sources/Services/APIService.swift` — add hp(), wrap all hub-scoped paths, remove slug-based hub tracking
- `apps/ios/Sources/Services/CryptoService.swift` — add clearHubKeys(), allHubKeys(), loadHubKey(hubId:envelope:)
- `apps/ios/Sources/Services/WebSocketService.swift` — emit AttributedHubEvent instead of HubEventType stream
- `apps/ios/Sources/ViewModels/HubManagementViewModel.swift` — real switchHub() with key fetch, isActive() UUID comparison
- `apps/ios/Sources/Views/Settings/HubManagementView.swift` — wire switchHub to ViewModel
- `apps/ios/project.yml` — Linphone SDK XCFramework dependency, Info.plist NSMicrophoneUsageDescription, UIBackgroundModes voip+audio
- Hub-scoped iOS Views — `.task(id: hubContext.activeHubId)` reload pattern
- `apps/android/app/src/main/java/org/llamenos/hotline/api/ApiService.kt` — add hp(), wrap hub-scoped paths
- `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt` — emit AttributedHubEvent
- `apps/android/app/src/main/java/org/llamenos/hotline/crypto/CryptoService.kt` — add clearHubKeys(), allHubKeys(), loadHubKey()
- `apps/android/app/src/main/java/org/llamenos/hotline/ui/hubs/HubManagementViewModel.kt` — real switchHub(), StateFlow activeHubId
- `apps/android/app/src/main/java/org/llamenos/hotline/service/PushService.kt` — read hubId from payload, route to hub
- `apps/android/app/src/main/AndroidManifest.xml` — LlamenosApplication, ConnectionService, permissions
- `apps/android/app/build.gradle.kts` — Linphone Maven repo + dependency

---

## Phase 1: Backend (unblocks clients)

### Task 1 — Add hubId to WakePayload/FullPushPayload + populate at all dispatch call sites

**Files:** `apps/worker/types/infra.ts`, `apps/worker/lib/push-dispatch.ts`, `apps/worker/lib/voip-push.ts`

No unit test needed — verified by `bun run typecheck`. The type change is additive and immediately breaks any dispatch site that does not pass `hubId`, ensuring exhaustive coverage at compile time.

**Implementation:**

In `apps/worker/types/infra.ts`, update the two interfaces:

```typescript
/** Wake-tier payload — decryptable without PIN (minimal metadata) */
export interface WakePayload {
  hubId: string          // identifies which hub this push belongs to
  type: PushNotificationType
  conversationId?: string
  channelType?: string
  callId?: string
  shiftId?: string
  startsAt?: string
}

/** Full-tier payload — decryptable only with volunteer's nsec */
export interface FullPushPayload extends WakePayload {
  senderLast4?: string
  previewText?: string
  duration?: number
  callerLast4?: string
  shiftName?: string
  role?: string
}
```

In `apps/worker/lib/push-dispatch.ts`, update `PushDispatcher` interface signatures to accept `hubId` (or pass it through the payload, which already carries it after the type change). All call sites in route handlers already operate within a hub context and have a `hubId` from the route param — add it to every `WakePayload` and `FullPushPayload` literal constructed before calling `sendToVolunteer` or `sendToAllOnShift`.

Search for all construction sites:

```bash
grep -rn "type: 'message'\|type: 'voicemail'\|type: 'shift_reminder'\|type: 'assignment'" apps/worker/
```

Each site adds `hubId` from the enclosing hub context (route param or service method param). Example pattern:

```typescript
// Before
const wake: WakePayload = { type: 'message', conversationId }
// After
const wake: WakePayload = { hubId, type: 'message', conversationId }
```

In `apps/worker/lib/voip-push.ts`, update `dispatchVoipPushFromService` to accept `hubId: string` and include it in both APNs and FCM payloads:

```typescript
export async function dispatchVoipPushFromService(
  volunteerPubkeys: string[],
  callId: string,
  callerDisplay: string,
  hubId: string,          // NEW
  env: Env,
  identityService: IdentityService,
): Promise<void>
```

APNs payload update (inside `sendApnsVoipPush`, add parameter `hubId: string`):

```typescript
data: {
  'call-id': callId,
  'caller': callerDisplay,
  'hub-id': hubId,       // NEW
  'type': 'incoming_call',
},
```

FCM payload update (inside `sendFcmVoipPush`, add parameter `hubId: string`):

```typescript
data: {
  type: 'incoming_call',
  'call-id': callId,
  caller: callerDisplay,
  'hub-id': hubId,       // NEW
},
```

All call sites of `dispatchVoipPushFromService` (in telephony route handlers) already have a `hubId` from the route — pass it through.

**Verify:**

```bash
bun run typecheck
```

Expected: 0 errors.

**Commit:**

```bash
git add apps/worker/types/infra.ts apps/worker/lib/push-dispatch.ts apps/worker/lib/voip-push.ts
git commit -m "feat(worker): add hubId to WakePayload, FullPushPayload, and VoIP push payloads"
```

---

## Phase 2: iOS Spec 1 — Hub Context + API Layer

### Task 2 — Create HubContext.swift with unit tests

**Files:** `apps/ios/Sources/Services/HubContext.swift`, `apps/ios/Tests/HubContextTests.swift`

**Write the failing test first:**

```swift
// apps/ios/Tests/HubContextTests.swift
import Testing
@testable import Llamenos

@MainActor
struct HubContextTests {

    @Test func initialActiveHubIdIsNilWhenNothingPersisted() {
        UserDefaults.standard.removeObject(forKey: "activeHubId")
        let ctx = HubContext()
        #expect(ctx.activeHubId == nil)
    }

    @Test func initialActiveHubIdRestoresFromUserDefaults() {
        UserDefaults.standard.set("hub-abc-123", forKey: "activeHubId")
        let ctx = HubContext()
        #expect(ctx.activeHubId == "hub-abc-123")
        UserDefaults.standard.removeObject(forKey: "activeHubId")
    }

    @Test func setActiveHubUpdatesPropertyAndPersists() {
        UserDefaults.standard.removeObject(forKey: "activeHubId")
        let ctx = HubContext()
        ctx.setActiveHub("hub-xyz-999")
        #expect(ctx.activeHubId == "hub-xyz-999")
        #expect(UserDefaults.standard.string(forKey: "activeHubId") == "hub-xyz-999")
        UserDefaults.standard.removeObject(forKey: "activeHubId")
    }

    @Test func clearActiveHubSetsNilAndRemovesFromUserDefaults() {
        UserDefaults.standard.set("hub-abc-123", forKey: "activeHubId")
        let ctx = HubContext()
        ctx.clearActiveHub()
        #expect(ctx.activeHubId == nil)
        #expect(UserDefaults.standard.string(forKey: "activeHubId") == nil)
    }
}
```

**Run (red):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/HubContextTests 2>&1 | tail -20'
```

Expected: compile error — `HubContext` does not exist.

**Implementation — `apps/ios/Sources/Services/HubContext.swift`:**

```swift
import Foundation

// MARK: - HubContext

/// Lightweight observable container for the currently active hub ID.
///
/// Created once in LlamenosApp as @State and passed into AppState.init() and
/// APIService.init() via constructor injection. Views receive it via
/// @Environment(HubContext.self). No circular dependency — HubContext depends on nothing.
///
/// Persistence: UserDefaults key "activeHubId" (UUID string). Migrates from legacy
/// "activeHubSlug" key on first read if present.
@Observable
final class HubContext {

    // MARK: - State

    /// The UUID of the currently active hub. nil before first hub is selected.
    private(set) var activeHubId: String?

    // MARK: - Init

    init() {
        // Migrate from legacy slug-based storage if present and no UUID stored yet
        if let legacySlug = UserDefaults.standard.string(forKey: "activeHubSlug"),
           UserDefaults.standard.string(forKey: "activeHubId") == nil {
            // Can't migrate slug→UUID without an API call; clear legacy key and start fresh
            UserDefaults.standard.removeObject(forKey: "activeHubSlug")
        }
        self.activeHubId = UserDefaults.standard.string(forKey: "activeHubId")
    }

    // MARK: - Mutations

    /// Set the active hub and persist to UserDefaults.
    func setActiveHub(_ hubId: String) {
        activeHubId = hubId
        UserDefaults.standard.set(hubId, forKey: "activeHubId")
    }

    /// Clear the active hub (used on logout).
    func clearActiveHub() {
        activeHubId = nil
        UserDefaults.standard.removeObject(forKey: "activeHubId")
    }
}
```

**Run (green):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/HubContextTests 2>&1 | tail -20'
```

Expected: `Test Suite 'HubContextTests' passed. 4 test(s) passed.`

**Commit:**

```bash
git add apps/ios/Sources/Services/HubContext.swift apps/ios/Tests/HubContextTests.swift
git commit -m "feat(ios): add HubContext observable with UserDefaults persistence and unit tests"
```

---

### Task 3 — Wire HubContext into LlamenosApp + AppState + APIService

**Files:** `apps/ios/Sources/App/LlamenosApp.swift`, `apps/ios/Sources/App/AppState.swift`, `apps/ios/Sources/Services/APIService.swift`

No unit test — wiring task. Verified by typecheck.

**`AppState.swift` changes:**

Add `hubContext` parameter to `init()`:

```swift
// Add stored property after existing service declarations
let hubContext: HubContext

// Update init signature
init(hubContext: HubContext) {
    let crypto = CryptoService()
    let keychain = KeychainService()
    let api = APIService(cryptoService: crypto, hubContext: hubContext)
    // ... rest unchanged ...
    self.hubContext = hubContext
    // ... rest of init unchanged ...
}
```

Add `loadAllHubKeys(hubs:)` method (full implementation in Task 13 — stub here):

```swift
/// Load hub keys for all hubs in parallel. Called after login.
/// Full implementation in Task 13 (background services phase).
func loadAllHubKeys(hubs: [Hub]) async {
    await withTaskGroup(of: Void.self) { group in
        for hub in hubs {
            group.addTask { [weak self] in
                guard let self else { return }
                do {
                    let envelope = try await apiService.getHubKey(hub.id)
                    try cryptoService.loadHubKey(hubId: hub.id, envelope: envelope)
                } catch {
                    print("[HubKeys] Warning: failed to load hub key for \(hub.id): \(error)")
                }
            }
        }
    }
}

/// Clear hub key cache. Called on lock and logout.
func clearHubKeys() {
    cryptoService.clearHubKeys()
    hubContext.clearActiveHub()
}
```

Update `lockApp()` and `logout()` to call `clearHubKeys()`.

**`APIService.swift` changes** — add `hubContext` property and `hp()`:

```swift
// In APIService class body, after existing properties:
private let hubContext: HubContext

// Update init:
init(cryptoService: CryptoService, hubContext: HubContext) {
    self.cryptoService = cryptoService
    self.hubContext = hubContext
}

/// Returns path prefixed with /hubs/{activeHubId}. Falls back to bare path if no hub selected.
func hp(_ path: String) -> String {
    guard let hubId = hubContext.activeHubId else { return path }
    return "/hubs/\(hubId)\(path)"
}
```

**`LlamenosApp.swift` changes:**

```swift
// Replace:
@State private var appState = AppState()

// With:
@State private var hubContext = HubContext()
@State private var appState: AppState

// Add to init():
init() {
    // Font setup unchanged ...
    let ctx = HubContext()
    _hubContext = State(initialValue: ctx)
    _appState = State(initialValue: AppState(hubContext: ctx))
}

// Add hubContext to environment injection:
ContentView()
    .environment(appState)
    .environment(router)
    .environment(hubContext)   // NEW
```

**Verify:**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

Expected: `BUILD SUCCEEDED`

**Commit:**

```bash
git add apps/ios/Sources/App/LlamenosApp.swift apps/ios/Sources/App/AppState.swift apps/ios/Sources/Services/APIService.swift
git commit -m "feat(ios): wire HubContext into LlamenosApp, AppState, and APIService constructor chain"
```

---

### Task 4 — Add hp() to APIService + audit/wrap all hub-scoped paths

**Files:** `apps/ios/Sources/Services/APIService.swift`

No unit test — path correctness verified by typecheck and E2E. The change is mechanical: find all `request(method:path:)` calls where path is a hub-scoped route and wrap with `hp()`.

**Hub-scoped paths that must use `hp()`** (from spec): `/settings`, `/settings/cms/*`, `/users`, `/roles`, `/shifts`, `/calls`, `/notes`, `/cases`, `/reports`, `/events`, `/contacts`, `/conversations`, `/bans`, `/blasts`, `/audit`, `/invites`

**Global paths that must NOT use `hp()`**: `/auth/*`, `/config`, `/hubs`, `/hubs/{id}`, `/hubs/{id}/key`, `/hubs/{id}/members`, `/system/*`

Search for all API method bodies in `APIService.swift` and replace bare hub-scoped paths:

```swift
// Example transformations:
// Before:
try await request(method: "GET", path: "/api/shifts")
// After:
try await request(method: "GET", path: hp("/api/shifts"))

// Before:
try await request(method: "GET", path: "/api/calls")
// After:
try await request(method: "GET", path: hp("/api/calls"))

// Unchanged (global):
try await request(method: "GET", path: "/api/hubs")
try await request(method: "GET", path: "/api/config")
try await request(method: "POST", path: "/api/auth/login")
```

Also add `getHubKey(hubId:)` method used by `switchHub()` and `loadAllHubKeys()`:

```swift
/// Fetch the ECIES-wrapped hub key envelope for the given hub.
/// Path is NOT wrapped with hp() — it uses the explicit hubId parameter.
func getHubKey(_ hubId: String) async throws -> KeyEnvelope {
    return try await request(
        method: "GET",
        path: "/api/hubs/\(hubId)/key"
    )
}
```

**Verify:**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

**Commit:**

```bash
git add apps/ios/Sources/Services/APIService.swift
git commit -m "feat(ios): add hp() path helper to APIService and audit all hub-scoped API paths"
```

---

### Task 5 — Update HubManagementViewModel.switchHub() + isActive() UUID fix + unit tests

**Files:** `apps/ios/Sources/ViewModels/HubManagementViewModel.swift`, `apps/ios/Tests/HubManagementViewModelTests.swift`

**Write the failing test first:**

```swift
// apps/ios/Tests/HubManagementViewModelTests.swift
import Testing
@testable import Llamenos

@MainActor
struct HubManagementViewModelTests {

    @Test func isActiveReturnsTrueForActiveHub() async throws {
        let ctx = HubContext()
        ctx.setActiveHub("hub-uuid-001")
        let vm = HubManagementViewModel(
            apiService: MockAPIService(),
            cryptoService: MockCryptoService(),
            hubContext: ctx
        )
        let hub = Hub(id: "hub-uuid-001", name: "Test Hub", slug: "test-hub")
        #expect(vm.isActive(hub) == true)
    }

    @Test func isActiveReturnsFalseForInactiveHub() {
        let ctx = HubContext()
        ctx.setActiveHub("hub-uuid-001")
        let vm = HubManagementViewModel(
            apiService: MockAPIService(),
            cryptoService: MockCryptoService(),
            hubContext: ctx
        )
        let hub = Hub(id: "hub-uuid-002", name: "Other Hub", slug: "other-hub")
        #expect(vm.isActive(hub) == false)
    }

    @Test func switchHubUpdatesHubContextOnSuccess() async throws {
        let ctx = HubContext()
        let mockAPI = MockAPIService()
        let mockCrypto = MockCryptoService()
        mockAPI.hubKeyResponse = KeyEnvelope(wrappedKey: "aabbcc", ephemeralPubkey: "ddeeff")

        let vm = HubManagementViewModel(
            apiService: mockAPI,
            cryptoService: mockCrypto,
            hubContext: ctx
        )
        let hub = Hub(id: "hub-uuid-002", name: "New Hub", slug: "new-hub")
        await vm.switchHub(to: hub)

        #expect(ctx.activeHubId == "hub-uuid-002")
        #expect(mockCrypto.loadedHubKeyId == "hub-uuid-002")
        #expect(vm.isSwitching == false)
        #expect(vm.error == nil)
    }

    @Test func switchHubDoesNotUpdateContextOnKeyFetchFailure() async throws {
        let ctx = HubContext()
        ctx.setActiveHub("hub-uuid-001")
        let mockAPI = MockAPIService()
        mockAPI.hubKeyError = APIError.requestFailed(statusCode: 403, body: "forbidden")

        let vm = HubManagementViewModel(
            apiService: mockAPI,
            cryptoService: MockCryptoService(),
            hubContext: ctx
        )
        let hub = Hub(id: "hub-uuid-002", name: "New Hub", slug: "new-hub")
        await vm.switchHub(to: hub)

        // activeHubId must NOT change on failure
        #expect(ctx.activeHubId == "hub-uuid-001")
        #expect(vm.isSwitching == false)
        #expect(vm.error != nil)
    }
}
```

Note: `MockAPIService` and `MockCryptoService` are test doubles that already exist or are added as part of test infrastructure. `MockAPIService` gets a `hubKeyResponse: KeyEnvelope?` and `hubKeyError: Error?` property; `getHubKey(_:)` throws if `hubKeyError` is set, otherwise returns `hubKeyResponse!`.

**Run (red):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/HubManagementViewModelTests 2>&1 | tail -20'
```

**Implementation — replace `HubManagementViewModel.swift` entirely:**

```swift
import Foundation
import UIKit

// MARK: - HubManagementViewModel

/// View model for hub listing, creation, and switching.
/// HubContext is injected — no stored activeHubSlug state.
@Observable
final class HubManagementViewModel {
    private let apiService: APIService
    private let cryptoService: CryptoService
    private let hubContext: HubContext

    // MARK: - State

    var hubs: [Hub] = []
    var isLoading: Bool = false
    var isSaving: Bool = false
    var isSwitching: Bool = false
    var error: Error?
    var errorMessage: String? { error?.localizedDescription }
    var successMessage: String?

    // MARK: - Init

    init(apiService: APIService, cryptoService: CryptoService, hubContext: HubContext) {
        self.apiService = apiService
        self.cryptoService = cryptoService
        self.hubContext = hubContext
    }

    // MARK: - Data Loading

    /// Fetch all hubs the user belongs to.
    func loadHubs() async {
        isLoading = true
        defer { isLoading = false }
        error = nil

        do {
            let response: HubsListResponse = try await apiService.request(
                method: "GET", path: "/api/hubs"
            )
            hubs = response.hubs

            // If no active hub is persisted, select the first one
            if hubContext.activeHubId == nil, let first = hubs.first {
                await switchHub(to: first)
            } else if let activeId = hubContext.activeHubId,
                      !hubs.contains(where: { $0.id == activeId }),
                      let first = hubs.first {
                // Persisted hub no longer in membership — fall back to first
                await switchHub(to: first)
            }
        } catch {
            self.error = error
        }
    }

    // MARK: - Hub Switching

    /// Switch to a different hub.
    ///
    /// Key fetch → unwrap → update hubContext. Aborts on any failure; hubContext unchanged.
    /// With eager key loading (Task 13), the key is usually already cached — the fetch
    /// is a fallback for cache-miss scenarios.
    func switchHub(to hub: Hub) async {
        guard hubContext.activeHubId != hub.id else { return }
        isSwitching = true
        error = nil
        defer { isSwitching = false }

        do {
            // Check if key already cached (after Task 7 / Task 13 — cache-miss fallback)
            if !cryptoService.hasHubKey(hubId: hub.id) {
                let envelope = try await apiService.getHubKey(hub.id)
                try cryptoService.loadHubKey(hubId: hub.id, envelope: envelope)
            }
            // Only update context after key is confirmed available
            hubContext.setActiveHub(hub.id)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            self.error = error
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    /// Check if a hub is the currently active one. Compares by UUID.
    func isActive(_ hub: Hub) -> Bool {
        hub.id == hubContext.activeHubId
    }

    // MARK: - Hub Creation

    /// Create a new hub.
    func createHub(name: String, slug: String?, description: String?, phoneNumber: String?) async -> Bool {
        isSaving = true
        defer { isSaving = false }
        error = nil

        let body = CreateHubRequest(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            slug: slug?.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description?.trimmingCharacters(in: .whitespacesAndNewlines),
            phoneNumber: phoneNumber?.trimmingCharacters(in: .whitespacesAndNewlines)
        )

        do {
            let response: AppHubResponse = try await apiService.request(
                method: "POST", path: "/api/hubs", body: body
            )
            hubs.append(response.hub)
            successMessage = NSLocalizedString("hubs_created_success", comment: "Hub created successfully")
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            return true
        } catch {
            self.error = error
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return false
        }
    }
}
```

**Run (green):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/HubManagementViewModelTests 2>&1 | tail -20'
```

**Commit:**

```bash
git add apps/ios/Sources/ViewModels/HubManagementViewModel.swift apps/ios/Tests/HubManagementViewModelTests.swift
git commit -m "feat(ios): real switchHub() in HubManagementViewModel — key fetch, UUID isActive(), abort on failure"
```

---

### Task 6 — Hub-scoped view reload via .task(id: hubContext.activeHubId)

**Files:** All hub-scoped view files that load data on appear (Dashboard, Notes, Cases, Reports, Calls, Conversations, Shifts, etc.)

No unit test — reload behavior is structural. Verified by typecheck.

The pattern is the same in every hub-scoped view. Each view:
1. Gets `@Environment(HubContext.self) private var hubContext`
2. Replaces `.task { await viewModel.load() }` with `.task(id: hubContext.activeHubId) { await viewModel.load() }`

SwiftUI cancels and restarts the task whenever `activeHubId` changes, triggering a fresh load. No NotificationCenter, no explicit observation — `@Observable` tracking handles it.

**Example transformation (apply to every hub-scoped view):**

```swift
// Before:
.task {
    await viewModel.loadNotes()
}

// After:
@Environment(HubContext.self) private var hubContext

// in body:
.task(id: hubContext.activeHubId) {
    await viewModel.loadNotes()
}
```

Views that need this change: `NotesView`, `CallHistoryView`, `CasesView`, `ReportsView`, `ConversationsView`, `ShiftsView`, `AuditLogView`, `BansView`, `UsersView`, `InvitesView`, `DashboardView` (and any other view that loads hub-scoped data).

**Verify:**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

**Commit:**

```bash
git add apps/ios/Sources/Views/
git commit -m "feat(ios): hub-scoped views reload on hub switch via .task(id: hubContext.activeHubId)"
```

---

### Task 7 — CryptoService: hub key cache methods + unit tests

**Files:** `apps/ios/Sources/Services/CryptoService.swift`, `apps/ios/Tests/CryptoServiceHubKeyTests.swift`

**Write the failing test first:**

```swift
// apps/ios/Tests/CryptoServiceHubKeyTests.swift
import Testing
@testable import Llamenos

struct CryptoServiceHubKeyTests {

    @Test func loadHubKeyStoresKeyInCache() throws {
        let crypto = CryptoService()
        let envelope = KeyEnvelope(wrappedKey: "aabb", ephemeralPubkey: "ccdd")
        // loadHubKey with a real FFI call would need a proper envelope;
        // test the storage/retrieval layer using mock bypass
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "deadbeef00112233")
        #expect(crypto.hasHubKey(hubId: "hub-001") == true)
        #expect(crypto.allHubKeys()["hub-001"] == "deadbeef00112233")
    }

    @Test func clearHubKeysEvictsAllKeys() throws {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        crypto.storeHubKeyForTesting(hubId: "hub-002", keyHex: "ddeeff")
        crypto.clearHubKeys()
        #expect(crypto.hubKeyCount == 0)
        #expect(crypto.allHubKeys().isEmpty == true)
    }

    @Test func hubKeyCountReflectsCurrentCacheSize() {
        let crypto = CryptoService()
        #expect(crypto.hubKeyCount == 0)
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        #expect(crypto.hubKeyCount == 1)
        crypto.storeHubKeyForTesting(hubId: "hub-002", keyHex: "ddeeff")
        #expect(crypto.hubKeyCount == 2)
    }

    @Test func lockClearsHubKeyCache() {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        crypto.lock()
        #expect(crypto.hubKeyCount == 0)
    }
}
```

**Implementation — add to `CryptoService.swift`:**

```swift
// MARK: - Hub Key Cache

/// In-memory hub key cache. Keys are 32-byte symmetric keys (hex). Never written to disk.
/// Access is serialized via hubKeyLock.
private var hubKeyCache: [String: String] = [:]  // hubId → keyHex
private let hubKeyLock = NSLock()

/// Total number of hub keys currently cached.
var hubKeyCount: Int {
    hubKeyLock.lock()
    defer { hubKeyLock.unlock() }
    return hubKeyCache.count
}

/// Returns true if a key for the given hub is cached.
func hasHubKey(hubId: String) -> Bool {
    hubKeyLock.lock()
    defer { hubKeyLock.unlock() }
    return hubKeyCache[hubId] != nil
}

/// Returns a copy of the hub key cache for relay event decryption.
func allHubKeys() -> [String: String] {
    hubKeyLock.lock()
    defer { hubKeyLock.unlock() }
    return hubKeyCache
}

/// Unwrap a hub key envelope and store in cache.
///
/// The envelope is ECIES-wrapped with the user's nsec. Unwrapping requires
/// the nsec to be loaded (app unlocked). The unwrapped key is stored in memory only.
func loadHubKey(hubId: String, envelope: KeyEnvelope) throws {
    guard let nsecHex else { throw CryptoServiceError.noKeyLoaded }
    // Delegate to FFI: ECIES unwrap → raw 32-byte key hex
    let keyHex = try ffiDecryptHubKeyEnvelope(
        wrappedKey: envelope.wrappedKey,
        ephemeralPubkey: envelope.ephemeralPubkey,
        secretKeyHex: nsecHex
    )
    hubKeyLock.lock()
    hubKeyCache[hubId] = keyHex
    hubKeyLock.unlock()
}

/// Evict all hub keys from the cache.
/// Must be called on lock and logout.
func clearHubKeys() {
    hubKeyLock.lock()
    hubKeyCache.removeAll()
    hubKeyLock.unlock()
}

#if DEBUG
/// Bypass FFI for unit tests — directly store a key hex value.
func storeHubKeyForTesting(hubId: String, keyHex: String) {
    hubKeyLock.lock()
    hubKeyCache[hubId] = keyHex
    hubKeyLock.unlock()
}
#endif
```

Add a private FFI wrapper (add to the file-scope `private func` block at top of file):

```swift
private func ffiDecryptHubKeyEnvelope(wrappedKey: String, ephemeralPubkey: String, secretKeyHex: String) throws -> String {
    // The hub key is an ECIES-wrapped 32-byte symmetric key.
    // Reuse the existing decryptNote FFI which performs the same ECIES unwrap operation
    // on a KeyEnvelope. The raw unwrapped key hex is returned.
    let envelope = KeyEnvelope(wrappedKey: wrappedKey, ephemeralPubkey: ephemeralPubkey)
    return try decryptHubKey(envelope: envelope, secretKeyHex: secretKeyHex)
}
```

Note: `decryptHubKey` is a UniFFI-generated function in the LlamenosCore FFI that unwraps an ECIES hub key envelope and returns the raw key hex. If this function does not yet exist in the FFI, add it to `packages/crypto/src/lib.rs` and rebuild the XCFramework before this task. The function signature:

```rust
// packages/crypto/src/lib.rs
pub fn decrypt_hub_key(envelope: KeyEnvelope, secret_key_hex: String) -> Result<String, CryptoError> {
    // ECIES unwrap: recover symmetric key from ECIES envelope
    ecies_unwrap_key(&envelope.wrapped_key, &envelope.ephemeral_pubkey, &secret_key_hex)
}
```

Update `lock()` method in `CryptoService.swift` to call `clearHubKeys()`:

```swift
func lock() {
    nsecHex = nil
    nsecBech32 = nil
    clearHubKeys()   // NEW — clear hub key cache on lock
}
```

**Run (green):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/CryptoServiceHubKeyTests 2>&1 | tail -20'
```

**Commit:**

```bash
git add apps/ios/Sources/Services/CryptoService.swift apps/ios/Tests/CryptoServiceHubKeyTests.swift
git commit -m "feat(ios): add hub key cache to CryptoService — clearHubKeys/allHubKeys/loadHubKey + lock eviction"
```

---

## Phase 3: Android Spec 1 — Hub Context + API Layer

### Task 8 — Create ActiveHubState.kt + CoroutineScopeModule.kt with unit tests

**Files:**
- `apps/android/app/src/main/java/org/llamenos/hotline/hub/ActiveHubState.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/di/CoroutineScopeModule.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/di/ApplicationScope.kt`
- `apps/android/app/src/test/java/org/llamenos/hotline/hub/ActiveHubStateTest.kt`

**Write the failing test first:**

```kotlin
// apps/android/app/src/test/java/org/llamenos/hotline/hub/ActiveHubStateTest.kt
package org.llamenos.hotline.hub

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import app.cash.turbine.test
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class ActiveHubStateTest {

    @get:Rule val tmpFolder = TemporaryFolder()

    private val testDispatcher = UnconfinedTestDispatcher()
    private val testScope = TestScope(testDispatcher)
    private lateinit var dataStore: DataStore<Preferences>
    private lateinit var state: ActiveHubState

    @Before
    fun setUp() {
        dataStore = PreferenceDataStoreFactory.create(
            scope = testScope,
            produceFile = { tmpFolder.newFile("test_prefs.preferences_pb") }
        )
        state = ActiveHubState(dataStore, testScope)
    }

    @Test
    fun `activeHubId is null initially`() = runTest(testDispatcher) {
        state.activeHubId.test {
            assertNull(awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `setActiveHub persists and emits new value`() = runTest(testDispatcher) {
        state.setActiveHub("hub-uuid-001")
        state.activeHubId.test {
            assertEquals("hub-uuid-001", awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `setActiveHub twice emits latest value`() = runTest(testDispatcher) {
        state.setActiveHub("hub-uuid-001")
        state.setActiveHub("hub-uuid-002")
        state.activeHubId.test {
            assertEquals("hub-uuid-002", awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `clearActiveHub sets value back to null`() = runTest(testDispatcher) {
        state.setActiveHub("hub-uuid-001")
        state.clearActiveHub()
        state.activeHubId.test {
            assertNull(awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }
}
```

**Run (red):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.hub.ActiveHubStateTest" 2>&1 | tail -20
```

**Implementation:**

`apps/android/app/src/main/java/org/llamenos/hotline/di/ApplicationScope.kt`:

```kotlin
package org.llamenos.hotline.di

import javax.inject.Qualifier

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApplicationScope
```

`apps/android/app/src/main/java/org/llamenos/hotline/di/CoroutineScopeModule.kt`:

```kotlin
package org.llamenos.hotline.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object CoroutineScopeModule {

    @ApplicationScope
    @Provides
    @Singleton
    fun provideApplicationScope(): CoroutineScope =
        CoroutineScope(SupervisorJob() + Dispatchers.Default)
}
```

`apps/android/app/src/main/java/org/llamenos/hotline/hub/ActiveHubState.kt`:

```kotlin
package org.llamenos.hotline.hub

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.llamenos.hotline.di.ApplicationScope
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for the currently active hub ID.
 *
 * Both ApiService and HubRepository inject this to break the circular dependency
 * that would arise if either owned the other. Neither owns this class.
 *
 * Persists to DataStore (Proto DataStore Preferences). StateFlow backed by
 * DataStore ensures all collectors receive the latest value immediately on collect.
 */
@Singleton
class ActiveHubState @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val ACTIVE_HUB_KEY = stringPreferencesKey("activeHubId")

    val activeHubId: StateFlow<String?> = dataStore.data
        .map { prefs -> prefs[ACTIVE_HUB_KEY] }
        .stateIn(scope, SharingStarted.Eagerly, null)

    suspend fun setActiveHub(hubId: String) {
        dataStore.edit { prefs -> prefs[ACTIVE_HUB_KEY] = hubId }
    }

    suspend fun clearActiveHub() {
        dataStore.edit { prefs -> prefs.remove(ACTIVE_HUB_KEY) }
    }
}
```

**Run (green):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.hub.ActiveHubStateTest" 2>&1 | tail -20
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/di/ apps/android/app/src/main/java/org/llamenos/hotline/hub/ActiveHubState.kt apps/android/app/src/test/java/org/llamenos/hotline/hub/ActiveHubStateTest.kt
git commit -m "feat(android): add ActiveHubState DataStore StateFlow and ApplicationScope CoroutineScope Hilt module"
```

---

### Task 9 — Add hp() to ApiService.kt + audit/wrap all hub-scoped paths

**Files:** `apps/android/app/src/main/java/org/llamenos/hotline/api/ApiService.kt`

No unit test — verified by `./gradlew compileDebugKotlin`.

**Inject `ActiveHubState` into `ApiService`:**

```kotlin
@Singleton
class ApiService @Inject constructor(
    authInterceptor: AuthInterceptor,
    retryInterceptor: RetryInterceptor,
    @PublishedApi internal val keystoreService: KeyValueStore,
    private val activeHubState: ActiveHubState,   // NEW
) {
    // ... existing OkHttp setup unchanged ...

    /**
     * Returns the path prefixed with /hubs/{activeHubId}.
     * Falls back to the bare path if no hub is currently active.
     */
    fun hp(path: String): String {
        val hubId = activeHubState.activeHubId.value ?: return path
        return "/hubs/$hubId$path"
    }
}
```

Audit all `request<T>(method, path, ...)` call sites in `ApiService.kt`. Hub-scoped paths (same list as iOS): `/settings`, `/users`, `/roles`, `/shifts`, `/calls`, `/notes`, `/cases`, `/reports`, `/events`, `/contacts`, `/conversations`, `/bans`, `/blasts`, `/audit`, `/invites`.

Example transformations:

```kotlin
// Before:
request<ShiftsResponse>("GET", "/api/shifts")
// After:
request<ShiftsResponse>("GET", hp("/api/shifts"))

// Global — unchanged:
request<HubsListResponse>("GET", "/api/hubs")
request<AppConfig>("GET", "/api/config")
```

Add `getHubKey(hubId: String)` method:

```kotlin
suspend fun getHubKey(hubId: String): KeyEnvelope {
    return request("GET", "/api/hubs/$hubId/key")
}
```

**Verify:**

```bash
cd apps/android && ./gradlew compileDebugKotlin 2>&1 | grep -E "error:|BUILD"
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/api/ApiService.kt
git commit -m "feat(android): inject ActiveHubState into ApiService, add hp() helper, audit hub-scoped paths"
```

---

### Task 10 — Create HubRepository.kt + wire into HubManagementViewModel

**Files:**
- `apps/android/app/src/main/java/org/llamenos/hotline/hub/HubRepository.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/ui/hubs/HubManagementViewModel.kt`
- `apps/android/app/src/test/java/org/llamenos/hotline/hub/HubRepositoryTest.kt`

**Write the failing test first:**

```kotlin
// apps/android/app/src/test/java/org/llamenos/hotline/hub/HubRepositoryTest.kt
package org.llamenos.hotline.hub

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.model.Hub
import org.llamenos.protocol.KeyEnvelope
import kotlin.test.assertEquals

class HubRepositoryTest {

    private val apiService = mockk<ApiService>()
    private val cryptoService = mockk<CryptoService>(relaxed = true)
    private val activeHubState = mockk<ActiveHubState>(relaxed = true)

    private val repo = HubRepository(apiService, cryptoService, activeHubState)

    @Test
    fun `switchHub fetches key then persists hub ID`() = runTest {
        val envelope = KeyEnvelope(wrappedKey = "aabb", ephemeralPubkey = "ccdd")
        coEvery { apiService.getHubKey("hub-uuid-001") } returns envelope
        coEvery { activeHubState.setActiveHub(any()) } returns Unit

        repo.switchHub("hub-uuid-001")

        coVerify(exactly = 1) { cryptoService.loadHubKey("hub-uuid-001", envelope) }
        coVerify(exactly = 1) { activeHubState.setActiveHub("hub-uuid-001") }
    }

    @Test
    fun `switchHub does not persist if key fetch throws`() = runTest {
        coEvery { apiService.getHubKey(any()) } throws RuntimeException("network error")

        runCatching { repo.switchHub("hub-uuid-001") }

        coVerify(exactly = 0) { activeHubState.setActiveHub(any()) }
    }

    @Test
    fun `switchHub skips fetch if key already cached`() = runTest {
        coEvery { cryptoService.hasHubKey("hub-uuid-001") } returns true
        coEvery { activeHubState.setActiveHub(any()) } returns Unit

        repo.switchHub("hub-uuid-001")

        coVerify(exactly = 0) { apiService.getHubKey(any()) }
        coVerify(exactly = 1) { activeHubState.setActiveHub("hub-uuid-001") }
    }
}
```

**Run (red):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.hub.HubRepositoryTest" 2>&1 | tail -20
```

**Implementation — `HubRepository.kt`:**

```kotlin
package org.llamenos.hotline.hub

import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.crypto.CryptoService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Orchestrates hub switching. Injects ActiveHubState and ApiService independently;
 * does not create a circular dependency because neither ApiService nor ActiveHubState
 * owns the other.
 */
@Singleton
class HubRepository @Inject constructor(
    private val apiService: ApiService,
    private val cryptoService: CryptoService,
    private val activeHubState: ActiveHubState,
) {

    /**
     * Switch to a different hub.
     *
     * 1. If the hub key is not cached, fetch it from the server and unwrap via CryptoService.
     * 2. Persist the new active hub ID via ActiveHubState.
     *
     * Throws on key fetch or unwrap failure — caller must not update UI state on exception.
     */
    suspend fun switchHub(hubId: String) {
        if (!cryptoService.hasHubKey(hubId)) {
            val envelope = apiService.getHubKey(hubId)
            cryptoService.loadHubKey(hubId, envelope)
        }
        activeHubState.setActiveHub(hubId)
    }

    /**
     * Load hub keys for all hubs in parallel. Called after login.
     * Failures are logged and skipped — missing keys mean relay events from that hub
     * cannot be decrypted, which is safe.
     */
    suspend fun loadAllHubKeys(hubs: List<org.llamenos.hotline.model.Hub>) {
        hubs.map { hub ->
            kotlinx.coroutines.async {
                runCatching {
                    val envelope = apiService.getHubKey(hub.id)
                    cryptoService.loadHubKey(hub.id, envelope)
                }.onFailure { e ->
                    android.util.Log.w("HubRepository", "Failed to load key for hub ${hub.id}: ${e.message}")
                }
            }
        }.map { it.await() }
    }

    /**
     * Initialize hub selection after login. If no hub is persisted, select the first one.
     */
    suspend fun loadInitialHub(hubs: List<org.llamenos.hotline.model.Hub>) {
        if (activeHubState.activeHubId.value != null) return
        hubs.firstOrNull()?.id?.let { switchHub(it) }
    }
}
```

**Update `HubManagementViewModel.kt`** — replace `switchHub(hubId: String)` and add `activeHubId` StateFlow:

```kotlin
@HiltViewModel
class HubManagementViewModel @Inject constructor(
    private val apiService: ApiService,
    private val hubRepository: HubRepository,           // NEW injection
    private val activeHubState: ActiveHubState,         // NEW injection
) : ViewModel() {

    // Derived directly from ActiveHubState — no local copy
    val activeHubId: StateFlow<String?> = activeHubState.activeHubId
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    // Remove activeHubId from HubListState — it is no longer local state
    // (HubListState keeps hubs, isLoading, isRefreshing, error, isCreating, createError,
    //  createSuccess, isSwitching — but NOT activeHubId)

    fun switchHub(hub: Hub) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSwitching = true) }
            runCatching { hubRepository.switchHub(hub.id) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            _uiState.update { it.copy(isSwitching = false) }
        }
    }

    // loadHubs(), createHub(), refresh(), etc. — unchanged
}
```

Also remove `activeHubId: String?` field from `HubListState` data class.

**Run (green):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.hub.HubRepositoryTest" 2>&1 | tail -20
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/hub/ apps/android/app/src/main/java/org/llamenos/hotline/ui/hubs/ apps/android/app/src/test/java/org/llamenos/hotline/hub/HubRepositoryTest.kt
git commit -m "feat(android): HubRepository switchHub/loadAllHubKeys, wire into HubManagementViewModel"
```

---

### Task 11 — Android hub-scoped ViewModels: collect activeHubId + reload

**Files:** All hub-scoped ViewModel files (ShiftViewModel, CallsViewModel, NotesViewModel, CasesViewModel, ConversationsViewModel, etc.)

No unit test — structural. Verified by `./gradlew compileDebugKotlin`.

Pattern applied to every hub-scoped ViewModel:

```kotlin
// Add to constructor injection:
private val activeHubState: ActiveHubState,

// Add to init block:
init {
    activeHubState.activeHubId
        .distinctUntilChanged()
        .filterNotNull()
        .onEach { loadData() }
        .launchIn(viewModelScope)
}
```

**Verify:**

```bash
cd apps/android && ./gradlew compileDebugKotlin 2>&1 | grep -E "error:|BUILD"
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/ui/
git commit -m "feat(android): hub-scoped ViewModels reload on activeHubId change via StateFlow"
```

---

### Task 12 — Android CryptoService: clearHubKeys/allHubKeys/loadHubKey + unit test

**Files:**
- `apps/android/app/src/main/java/org/llamenos/hotline/crypto/CryptoService.kt`
- `apps/android/app/src/test/java/org/llamenos/hotline/crypto/CryptoServiceHubKeyTest.kt`

**Write the failing test first:**

```kotlin
// apps/android/app/src/test/java/org/llamenos/hotline/crypto/CryptoServiceHubKeyTest.kt
package org.llamenos.hotline.crypto

import org.junit.Test
import org.llamenos.protocol.KeyEnvelope
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CryptoServiceHubKeyTest {

    @Test
    fun `storeHubKeyForTesting caches key`() {
        val crypto = CryptoService()
        crypto.storeHubKeyForTesting("hub-001", "deadbeef")
        assertTrue(crypto.hasHubKey("hub-001"))
        assertEquals("deadbeef", crypto.allHubKeys()["hub-001"])
    }

    @Test
    fun `clearHubKeys evicts all cached keys`() {
        val crypto = CryptoService()
        crypto.storeHubKeyForTesting("hub-001", "aabbcc")
        crypto.storeHubKeyForTesting("hub-002", "ddeeff")
        crypto.clearHubKeys()
        assertEquals(0, crypto.hubKeyCount)
        assertTrue(crypto.allHubKeys().isEmpty())
    }

    @Test
    fun `hubKeyCount reflects cache size`() {
        val crypto = CryptoService()
        assertEquals(0, crypto.hubKeyCount)
        crypto.storeHubKeyForTesting("hub-001", "aabbcc")
        assertEquals(1, crypto.hubKeyCount)
    }

    @Test
    fun `lock clears hub key cache`() {
        val crypto = CryptoService()
        crypto.storeHubKeyForTesting("hub-001", "aabbcc")
        crypto.lock()
        assertEquals(0, crypto.hubKeyCount)
    }

    @Test
    fun `hasHubKey returns false for uncached hub`() {
        val crypto = CryptoService()
        assertFalse(crypto.hasHubKey("hub-not-present"))
    }
}
```

**Run (red):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.crypto.CryptoServiceHubKeyTest" 2>&1 | tail -20
```

**Implementation — add to `CryptoService.kt`:**

```kotlin
// Hub key cache — in-memory only, never persisted.
// Access protected by hubKeyLock for thread safety.
private val hubKeyCache = java.util.concurrent.ConcurrentHashMap<String, String>()

val hubKeyCount: Int get() = hubKeyCache.size

fun hasHubKey(hubId: String): Boolean = hubKeyCache.containsKey(hubId)

fun allHubKeys(): Map<String, String> = HashMap(hubKeyCache)

/**
 * Unwrap an ECIES hub key envelope and store the raw key hex in the cache.
 * Requires the nsec to be loaded (app unlocked).
 */
suspend fun loadHubKey(hubId: String, envelope: KeyEnvelope) {
    withContext(computeDispatcher) {
        val nsec = nsecHex ?: throw CryptoException("No key loaded — app is locked")
        // FFI call: ECIES unwrap → raw 32-byte key hex
        val keyHex = org.llamenos.core.LlamenosCore.decryptHubKey(
            wrappedKey = envelope.wrappedKey,
            ephemeralPubkey = envelope.ephemeralPubkey,
            secretKeyHex = nsec,
        )
        hubKeyCache[hubId] = keyHex
    }
}

/** Evict all hub keys. Call on lock and logout. */
fun clearHubKeys() {
    hubKeyCache.clear()
}

/** Clear nsec from memory (lock). Also clears hub key cache. */
fun lock() {
    nsecHex = null
    nsecBech32 = null
    clearHubKeys()
}

// Test-only bypass (no FFI needed in unit tests)
@VisibleForTesting
internal fun storeHubKeyForTesting(hubId: String, keyHex: String) {
    hubKeyCache[hubId] = keyHex
}
```

**Run (green):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.crypto.CryptoServiceHubKeyTest" 2>&1 | tail -20
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/crypto/CryptoService.kt apps/android/app/src/test/java/org/llamenos/hotline/crypto/CryptoServiceHubKeyTest.kt
git commit -m "feat(android): hub key cache in CryptoService — clearHubKeys/allHubKeys/loadHubKey/lock eviction"
```

---

## Phase 4: iOS Spec 1b — Background Services

### Task 13 — Eager hub key loading + cache-miss switchHub fallback + unit tests

**Files:** `apps/ios/Sources/App/AppState.swift`, `apps/ios/Tests/AppStateHubKeyTests.swift`

This task completes the stub from Task 3. The `loadAllHubKeys(hubs:)` implementation is now real (using the `CryptoService` methods from Task 7 and `APIService.getHubKey` from Task 4).

The ViewModel `switchHub()` from Task 5 already handles the cache-miss case: `hasHubKey(hubId:)` check → on-demand fetch if missing. No changes needed to the ViewModel — the test here covers the AppState eager loading path.

**Write the failing test first:**

```swift
// apps/ios/Tests/AppStateHubKeyTests.swift
import Testing
@testable import Llamenos

@MainActor
struct AppStateHubKeyTests {

    @Test func loadAllHubKeysPopulatesCacheForAllHubs() async {
        let ctx = HubContext()
        let mockAPI = MockAPIService()
        let crypto = CryptoService()
        // Load a mock identity so CryptoService is "unlocked"
        crypto.setMockIdentity()

        mockAPI.hubKeyResponses = [
            "hub-001": KeyEnvelope(wrappedKey: "aabb", ephemeralPubkey: "ccdd"),
            "hub-002": KeyEnvelope(wrappedKey: "eeff", ephemeralPubkey: "0011"),
        ]
        // Use a minimal AppState that exposes loadAllHubKeys for testing
        let appState = AppState(hubContext: ctx)

        let hubs = [
            Hub(id: "hub-001", name: "Hub One", slug: "hub-one"),
            Hub(id: "hub-002", name: "Hub Two", slug: "hub-two"),
        ]

        await appState.loadAllHubKeys(hubs: hubs)

        // Both hub keys should be cached after loadAllHubKeys
        // (using MockCryptoService.loadedHubKeyIds for assertion)
        #expect(appState.cryptoService.hasHubKey(hubId: "hub-001") == true)
        #expect(appState.cryptoService.hasHubKey(hubId: "hub-002") == true)
    }

    @Test func loadAllHubKeysSkipsHubOnFetchFailure() async {
        let ctx = HubContext()
        let mockAPI = MockAPIService()
        mockAPI.hubKeyResponses = [
            "hub-001": KeyEnvelope(wrappedKey: "aabb", ephemeralPubkey: "ccdd"),
        ]
        mockAPI.hubKeyErrors = ["hub-002": APIError.requestFailed(statusCode: 403, body: "forbidden")]

        let appState = AppState(hubContext: ctx)
        let hubs = [
            Hub(id: "hub-001", name: "Hub One", slug: "hub-one"),
            Hub(id: "hub-002", name: "Hub Two", slug: "hub-two"),
        ]

        await appState.loadAllHubKeys(hubs: hubs)

        #expect(appState.cryptoService.hasHubKey(hubId: "hub-001") == true)
        #expect(appState.cryptoService.hasHubKey(hubId: "hub-002") == false)
    }

    @Test func clearHubKeysEvictsAllAfterLock() async {
        let ctx = HubContext()
        let appState = AppState(hubContext: ctx)
        appState.cryptoService.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        appState.lockApp()
        #expect(appState.cryptoService.hubKeyCount == 0)
    }
}
```

**Run (red):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/AppStateHubKeyTests 2>&1 | tail -20'
```

The stub in `loadAllHubKeys` from Task 3 already has the correct parallel implementation. Confirm `lockApp()` calls `clearHubKeys()`:

```swift
// In AppState.swift lockApp():
func lockApp() {
    authStatus = .locked
    isLocked = true
    cryptoService.lock()      // lock() now clears hub keys (Task 7)
    hubContext.clearActiveHub()
}

// In AppState.swift logout():
func logout() {
    // ... existing cleanup ...
    cryptoService.lock()      // clears hub keys
    hubContext.clearActiveHub()
}
```

**Run (green):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/AppStateHubKeyTests 2>&1 | tail -20'
```

**Commit:**

```bash
git add apps/ios/Sources/App/AppState.swift apps/ios/Tests/AppStateHubKeyTests.swift
git commit -m "feat(ios): eager hub key loading in AppState.loadAllHubKeys, lock/logout eviction tests"
```

---

### Task 14 — AttributedHubEvent type + WebSocketService refactor + unit tests

**Files:**
- `apps/ios/Sources/Services/WebSocketService.swift`
- `apps/ios/Tests/WebSocketServiceAttributionTests.swift`

**Write the failing test first:**

```swift
// apps/ios/Tests/WebSocketServiceAttributionTests.swift
import Testing
@testable import Llamenos

struct WebSocketServiceAttributionTests {

    @Test func decryptEventAttributesToCorrectHub() throws {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aaaa0000111122223333444455556666")
        crypto.storeHubKeyForTesting(hubId: "hub-002", keyHex: "bbbb0000111122223333444455556666")

        let ws = WebSocketService(cryptoService: crypto)

        // Encrypt a test event with hub-001's key
        let testEvent = ProtocolHubEvent(type: "call:ring", payload: [:])
        let encryptedContent = try MockCrypto.encryptWithKey("aaaa0000111122223333444455556666", event: testEvent)

        let attributed = ws.decryptEvent(encryptedContent)

        #expect(attributed != nil)
        #expect(attributed?.hubId == "hub-001")
        #expect(attributed?.event.type == "call:ring")
    }

    @Test func decryptEventReturnsNilWhenNoKeyMatches() {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aaaa0000111122223333444455556666")

        let ws = WebSocketService(cryptoService: crypto)
        let result = ws.decryptEvent("deadbeefencryptedwithunknownkey")
        #expect(result == nil)
    }
}
```

**Implementation — update `WebSocketService.swift`:**

Add `AttributedHubEvent` type (add before `WebSocketService` class):

```swift
// MARK: - AttributedHubEvent

/// A decrypted hub event attributed to a specific hub by successful key decryption.
struct AttributedHubEvent: Sendable {
    let hubId: String
    let event: ProtocolHubEvent  // generated from protocol codegen
}
```

Update `WebSocketService` to:
1. Accept `CryptoService` in its constructor (currently constructed without dependencies in `AppState.init()`):

```swift
init(cryptoService: CryptoService) {
    self.cryptoService = cryptoService
    self.session = URLSession.shared
}

private let cryptoService: CryptoService
```

2. Replace `typedEvents` stream (`AsyncStream<HubEventType>`) with `attributedEvents` stream (`AsyncStream<AttributedHubEvent>`):

```swift
var attributedEvents: AsyncStream<AttributedHubEvent> {
    AsyncStream { continuation in
        let id = UUID()
        attributedContinuationsLock.lock()
        attributedContinuations[id] = continuation
        attributedContinuationsLock.unlock()
        continuation.onTermination = { [weak self] _ in
            self?.attributedContinuationsLock.lock()
            self?.attributedContinuations.removeValue(forKey: id)
            self?.attributedContinuationsLock.unlock()
        }
    }
}

private var attributedContinuations: [UUID: AsyncStream<AttributedHubEvent>.Continuation] = [:]
private let attributedContinuationsLock = NSLock()
```

3. Add `decryptEvent(_:)` method (internal — accessible to tests via `@testable import`):

```swift
func decryptEvent(_ encryptedContent: String) -> AttributedHubEvent? {
    for (hubId, keyHex) in cryptoService.allHubKeys() {
        guard
            let plaintext = try? ffiDecryptServerEventHex(encryptedHex: encryptedContent, keyHex: keyHex),
            let data = plaintext.data(using: .utf8),
            let event = try? JSONDecoder().decode(ProtocolHubEvent.self, from: data)
        else { continue }
        return AttributedHubEvent(hubId: hubId, event: event)
    }
    return nil
}
```

4. In the raw event receive loop, after receiving a Nostr event, call `decryptEvent` and emit to `attributedContinuations`:

```swift
// In the receive loop, after emitting to raw continuations:
if let attributed = decryptEvent(nostrEvent.content) {
    attributedContinuationsLock.lock()
    for cont in attributedContinuations.values {
        cont.yield(attributed)
    }
    attributedContinuationsLock.unlock()
}
```

5. Remove `typedEvents` and `typedContinuations` — they are superseded by `attributedEvents`. Update all consumers (`AppState`, ViewModels) that previously collected `typedEvents` to collect `attributedEvents` instead. Active-hub consumers filter by `hubId == hubContext.activeHubId`. Background consumers (activity indicators, call handler) process all hubs.

Update `AppState.init()` to pass `cryptoService` to `WebSocketService`:

```swift
let ws = WebSocketService(cryptoService: crypto)
```

**Run (green):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/WebSocketServiceAttributionTests 2>&1 | tail -20'
```

**Commit:**

```bash
git add apps/ios/Sources/Services/WebSocketService.swift apps/ios/Tests/WebSocketServiceAttributionTests.swift
git commit -m "feat(ios): replace typed hub events with AttributedHubEvent — decrypt-all-keys attribution in WebSocketService"
```

---

### Task 15 — Per-hub activity indicators + unit tests

**Files:**
- `apps/ios/Sources/Services/HubActivityService.swift` (new)
- `apps/ios/Tests/HubActivityServiceTests.swift`

**Write the failing test first:**

```swift
// apps/ios/Tests/HubActivityServiceTests.swift
import Testing
@testable import Llamenos

@MainActor
struct HubActivityServiceTests {

    @Test func callRingIncrementsActiveCallCount() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "call:ring", payload: [:])))
        #expect(svc.state(for: "hub-001").activeCallCount == 1)
    }

    @Test func callAnsweredDecrementsActiveCallCount() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "call:ring", payload: [:])))
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "call:answered", payload: [:])))
        #expect(svc.state(for: "hub-001").activeCallCount == 0)
    }

    @Test func activeCallCountNeverGoesNegative() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "call:answered", payload: [:])))
        #expect(svc.state(for: "hub-001").activeCallCount == 0)
    }

    @Test func shiftStartedSetsIsOnShift() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "shift:started", payload: [:])))
        #expect(svc.state(for: "hub-001").isOnShift == true)
    }

    @Test func shiftEndedClearsIsOnShift() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "shift:started", payload: [:])))
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "shift:ended", payload: [:])))
        #expect(svc.state(for: "hub-001").isOnShift == false)
    }

    @Test func messageNewIncrementsUnreadCount() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "message:new", payload: [:])))
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "message:new", payload: [:])))
        #expect(svc.state(for: "hub-001").unreadMessageCount == 2)
    }

    @Test func openHubClearsUnreadCounts() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "message:new", payload: [:])))
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "conversation:assigned", payload: [:])))
        svc.markHubOpened("hub-001")
        let state = svc.state(for: "hub-001")
        #expect(state.unreadMessageCount == 0)
        #expect(state.unreadConversationCount == 0)
    }

    @Test func statesForDifferentHubsAreIsolated() {
        let svc = HubActivityService()
        svc.handle(AttributedHubEvent(hubId: "hub-001", event: ProtocolHubEvent(type: "call:ring", payload: [:])))
        #expect(svc.state(for: "hub-001").activeCallCount == 1)
        #expect(svc.state(for: "hub-002").activeCallCount == 0)
    }
}
```

**Implementation — `HubActivityService.swift`:**

```swift
import Foundation

// MARK: - HubActivityState

struct HubActivityState: Equatable {
    var isOnShift: Bool = false
    var activeCallCount: Int = 0
    var unreadMessageCount: Int = 0
    var unreadConversationCount: Int = 0
}

// MARK: - HubActivityService

/// Tracks per-hub live activity state driven by relay events from all hubs simultaneously.
/// Consumers (HubManagementView hub rows) read state for each hub to show badges.
///
/// Thread-safe: all mutations go through stateLock.
@Observable
final class HubActivityService {
    private var states: [String: HubActivityState] = [:]
    private let stateLock = NSLock()

    /// Get the current activity state for a hub. Returns empty state if hub never seen.
    func state(for hubId: String) -> HubActivityState {
        stateLock.lock()
        defer { stateLock.unlock() }
        return states[hubId] ?? HubActivityState()
    }

    /// Process an attributed relay event and update the appropriate hub's state.
    func handle(_ attributed: AttributedHubEvent) {
        stateLock.lock()
        var s = states[attributed.hubId] ?? HubActivityState()
        switch attributed.event.type {
        case "call:ring":
            s.activeCallCount += 1
        case "call:answered", "call:ended", "call:voicemail":
            s.activeCallCount = max(0, s.activeCallCount - 1)
        case "shift:started":
            s.isOnShift = true
        case "shift:ended":
            s.isOnShift = false
        case "message:new":
            s.unreadMessageCount += 1
        case "conversation:assigned":
            s.unreadConversationCount += 1
        case "conversation:closed":
            s.unreadConversationCount = max(0, s.unreadConversationCount - 1)
        default:
            break
        }
        states[attributed.hubId] = s
        stateLock.unlock()
    }

    /// User opened a hub — clear unread counts for that hub.
    func markHubOpened(_ hubId: String) {
        stateLock.lock()
        var s = states[hubId] ?? HubActivityState()
        s.unreadMessageCount = 0
        s.unreadConversationCount = 0
        states[hubId] = s
        stateLock.unlock()
    }
}
```

Add `hubActivityService` to `AppState` and wire it to consume `attributedEvents` from `WebSocketService`.

**Run (green):**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -only-testing LlamenosTests/HubActivityServiceTests 2>&1 | tail -20'
```

**Commit:**

```bash
git add apps/ios/Sources/Services/HubActivityService.swift apps/ios/Tests/HubActivityServiceTests.swift
git commit -m "feat(ios): HubActivityService — per-hub activity state machine driven by AttributedHubEvent"
```

---

### Task 16 — Push notification routing: hubId in payload → switch hub + navigate

**Files:** `apps/ios/Sources/App/LlamenosApp.swift` (AppDelegate section)

No unit test — routing logic is in AppDelegate callbacks. Verified by typecheck.

Update `AppDelegate.didReceiveRemoteNotification` to read `hubId` from the decrypted wake payload and call `hubContext.setActiveHub`:

```swift
// In AppDelegate, after decrypting wake payload and parsing JSON:
if let hubId = payload["hubId"] as? String {
    await MainActor.run {
        appState.hubContext.setActiveHub(hubId)
    }
}
```

Add `UNUserNotificationCenterDelegate` to `AppDelegate` to handle notification tap:

```swift
extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if let hubId = userInfo["hubId"] as? String {
            appState?.hubContext.setActiveHub(hubId)
        }
        if let deepLinkType = userInfo["deepLinkType"] as? String,
           let entityId = userInfo["deepLinkEntityId"] as? String {
            // Navigate via router — must be on main actor
            Task { @MainActor in
                navigateForPushType(deepLinkType, entityId: entityId)
            }
        }
        completionHandler()
    }
}
```

Register delegate in `AppDelegate.application(_:didFinishLaunchingWithOptions:)`:

```swift
UNUserNotificationCenter.current().delegate = self
```

**Verify:**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

**Commit:**

```bash
git add apps/ios/Sources/App/LlamenosApp.swift
git commit -m "feat(ios): push notification tap routes to hub via hubId in payload, switches HubContext"
```

---

## Phase 5: Android Spec 1b — Background Services

### Task 17 — Android eager hub key loading + WebSocketService AttributedHubEvent refactor + unit tests

**Files:**
- `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/hub/HubActivityService.kt` (new)
- `apps/android/app/src/test/java/org/llamenos/hotline/api/WebSocketServiceAttributionTest.kt`
- `apps/android/app/src/test/java/org/llamenos/hotline/hub/HubActivityServiceTest.kt`

**Write the failing tests first:**

```kotlin
// apps/android/app/src/test/java/org/llamenos/hotline/api/WebSocketServiceAttributionTest.kt
package org.llamenos.hotline.api

import org.junit.Test
import org.llamenos.hotline.crypto.CryptoService
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class WebSocketServiceAttributionTest {

    @Test
    fun `decryptEvent attributes to hub with matching key`() {
        val crypto = CryptoService()
        crypto.storeHubKeyForTesting("hub-001", "aaaa0000111122223333444455556666deadbeef")
        crypto.storeHubKeyForTesting("hub-002", "bbbb0000111122223333444455556666deadbeef")

        val ws = WebSocketService(crypto, mockk(relaxed = true))

        // Encrypt with hub-001's key (use test helper)
        val encrypted = TestCrypto.encryptWithKey("aaaa0000111122223333444455556666deadbeef", """{"type":"call:ring"}""")

        val result = ws.decryptEvent(encrypted)

        assertNotNull(result)
        assertEquals("hub-001", result.hubId)
        assertEquals("call:ring", result.event.type)
    }

    @Test
    fun `decryptEvent returns null when no key matches`() {
        val crypto = CryptoService()
        val ws = WebSocketService(crypto, mockk(relaxed = true))

        val result = ws.decryptEvent("deadbeefciphertext")
        assertNull(result)
    }
}
```

```kotlin
// apps/android/app/src/test/java/org/llamenos/hotline/hub/HubActivityServiceTest.kt
package org.llamenos.hotline.hub

import org.junit.Test
import org.llamenos.protocol.ProtocolHubEvent
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HubActivityServiceTest {

    private val svc = HubActivityService()

    @Test fun `call:ring increments activeCallCount`() {
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "call:ring")))
        assertEquals(1, svc.state("hub-001").activeCallCount)
    }

    @Test fun `call:answered decrements activeCallCount`() {
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "call:ring")))
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "call:answered")))
        assertEquals(0, svc.state("hub-001").activeCallCount)
    }

    @Test fun `activeCallCount never goes negative`() {
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "call:answered")))
        assertEquals(0, svc.state("hub-001").activeCallCount)
    }

    @Test fun `shift:started sets isOnShift`() {
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "shift:started")))
        assertTrue(svc.state("hub-001").isOnShift)
    }

    @Test fun `markHubOpened clears unread counts`() {
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "message:new")))
        svc.markHubOpened("hub-001")
        assertEquals(0, svc.state("hub-001").unreadMessageCount)
    }

    @Test fun `states for different hubs are isolated`() {
        svc.handle(AttributedHubEvent("hub-001", ProtocolHubEvent(type = "call:ring")))
        assertEquals(0, svc.state("hub-002").activeCallCount)
    }
}
```

**Run (red):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.api.WebSocketServiceAttributionTest,org.llamenos.hotline.hub.HubActivityServiceTest" 2>&1 | tail -30
```

**Implementation — `AttributedHubEvent` and `HubActivityService` additions:**

```kotlin
// apps/android/app/src/main/java/org/llamenos/hotline/hub/HubActivityService.kt
package org.llamenos.hotline.hub

import org.llamenos.protocol.ProtocolHubEvent
import javax.inject.Inject
import javax.inject.Singleton
import java.util.concurrent.ConcurrentHashMap

data class AttributedHubEvent(
    val hubId: String,
    val event: ProtocolHubEvent,
)

data class HubActivityState(
    val isOnShift: Boolean = false,
    val activeCallCount: Int = 0,
    val unreadMessageCount: Int = 0,
    val unreadConversationCount: Int = 0,
)

@Singleton
class HubActivityService @Inject constructor() {
    private val states = ConcurrentHashMap<String, HubActivityState>()

    fun state(hubId: String): HubActivityState = states.getOrDefault(hubId, HubActivityState())

    fun handle(attributed: AttributedHubEvent) {
        states.compute(attributed.hubId) { _, current ->
            val s = current ?: HubActivityState()
            when (attributed.event.type) {
                "call:ring" -> s.copy(activeCallCount = s.activeCallCount + 1)
                "call:answered", "call:ended", "call:voicemail" ->
                    s.copy(activeCallCount = maxOf(0, s.activeCallCount - 1))
                "shift:started" -> s.copy(isOnShift = true)
                "shift:ended" -> s.copy(isOnShift = false)
                "message:new" -> s.copy(unreadMessageCount = s.unreadMessageCount + 1)
                "conversation:assigned" -> s.copy(unreadConversationCount = s.unreadConversationCount + 1)
                "conversation:closed" -> s.copy(unreadConversationCount = maxOf(0, s.unreadConversationCount - 1))
                else -> s
            }
        }
    }

    fun markHubOpened(hubId: String) {
        states.compute(hubId) { _, current ->
            (current ?: HubActivityState()).copy(unreadMessageCount = 0, unreadConversationCount = 0)
        }
    }
}
```

Update `WebSocketService.kt` to:
1. Accept `CryptoService` in constructor (already injected — add to `@Inject constructor`)
2. Replace `LlamenosEvent` stream with `SharedFlow<AttributedHubEvent>`
3. Add `decryptEvent(encryptedContent: String): AttributedHubEvent?`:

```kotlin
fun decryptEvent(encryptedContent: String): AttributedHubEvent? {
    for ((hubId, keyHex) in cryptoService.allHubKeys()) {
        val plaintext = runCatching {
            LlamenosCore.decryptServerEventHex(encryptedContent, keyHex)
        }.getOrNull() ?: continue
        val event = runCatching {
            json.decodeFromString<ProtocolHubEvent>(plaintext)
        }.getOrNull() ?: continue
        return AttributedHubEvent(hubId, event)
    }
    return null
}
```

In the WebSocket message handler, replace the existing event emit with:

```kotlin
val attributed = decryptEvent(nostrEvent.content) ?: return
_attributedEvents.tryEmit(attributed)
hubActivityService.handle(attributed)
```

**Run (green):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.api.WebSocketServiceAttributionTest,org.llamenos.hotline.hub.HubActivityServiceTest" 2>&1 | tail -30
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/hub/ apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt apps/android/app/src/test/java/org/llamenos/hotline/
git commit -m "feat(android): AttributedHubEvent stream in WebSocketService, HubActivityService state machine"
```

---

### Task 18 — Android push notification routing + PushService hubId handling

**Files:**
- `apps/android/app/src/main/java/org/llamenos/hotline/service/PushService.kt`

No unit test for push routing (requires `FirebaseMessagingService` lifecycle). Verified by `./gradlew compileDebugKotlin`.

Inject `ActiveHubState` and `LinphoneService` into `PushService`:

```kotlin
@Inject lateinit var activeHubState: ActiveHubState
@Inject lateinit var linphoneService: LinphoneService
```

In `onMessageReceived`, after decrypting the wake payload, read `hubId`:

```kotlin
// After decrypting wake payload JSON:
val hubId = payloadJson.optString("hubId")
if (hubId.isNotEmpty()) {
    serviceScope.launch { activeHubState.setActiveHub(hubId) }
}
```

For VoIP/incoming call messages (where `type == "incoming_call"`), store the pending call hub map:

```kotlin
val callId = remoteMessage.data["call-id"] ?: ""
val hubId = remoteMessage.data["hub-id"] ?: ""
if (callId.isNotEmpty() && hubId.isNotEmpty()) {
    linphoneService.storePendingCallHub(callId, hubId)
}
```

**Verify:**

```bash
cd apps/android && ./gradlew compileDebugKotlin 2>&1 | grep -E "error:|BUILD"
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/service/PushService.kt
git commit -m "feat(android): PushService reads hubId from payload, routes to ActiveHubState and LinphoneService"
```

---

## Phase 6: iOS Linphone Integration

### Task 19 — iOS Linphone SDK setup + LinphoneService.swift skeleton + LlamenosApp wiring + PushKit ownership

**Files:**
- `apps/ios/Sources/Services/LinphoneService.swift` (new)
- `apps/ios/project.yml`
- `apps/ios/Sources/App/LlamenosApp.swift`

**Linphone SDK integration decision:** Use the official Linphone XCFramework (direct download — no CocoaPods required, preserving the pure-SPM+xcodegen build system). Download URL: `https://download.linphone.org/releases/ios/linphone-sdk-ios-5.3.x.zip`. Unzip and place `linphone-sdk.xcframework` in `apps/ios/Frameworks/`. Pin version in a `Frameworks/LINPHONE_VERSION` file.

**`project.yml` changes** — add framework dependency and Info.plist keys:

```yaml
targets:
  Llamenos:
    dependencies:
      - framework: LlamenosCoreFFI.xcframework
        embed: false
      - framework: Frameworks/linphone-sdk.xcframework   # NEW
        embed: true
    info:
      properties:
        NSMicrophoneUsageDescription: "Llamenos uses your microphone to answer crisis calls."
        UIBackgroundModes:
          - voip
          - audio
```

Add entitlement for VoIP PushKit (in `Llamenos.entitlements`):

```xml
<key>aps-environment</key>
<string>development</string>
```

(Already present — VoIP push uses the same APS environment entitlement with the `.voip` topic.)

**`LinphoneService.swift`:**

```swift
import Foundation
import linphonesw   // XCFramework module name

// MARK: - LinphoneError

enum LinphoneError: LocalizedError {
    case notInitialized
    case accountRegistrationFailed(String)
    case coreStartFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "Linphone Core not initialized"
        case .accountRegistrationFailed(let msg):
            return "SIP account registration failed: \(msg)"
        case .coreStartFailed(let msg):
            return "Linphone Core failed to start: \(msg)"
        }
    }
}

// MARK: - SipTokenResponse

/// Response from GET /hubs/{hubId}/telephony/sip-token
struct SipTokenResponse: Decodable {
    let username: String
    let domain: String
    let password: String
    let transport: String  // "tls" | "wss"
    let expiry: Int        // seconds
}

// MARK: - LinphoneService

/// @Observable singleton that owns the Linphone Core for SIP calling.
///
/// Initialized from LlamenosApp.init(). Manages one SIP account per hub the user
/// is on shift in. Handles PushKit VoIP push (sole PKPushRegistry delegate after
/// core.start()) and routes hub attribution via pendingCallHubIds.
///
/// Called from main thread only for account registration/unregistration.
/// Core listener callbacks may arrive on any thread.
@Observable
final class LinphoneService {
    private var core: Core?
    private var hubAccounts: [String: Account] = [:]   // hubId → Account

    /// callId → hubId. Populated from VoIP push handler before Linphone processes INVITE.
    private var pendingCallHubIds: [String: String] = [:]
    private let pendingCallLock = NSLock()

    private weak var hubContext: HubContext?

    // MARK: - Initialization

    func initialize(hubContext: HubContext) throws {
        self.hubContext = hubContext
        let factory = Factory.Instance
        let core = try factory.createCore(
            configFilename: "linphone",
            factoryConfigFilename: nil,
            systemContext: nil
        )
        core.callKitEnabled = true
        core.mediaEncryption = .SRTP
        core.mediaEncryptionMandatory = true

        // Enable Opus + PCMU only
        for pt in core.audioPayloadTypes {
            pt.enable(pt.mimeType == "opus" || pt.mimeType == "PCMU")
        }

        setupCoreDelegate(core: core)

        try core.start()
        // After core.start(), Linphone registers its PKPushRegistry delegate.
        // Any existing VoIP PushKit registration in AppDelegate must be removed.
        self.core = core
    }

    // MARK: - SIP Account Management

    func registerHubAccount(hubId: String, sipParams: SipTokenResponse) throws {
        guard let core else { throw LinphoneError.notInitialized }
        let params = try core.createAccountParams()
        let identity = try Factory.Instance.createAddress(
            addr: "sip:\(sipParams.username)@\(sipParams.domain)"
        )
        try params.setIdentityaddress(newValue: identity)
        let server = try Factory.Instance.createAddress(
            addr: "sip:\(sipParams.domain);transport=\(sipParams.transport)"
        )
        try params.setServeraddress(newValue: server)
        params.registerEnabled = true
        let account = try core.createAccount(params: params)
        try core.addAccount(account: account)
        hubAccounts[hubId] = account
    }

    func unregisterHubAccount(hubId: String) {
        guard let account = hubAccounts.removeValue(forKey: hubId) else { return }
        core?.removeAccount(account: account)
    }

    // MARK: - VoIP Push Handling

    /// Store callId → hubId mapping before Linphone processes the SIP INVITE.
    /// Called from PushKit handler (may be on any thread).
    func handleVoipPush(callId: String, hubId: String) {
        pendingCallLock.lock()
        pendingCallHubIds[callId] = hubId
        pendingCallLock.unlock()
    }

    // MARK: - Core Delegate

    private func setupCoreDelegate(core: Core) {
        let delegate = CoreDelegateStub(
            onCallStateChanged: { [weak self] core, call, state, message in
                guard let self else { return }
                let callId = call.callLog?.callId ?? ""
                switch state {
                case .IncomingReceived:
                    self.pendingCallLock.lock()
                    let hubId = self.pendingCallHubIds.removeValue(forKey: callId)
                    self.pendingCallLock.unlock()
                    if let hubId {
                        Task { @MainActor in
                            self.hubContext?.setActiveHub(hubId)
                        }
                    }
                case .Released, .End:
                    self.pendingCallLock.lock()
                    self.pendingCallHubIds.removeValue(forKey: callId)
                    self.pendingCallLock.unlock()
                default:
                    break
                }
            }
        )
        core.addDelegate(delegate: delegate)
    }
}
```

**`LlamenosApp.swift` changes:**

```swift
// Add LinphoneService as @State
@State private var linphoneService = LinphoneService()

// In init(), after setting up hubContext:
do {
    try linphoneService.initialize(hubContext: hubContext)
} catch {
    print("[Linphone] Initialization failed: \(error)")
}

// Remove any existing PKPushRegistry registration from AppDelegate
// (Linphone takes sole ownership after core.start())
```

**Verify:**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

**Commit:**

```bash
git add apps/ios/Sources/Services/LinphoneService.swift apps/ios/project.yml apps/ios/Sources/App/LlamenosApp.swift
git commit -m "feat(ios): LinphoneService skeleton with Core init, SIP account per hub, VoIP push hub map, PushKit ownership"
```

---

### Task 20 — SIP account per hub on shift + ShiftViewModel integration

**Files:**
- `apps/ios/Sources/Services/LinphoneService.swift`
- `apps/ios/Sources/ViewModels/ShiftViewModel.swift`
- `apps/ios/Sources/Services/APIService.swift`

No unit test for SIP registration (requires Linphone Core). Verified by typecheck.

**APIService.swift** — add `getSipToken(hubId:)`:

```swift
/// Fetch SIP credentials for a hub's telephony provider.
/// Path uses explicit hubId — not hp() — because we need SIP tokens for non-active hubs.
func getSipToken(hubId: String) async throws -> SipTokenResponse {
    return try await request(
        method: "GET",
        path: "/api/hubs/\(hubId)/telephony/sip-token"
    )
}
```

**ShiftViewModel.swift** — wire Linphone on shift state change:

Inject `LinphoneService` and `APIService` into `ShiftViewModel`. When a shift starts:

```swift
// In onShiftStarted(hubId: String):
Task {
    do {
        let sipParams = try await apiService.getSipToken(hubId: hubId)
        try linphoneService.registerHubAccount(hubId: hubId, sipParams: sipParams)
    } catch {
        print("[Linphone] Failed to register SIP account for hub \(hubId): \(error)")
    }
}
```

When a shift ends:

```swift
// In onShiftEnded(hubId: String):
linphoneService.unregisterHubAccount(hubId: hubId)
```

The relay `shift:started` and `shift:ended` events arriving via `attributedEvents` carry the hub context — use `attributed.hubId` to identify which hub's SIP account to register/unregister.

**Verify:**

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

**Commit:**

```bash
git add apps/ios/Sources/Services/LinphoneService.swift apps/ios/Sources/ViewModels/ShiftViewModel.swift apps/ios/Sources/Services/APIService.swift
git commit -m "feat(ios): SIP account registered per hub on shift start/end via LinphoneService + ShiftViewModel"
```

---

## Phase 7: Android Linphone Integration

### Task 21 — LlamenosApplication + Linphone Gradle + LinphoneService.kt + ConnectionService manifest + shift integration

**Files:**
- `apps/android/app/src/main/java/org/llamenos/hotline/LlamenosApplication.kt` (new)
- `apps/android/app/src/main/java/org/llamenos/hotline/telephony/LinphoneService.kt` (new)
- `apps/android/app/build.gradle.kts`
- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/test/java/org/llamenos/hotline/telephony/LinphoneServiceTest.kt`

**Write the failing test first:**

```kotlin
// apps/android/app/src/test/java/org/llamenos/hotline/telephony/LinphoneServiceTest.kt
package org.llamenos.hotline.telephony

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.Test
import org.llamenos.hotline.di.ApplicationScope
import org.llamenos.hotline.hub.ActiveHubState
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LinphoneServiceTest {

    @Test
    fun `storePendingCallHub stores callId to hubId mapping`() {
        val context = mockk<Context>(relaxed = true)
        val activeHubState = mockk<ActiveHubState>(relaxed = true)
        val scope = TestScope(UnconfinedTestDispatcher())

        val svc = LinphoneService(context, activeHubState, scope)
        svc.storePendingCallHub("call-abc-123", "hub-uuid-001")

        assertEquals("hub-uuid-001", svc.pendingCallHubIdForTesting("call-abc-123"))
    }

    @Test
    fun `storePendingCallHub mapping is removed after retrieval`() {
        val context = mockk<Context>(relaxed = true)
        val activeHubState = mockk<ActiveHubState>(relaxed = true)
        val scope = TestScope(UnconfinedTestDispatcher())

        val svc = LinphoneService(context, activeHubState, scope)
        svc.storePendingCallHub("call-abc-123", "hub-uuid-001")
        svc.consumePendingCallHubForTesting("call-abc-123")

        assertNull(svc.pendingCallHubIdForTesting("call-abc-123"))
    }
}
```

**Run (red):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.telephony.LinphoneServiceTest" 2>&1 | tail -20
```

**`apps/android/app/build.gradle.kts` changes** — add Linphone Maven repo and dependency:

```kotlin
android {
    // ... existing config ...
}

repositories {
    maven { url = uri("https://linphone.org/maven_repository/") }
}

dependencies {
    // ... existing deps ...
    implementation("org.linphone:linphone-sdk-android:5.3.+")
}
```

**`LinphoneService.kt`:**

```kotlin
package org.llamenos.hotline.telephony

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.linphone.core.Call
import org.linphone.core.Core
import org.linphone.core.CoreListenerStub
import org.linphone.core.Factory
import org.linphone.core.MediaEncryption
import org.llamenos.hotline.di.ApplicationScope
import org.llamenos.hotline.hub.ActiveHubState
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

data class SipTokenResponse(
    val username: String,
    val domain: String,
    val password: String,
    val transport: String,
    val expiry: Int,
)

@Singleton
class LinphoneService @Inject constructor(
    @ApplicationContext private val context: Context,
    private val activeHubState: ActiveHubState,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private var core: Core? = null
    private val hubAccounts = ConcurrentHashMap<String, org.linphone.core.Account>()
    private val pendingCallHubIds = ConcurrentHashMap<String, String>()  // callId → hubId

    // MARK: - Initialization (must be called from Application.onCreate())

    fun initialize() {
        try {
            val factory = Factory.instance()
            val core = factory.createCore(null, null, context)
            core.isCallkitIntegrationEnabled = true
            core.mediaEncryption = MediaEncryption.SRTP
            core.isMediaEncryptionMandatory = true

            core.audioPayloadTypes.forEach { pt ->
                pt.enable(pt.mimeType == "opus" || pt.mimeType == "PCMU")
            }

            setupCoreListener(core)
            core.start()
            this.core = core
            Log.i("LinphoneService", "Linphone Core initialized successfully")
        } catch (e: Exception) {
            Log.e("LinphoneService", "Failed to initialize Linphone Core: ${e.message}")
        }
    }

    // MARK: - SIP Account Management

    fun registerHubAccount(hubId: String, sipParams: SipTokenResponse) {
        val core = this.core ?: run {
            Log.w("LinphoneService", "Core not initialized — cannot register SIP account for $hubId")
            return
        }
        try {
            val params = core.createAccountParams()
            val identity = Factory.instance().createAddress(
                "sip:${sipParams.username}@${sipParams.domain}"
            )
            params.identityAddress = identity
            val server = Factory.instance().createAddress(
                "sip:${sipParams.domain};transport=${sipParams.transport}"
            )
            params.serverAddress = server
            params.isRegisterEnabled = true
            val account = core.createAccount(params)
            core.addAccount(account)
            hubAccounts[hubId] = account
            Log.i("LinphoneService", "Registered SIP account for hub $hubId")
        } catch (e: Exception) {
            Log.e("LinphoneService", "Failed to register SIP account for $hubId: ${e.message}")
        }
    }

    fun unregisterHubAccount(hubId: String) {
        val account = hubAccounts.remove(hubId) ?: return
        core?.removeAccount(account)
        Log.i("LinphoneService", "Unregistered SIP account for hub $hubId")
    }

    // MARK: - VoIP Push Handling

    /** Called from FCM push handler before Linphone processes the SIP INVITE. */
    fun storePendingCallHub(callId: String, hubId: String) {
        pendingCallHubIds[callId] = hubId
    }

    // MARK: - Core Listener

    private fun setupCoreListener(core: Core) {
        core.addListener(object : CoreListenerStub() {
            override fun onCallStateChanged(
                core: Core,
                call: Call,
                state: Call.State,
                message: String,
            ) {
                val callId = call.callLog?.callId ?: return
                when (state) {
                    Call.State.IncomingReceived -> {
                        pendingCallHubIds.remove(callId)?.let { hubId ->
                            scope.launch { activeHubState.setActiveHub(hubId) }
                        }
                    }
                    Call.State.Released, Call.State.End -> {
                        pendingCallHubIds.remove(callId)
                    }
                    else -> {}
                }
            }
        })
    }

    // Test-only accessors
    internal fun pendingCallHubIdForTesting(callId: String): String? = pendingCallHubIds[callId]
    internal fun consumePendingCallHubForTesting(callId: String) { pendingCallHubIds.remove(callId) }
}
```

**`LlamenosApplication.kt`:**

```kotlin
package org.llamenos.hotline

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import org.llamenos.hotline.telephony.LinphoneService
import javax.inject.Inject

@HiltAndroidApp
class LlamenosApplication : Application() {

    @Inject
    lateinit var linphoneService: LinphoneService

    override fun onCreate() {
        super.onCreate()
        linphoneService.initialize()
    }
}
```

**`AndroidManifest.xml` changes:**

```xml
<!-- Application declaration -->
<application
    android:name=".LlamenosApplication"
    ...>

    <!-- Linphone ConnectionService for full-screen incoming call UI -->
    <service
        android:name="org.linphone.core.tools.service.CoreService"
        android:foregroundServiceType="phoneCall"
        android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"
        android:exported="true">
        <intent-filter>
            <action android:name="android.telecom.ConnectionService"/>
        </intent-filter>
    </service>

    <!-- Existing services remain unchanged -->
</application>

<!-- New permissions -->
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>
<uses-permission android:name="android.permission.BLUETOOTH"/>
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>
<uses-permission android:name="android.permission.MANAGE_OWN_CALLS"/>
```

**Run (green):**

```bash
cd apps/android && ./gradlew testDebugUnitTest --tests "org.llamenos.hotline.telephony.LinphoneServiceTest" 2>&1 | tail -20
```

Also verify full compile:

```bash
cd apps/android && ./gradlew compileDebugKotlin 2>&1 | grep -E "error:|BUILD"
```

**Commit:**

```bash
git add apps/android/app/src/main/java/org/llamenos/hotline/LlamenosApplication.kt apps/android/app/src/main/java/org/llamenos/hotline/telephony/LinphoneService.kt apps/android/app/build.gradle.kts apps/android/app/src/main/AndroidManifest.xml apps/android/app/src/test/java/org/llamenos/hotline/telephony/LinphoneServiceTest.kt
git commit -m "feat(android): LlamenosApplication + LinphoneService + Gradle dependency + ConnectionService manifest + shift integration"
```

---

## Pre-commit Verification Checklist

Before marking implementation complete, run all of the following:

```bash
# Backend
bun run typecheck

# iOS
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | tail -30'

# Android unit tests
cd apps/android && ./gradlew testDebugUnitTest 2>&1 | tail -30

# Android E2E test compilation (required per project conventions)
cd apps/android && ./gradlew compileDebugAndroidTestKotlin 2>&1 | grep -E "error:|BUILD"

# Android lint
cd apps/android && ./gradlew lintDebug 2>&1 | grep -E "Error|Warning.*error"

# Rust crypto (unchanged but verify nothing regressed)
cargo test --manifest-path packages/crypto/Cargo.toml --features mobile
```

All must pass before the implementation is considered complete.

---

## Success Criteria Mapping

| Spec criterion | Task(s) | Verified by |
|---|---|---|
| iOS tapping hub fetches key, updates HubContext.activeHubId, uses `/hubs/{id}/` prefix | 2, 3, 4, 5 | Unit tests + typecheck |
| Android HubRepository.switchHub() fetches key, persists via ActiveHubState, hp() used everywhere | 8, 9, 10 | Unit tests |
| Active hub persists across backgrounding | 2 (UserDefaults), 8 (DataStore) | Unit tests |
| Key fetch failure aborts switch — user stays in previous hub | 5, 10 | Unit tests |
| Hub key cache cleared on lock and logout, hubKeyCount == 0 | 7, 12, 13 | Unit tests |
| iOS isActive() uses UUID comparison | 5 | Unit tests |
| All hub keys loaded at login | 13, 17 | Unit tests |
| WebSocketService emits AttributedHubEvent with correct hubId | 14, 17 | Unit tests |
| Hub activity state machine — correct increments/decrements | 15, 17 | Unit tests |
| Push notification tap switches hub | 16, 18 | typecheck |
| switchHub() on-demand key fetch on cache miss | 5, 10 | Unit tests |
| WakePayload/FullPushPayload carry hubId | 1 | typecheck |
| iOS LinphoneService initializes, registers SIP per shift | 19, 20 | typecheck + BUILD |
| Android LlamenosApplication injects LinphoneService.initialize() | 21 | Unit tests |
| pendingCallHubIds routes VoIP push hubId to correct hub on INVITE | 19, 21 | Unit tests |
