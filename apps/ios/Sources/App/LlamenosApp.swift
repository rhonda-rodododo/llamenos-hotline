import SwiftUI

/// The main entry point for the Llamenos iOS app. Manages the app lifecycle,
/// injects the root `AppState` into the environment, and handles background
/// lock timeout (5 minutes).
@main
struct LlamenosApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var appState = AppState()
    @State private var router = Router()
    @State private var backgroundTimestamp: Date?

    /// Time in seconds before the app locks after entering background.
    /// 5 minutes — balances security with usability for volunteers mid-shift.
    private let lockTimeout: TimeInterval = 300

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .environment(router)
                .onChange(of: scenePhase) { oldPhase, newPhase in
                    handleScenePhaseChange(from: oldPhase, to: newPhase)
                }
                .onChange(of: appState.authStatus) { _, newStatus in
                    router.resetForAuthStatus(newStatus)
                }
        }
    }

    // MARK: - Scene Phase Handling

    private func handleScenePhaseChange(from oldPhase: ScenePhase, to newPhase: ScenePhase) {
        switch newPhase {
        case .background:
            // Record when the app entered background for lock timeout calculation
            backgroundTimestamp = Date()

        case .active:
            // Check if the lock timeout has elapsed while in background
            if let timestamp = backgroundTimestamp {
                let elapsed = Date().timeIntervalSince(timestamp)
                if elapsed > lockTimeout && appState.authStatus == .unlocked {
                    appState.lockApp()
                }
            }
            backgroundTimestamp = nil

        case .inactive:
            // Transitional state (e.g., app switcher) — no action needed
            break

        @unknown default:
            break
        }
    }
}
