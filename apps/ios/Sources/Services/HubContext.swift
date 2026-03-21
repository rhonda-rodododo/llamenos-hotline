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
        if UserDefaults.standard.string(forKey: "activeHubSlug") != nil,
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
