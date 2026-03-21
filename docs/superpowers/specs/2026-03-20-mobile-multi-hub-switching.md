# Mobile Multi-Hub Switching

**Date:** 2026-03-20
**Status:** Approved for implementation
**Priority:** P0 — blocks mobile test isolation and is a broken product experience for multi-hub users

---

## Problem Statement

Users can belong to multiple hubs. On desktop, hub switching is fully implemented: a `HubSwitcher` dropdown in the sidebar updates `activeHubId`, all hub-scoped API calls use the `hp()` path helper to prefix `/hubs/{hubId}/`, and the hub key is managed per-hub.

On iOS and Android, the hub management UI exists (`HubManagementView` / `HubListScreen`) and shows the hub list with a switch action — but the switch only updates local UI state. API calls continue to use bare paths with no hub prefix. Both mobile clients behave as if they belong to exactly one hub. Multi-hub users are silently broken on mobile.

This spec implements real hub switching on iOS and Android, matching the desktop architecture exactly.

---

## Architecture

### Desktop Reference Model

- **Active hub state:** `activeHubId` module-level var in `src/client/lib/api.ts`, managed by `ConfigProvider` React state
- **Path helper:** `hp(path: string)` returns `/hubs/${activeHubId}${path}` for hub-scoped requests
- **Switch action:** `setCurrentHubId()` in ConfigProvider updates state and calls `setActiveHub()`
- **Persistence:** React session state (no persistence needed — hub re-selected from config on reload)
- **Hub key:** `hub-key-manager.ts` manages per-hub ECIES-wrapped symmetric key
- **UI:** `HubSwitcher` sidebar dropdown, re-mounts main content via `key={currentHubId}`

### Hub-Scoped vs Global Paths

**Hub-scoped** (must use `hp()`):
`/settings`, `/settings/cms/*`, `/users`, `/roles`, `/shifts`, `/calls`, `/notes`, `/cases`, `/reports`, `/events`, `/contacts`, `/conversations`, `/bans`, `/blasts`, `/audit`, `/invites`

**Global** (no hub prefix):
`/auth/*`, `/config`, `/hubs`, `/hubs/{id}`, `/hubs/{id}/key`, `/hubs/{id}/members`, `/system/*`

### Hub ID vs Hub Slug

The backend hub paths use the hub UUID: `/hubs/{hubId}/...`. The iOS codebase currently persists `activeHubSlug` (a string slug) in UserDefaults. This spec migrates iOS to track `activeHubId` (UUID) instead, which is what the backend path requires. The `isActive()` comparison in `HubRow` must be updated to compare against hub UUID rather than slug. The UserDefaults key changes from `"activeHubSlug"` to `"activeHubId"`.

---

## iOS Changes

### Active Hub State — `HubContext`

Rather than adding hub state to `AppState` (which owns `APIService` and would create a circular reference if `APIService` also read from `AppState`), introduce a lightweight `HubContext` observable object that both `AppState` and `APIService` receive independently via Hilt-equivalent SwiftUI environment injection:

```swift
@Observable
final class HubContext {
    // Plain stored var — @Observable does not support didSet on stored properties.
    // Persistence is handled explicitly in setActiveHub().
    private(set) var activeHubId: String?

    init() {
        self.activeHubId = UserDefaults.standard.string(forKey: "activeHubId")
    }

    func setActiveHub(_ hubId: String) {
        activeHubId = hubId
        UserDefaults.standard.setValue(hubId, forKey: "activeHubId")
    }
}
```

`HubContext` is created once in `LlamenosApp` as a `@State` property and passed into `AppState.init()` at construction time. `AppState` passes it into `APIService.init()` at its own construction. Both receive it via constructor injection — `APIService` cannot read from the SwiftUI environment because it is initialized before the view hierarchy exists. Views and ViewModels that are SwiftUI-managed receive it via `@Environment(HubContext.self)`. No circular dependency — `HubContext` depends on nothing.

### `APIService.swift`

Receive `HubContext` at construction. Add path helper:

```swift
func hp(_ path: String) -> String {
    guard let hubId = hubContext.activeHubId else { return path }
    return "/hubs/\(hubId)\(path)"
}
```

Audit all API methods. Hub-scoped paths wrap with `hp()`. Global paths remain unchanged.

### `HubManagementViewModel.swift`

`switchHub(to hub: Hub)` currently updates `activeHubSlug` in UserDefaults — local only, no API effect. Replace with a full switch:

