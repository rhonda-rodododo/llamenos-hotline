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

---

## iOS Changes

### `AppState.swift`

Add `@Published var activeHubId: String?` backed by UserDefaults persistence (it is a preference, not a secret — Keychain is not required).

```swift
var activeHubId: String? {
    get { UserDefaults.standard.string(forKey: "activeHubId") }
    set {
        UserDefaults.standard.setValue(newValue, forKey: "activeHubId")
        objectWillChange.send()
    }
}
```

Add `func switchHub(to hubId: String) async throws`:
1. Update `activeHubId`
2. Call `apiService.hp()` is now valid for the new hub
3. Fetch hub key: `GET /hubs/{hubId}/key`
4. Unwrap ECIES envelope via `CryptoService.unwrapHubKey(envelope:)`
5. Store unwrapped hub key in `CryptoService` in-memory cache keyed by `hubId`
6. Post `Notification.Name.activeHubDidChange` so hub-scoped views reload

On app launch / resume: read persisted `activeHubId` from UserDefaults. If nil or hub no longer in list, fall back to first hub from `GET /api/hubs`.

### `APIService.swift`

Add a reference to `AppState` (constructor-injected or via environment).

Add path helper:

```swift
func hp(_ path: String) -> String {
    guard let hubId = appState.activeHubId else { return path }
    return "/hubs/\(hubId)\(path)"
}
```

Audit all API methods. Wrap hub-scoped paths with `hp()`. Global paths remain unchanged. The OkHttp base URL is the server base URL — hub context comes from path prefixes only.

### `HubManagementView.swift`

`switchHub(to hub: Hub)` currently updates a local `@State` variable. Replace with:

```swift
func switchHub(to hub: Hub) {
    Task {
        isSwitching = true
        defer { isSwitching = false }
        do {
            try await appState.switchHub(to: hub.id)
        } catch {
            self.error = error
        }
    }
}
```

The active hub checkmark indicator already uses `activeHubId` comparison — no UI change needed beyond wiring the action.

### Hub-Scoped View Refresh

Hub-scoped views (Dashboard, Notes, Cases, etc.) observe `AppState.activeHubId` and re-fetch their data when it changes. Use `.onReceive(NotificationCenter.default.publisher(for: .activeHubDidChange))` or observe `appState.$activeHubId` directly via `.onChange(of:)` in SwiftUI.

---

## Android Changes

### `HubRepository.kt`

Extend existing hub repository (or create if it does not exist as a standalone class) to own the active hub context:

```kotlin
@Singleton
class HubRepository @Inject constructor(
    private val apiService: APIService,
    private val dataStore: DataStore<Preferences>,
    private val cryptoService: CryptoService,
) {
    private val ACTIVE_HUB_KEY = stringPreferencesKey("activeHubId")

    val activeHubId: StateFlow<String?> = dataStore.data
        .map { it[ACTIVE_HUB_KEY] }
        .stateIn(scope, SharingStarted.Eagerly, null)

    suspend fun switchHub(hubId: String) {
        // 1. Persist selection
        dataStore.edit { it[ACTIVE_HUB_KEY] = hubId }
        // 2. Fetch + unwrap hub key
        val envelope = apiService.getHubKey(hubId)
        cryptoService.loadHubKey(hubId, envelope)
        // 3. StateFlow emits automatically via dataStore.data collection
    }

    suspend fun loadInitialHub() {
        val persisted = dataStore.data.first()[ACTIVE_HUB_KEY]
        if (persisted != null) return
        // Fall back to first hub from API
        val hubs = apiService.listHubs()
        hubs.firstOrNull()?.id?.let { switchHub(it) }
    }
}
```

### `APIService.kt`

Inject `HubRepository`. Add hub path helper:

```kotlin
fun hp(path: String): String {
    val hubId = hubRepository.activeHubId.value ?: return path
    return "/hubs/$hubId$path"
}
```

Audit all API methods. Hub-scoped suspend functions wrap their paths with `hp()`. Global paths remain unchanged. OkHttp base URL remains the server base URL.

### `HubManagementViewModel.kt`

`switchHub(hub: Hub)` currently updates `_state.update { it.copy(activeHubId = hub.id) }` — local state only. Replace with:

```kotlin
fun switchHub(hub: Hub) {
    viewModelScope.launch {
        _state.update { it.copy(isSwitching = true) }
        try {
            hubRepository.switchHub(hub.id)
        } catch (e: Exception) {
            _state.update { it.copy(error = e.message, isSwitching = false) }
        } finally {
            _state.update { it.copy(isSwitching = false) }
        }
    }
}
```

### Hub-Scoped ViewModel Refresh

ViewModels for hub-scoped screens collect `hubRepository.activeHubId` and re-fetch when it changes:

```kotlin
hubRepository.activeHubId
    .distinctUntilChanged()
    .onEach { loadData() }
    .launchIn(viewModelScope)
```

---

## Hub Key Handling

The hub key is a random 32-byte symmetric key, ECIES-wrapped individually for each hub member. The server stores one envelope per member per hub. On hub switch:

1. `GET /hubs/{hubId}/key` — returns the caller's ECIES-wrapped envelope
2. Unwrap with user's nsec via `CryptoService` (Rust FFI on both platforms)
3. Cache unwrapped key in-memory in `CryptoService`, keyed by `hubId`
4. All subsequent encryption/decryption for notes, records, messages uses the cached key for the active hub

If key fetch fails (network error, key not yet distributed): surface an error, revert `activeHubId` to the previous value. Do not leave the user in a half-switched state.

---

## UX During Switch

1. User taps a hub row in the hub management screen
2. Row shows an activity indicator (`isSwitching = true`)
3. Hub key is fetched and unwrapped (typically < 500ms on a good connection)
4. `activeHubId` updates — all hub-scoped views observe this and trigger a reload
5. Loading state resolves, user sees data for the new hub
6. Active hub checkmark moves to the newly selected hub

No full app restart. No re-authentication. The switch is in-session and instant once the key is unwrapped.

---

## Error Handling

| Failure | Behavior |
|---|---|
| Key fetch network error | Show error alert, revert `activeHubId`, user stays in previous hub |
| Key unwrap failure (wrong key, corrupt envelope) | Show error alert, revert — this indicates a server-side key distribution problem |
| Hub no longer in membership list | Fall back to first available hub on app resume |
| No hubs available | Show empty state with contact admin prompt |

---

## Testing Implications

Once hub switching is properly implemented on mobile:

- iOS XCUITests can call `app.launchArguments.append("--test-hub-id", hubId)` or switch hub via UI after `launchWithAPI()` — each test class creates its own hub via the API, switches to it, and runs in isolation without `resetServerState()`
- Android Cucumber `ScenarioHooks` can replace `resetServerState()` with hub creation + switch per scenario, achieving isolation without serial execution
- This unblocks the test infrastructure overhaul spec (spec 2), which builds hub-per-worker isolation on top of this capability

---

## Success Criteria

- iOS: tapping a hub in `HubManagementView` switches `activeHubId`, all subsequent API calls use `/hubs/{newHubId}/` prefixes, hub key is loaded, hub-scoped views reload
- Android: same via `HubRepository.switchHub()`, all hub-scoped API calls use `hp()`, `HubListScreen` reflects new active hub
- Multi-hub users can switch between their hubs and see correct data on both mobile platforms
- Active hub persists across app backgrounding and foreground resume
- Hub key is fetched on every switch; errors revert the switch cleanly
- Zero regressions on single-hub users (fall back to first hub if no persisted selection)