```swift
func switchHub(to hub: Hub) {
    Task {
        isSwitching = true
        defer { isSwitching = false }
        do {
            // 1. Fetch hub key for new hub
            let envelope = try await apiService.getHubKey(hub.id)
            // 2. Unwrap via CryptoService (Rust FFI)
            try cryptoService.loadHubKey(hubId: hub.id, envelope: envelope)
            // 3. Update hub context — triggers @Observable tracking in all observing views
            hubContext.setActiveHub(hub.id)
        } catch {
            self.error = error
        }
    }
}
```

Update `isActive(hub:)` to compare `hub.id == hubContext.activeHubId` instead of `hub.slug == activeHubSlug`.

### Hub-Scoped View Refresh

Hub-scoped views (Dashboard, Notes, Cases, etc.) receive `HubContext` via `@Environment(HubContext.self)` and read `hubContext.activeHubId` in their body. SwiftUI's `@Observable` tracking re-renders the view automatically when `activeHubId` changes, which triggers the ViewModel's `load()` via `.task(id: hubContext.activeHubId)`. No `NotificationCenter` needed — `@Observable` is the single mechanism.

### Hub Key Cache — Security Note

`CryptoService` caches unwrapped hub keys in memory keyed by `hubId`. This cache **must be cleared on lock and logout**, alongside the nsec. Add `clearHubKeys()` to `CryptoService` and call it from `AppState.lockApp()` and `AppState.logout()`. This ensures no decrypted material persists in memory after the app locks.

### App Resume

On app launch: read `activeHubId` from UserDefaults via `HubContext`. If the persisted ID is not in the current hub list (membership changed), fall back to the first hub and call `switchHub(to:)` to load its key.

---

## Android Changes

### `ActiveHubState.kt` (new — breaks circular dependency)

Extract active hub tracking into a standalone `@Singleton` that neither `APIService` nor `HubRepository` owns:

```kotlin
@Singleton
class ActiveHubState @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val ACTIVE_HUB_KEY = stringPreferencesKey("activeHubId")

    val activeHubId: StateFlow<String?> = dataStore.data
        .map { it[ACTIVE_HUB_KEY] }
        .stateIn(scope, SharingStarted.Eagerly, null)

    suspend fun setActiveHub(hubId: String) {
        dataStore.edit { it[ACTIVE_HUB_KEY] = hubId }
    }
}
```

Both `APIService` and `HubRepository` inject `ActiveHubState`. No cycle.

### `APIService.kt`

Inject `ActiveHubState`. Add path helper:

```kotlin
fun hp(path: String): String {
    val hubId = activeHubState.activeHubId.value ?: return path
    return "/hubs/$hubId$path"
}
```

Audit all API methods. Hub-scoped suspend functions wrap their paths with `hp()`. Global paths remain unchanged. OkHttp base URL stays as the server base URL.

### `HubRepository.kt`

Inject both `ActiveHubState` and `APIService`. Hub switch logic:

```kotlin
suspend fun switchHub(hubId: String) {
    // 1. Fetch hub key before committing the switch
    val envelope = apiService.getHubKey(hubId)
    // 2. Unwrap via CryptoService (Rust JNI)
    cryptoService.loadHubKey(hubId, envelope)
    // 3. Persist new active hub — StateFlow emits automatically
    activeHubState.setActiveHub(hubId)
}

suspend fun loadInitialHub() {
    if (activeHubState.activeHubId.value != null) return
    val hubs = apiService.listHubs()
    hubs.firstOrNull()?.id?.let { switchHub(it) }
}
```

### `HubManagementViewModel.kt`

`switchHub(hub: Hub)` currently updates local `_state` only. Replace with:

```kotlin
fun switchHub(hub: Hub) {
    viewModelScope.launch {
        _state.update { it.copy(isSwitching = true) }
        runCatching { hubRepository.switchHub(hub.id) }
            .onFailure { e -> _state.update { it.copy(error = e.message) } }
        _state.update { it.copy(isSwitching = false) }
    }
}
```

Remove `activeHubId` from `HubListState` entirely — it is no longer local state. Instead, expose it as a separate `StateFlow<String?>` on the ViewModel, derived directly from `ActiveHubState`:

```kotlin
val activeHubId: StateFlow<String?> = activeHubState.activeHubId
    .stateIn(viewModelScope, SharingStarted.Eagerly, null)
```

The `HubListScreen` collects this flow to render the active hub checkmark. This eliminates the stale-local-copy bug where two sources of truth could diverge.

### Hub-Scoped ViewModel Refresh

ViewModels for hub-scoped screens inject `ActiveHubState` and collect the flow:

```kotlin
activeHubState.activeHubId
    .distinctUntilChanged()
    .filterNotNull()
    .onEach { loadData() }
    .launchIn(viewModelScope)
```

### Hub Key Cache — Security Note

Android `CryptoService` caches unwrapped hub keys in memory. This cache **must be cleared on logout and when the app is locked** (biometric lock / PIN lock). Implement `CryptoService.clearHubKeys()` and call it from the auth ViewModel's logout and lock flows.

### `@ApplicationScope` CoroutineScope

`ActiveHubState` uses an `@ApplicationScope`-qualified `CoroutineScope` (application lifetime, not `GlobalScope`). This is provided via a Hilt module that already exists or must be added:

```kotlin
@Module @InstallIn(SingletonComponent::class)
object CoroutineScopeModule {
    @ApplicationScope
    @Provides @Singleton
    fun provideApplicationScope(): CoroutineScope =
        CoroutineScope(SupervisorJob() + Dispatchers.Default)
}
```

---

## Hub Key Handling

The hub key is a random 32-byte symmetric key, ECIES-wrapped individually for each hub member. On hub switch:

1. `GET /hubs/{hubId}/key` — returns the caller's ECIES-wrapped envelope
2. Unwrap with user's nsec via `CryptoService` (Rust FFI)
3. Cache unwrapped key in-memory in `CryptoService`, keyed by `hubId`
4. All subsequent encryption/decryption uses the cached key for the active hub

**Key fetch before commit:** The hub key is fetched and successfully unwrapped *before* `activeHubId` is updated. If key fetch fails, the switch is aborted — the user stays in their previous hub with no partial state.

**Cache eviction:** Hub key cache is cleared on lock, logout, and app termination. Keys are never written to disk.

---

## UX During Switch

1. User taps a hub row in the hub management screen
2. Row shows activity indicator (`isSwitching = true`)
3. Hub key is fetched and unwrapped (< 500ms on good connection)
4. `activeHubId` updates — all hub-scoped views observe and reload
5. Active hub indicator (checkmark) moves to the new hub

No full app restart. No re-authentication. The switch is in-session.

---

## Error Handling

| Failure | Behavior |
|---|---|
| Key fetch network error | Error alert shown, `activeHubId` not updated, user stays in previous hub |
| Key unwrap failure | Error alert — indicates server-side key distribution problem; switch aborted |
| Hub no longer in membership list on resume | Fall back to first available hub |
| No hubs available | Empty state with contact admin prompt |

---

## Testing Implications

Once hub switching is properly implemented on mobile:

**iOS XCUITest:** Tests that use `launchWithAPI()` can switch hubs via the hub management UI or via a launch argument processed by the app:

```swift
app.launchArguments.append(contentsOf: ["--test-hub-id", hubId])
```

This allows `BaseUITest` subclasses to direct the app to a specific test hub created via the API before launch — eliminating the need for `resetServerState()` for isolation. Full details of this isolation pattern are specified in the test infrastructure overhaul spec (spec 2).

**Android Cucumber:** Hub isolation for Android E2E tests requires the test harness to create a hub via API and configure the app to use it before each scenario. Because `ScenarioHooks.@Before` runs before the Activity is launched, this is implemented via a test-only API endpoint (not a UI-driven hub switch). The mechanism is specified in the test infrastructure overhaul spec (spec 2). This spec is the prerequisite — the app must support hub switching for that isolation model to work.

---

## Success Criteria

- iOS: tapping a hub in `HubManagementView` calls `switchHub(to:)` on the ViewModel, which fetches the hub key, updates `HubContext.activeHubId`, and all subsequent API calls use `/hubs/{newHubId}/` prefixes
- Android: `HubRepository.switchHub()` fetches hub key, persists new hub ID via `ActiveHubState`, all hub-scoped API calls use `hp()` with the new ID
- Multi-hub users can switch between their hubs and see correct, isolated data on both platforms
- Active hub persists across app backgrounding and foreground resume
- Hub key fetch failure aborts the switch and leaves the user in their previous hub
- Hub key cache is cleared on lock and logout on both platforms; verified by a unit test that calls `lock()` / `logout()` and asserts `cryptoService.hubKeyCount == 0`
- Zero regressions for single-hub users (fall back to first hub if no persisted selection)
- iOS active hub comparison uses hub UUID (not slug); `isActive()` updated accordingly
