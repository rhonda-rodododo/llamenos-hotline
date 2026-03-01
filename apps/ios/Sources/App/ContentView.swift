import SwiftUI

/// Root view that switches between screens based on the current auth status.
/// Uses `NavigationStack` with the `Router` for push-based navigation within
/// each auth state (e.g., login -> onboarding -> PIN set).
///
/// When authenticated (`rootRoute == .dashboard`), shows the `MainTabView`
/// with four tabs: Dashboard, Notes, Shifts, Settings.
struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router

        NavigationStack(path: $router.path) {
            rootView
                .navigationDestination(for: Route.self) { route in
                    destinationView(for: route)
                }
        }
    }

    // MARK: - Root View

    /// The root view is determined by the router's `rootRoute`, which is synced
    /// to the `AppState.authStatus`.
    @ViewBuilder
    private var rootView: some View {
        switch router.rootRoute {
        case .login:
            LoginView()
        case .pinUnlock:
            PINUnlockView()
        case .dashboard:
            MainTabView()
                .navigationBarBackButtonHidden()
        default:
            // Fallback — should not occur in normal flow
            LoginView()
        }
    }

    // MARK: - Navigation Destinations

    /// Maps each `Route` to its corresponding SwiftUI view for push navigation.
    @ViewBuilder
    private func destinationView(for route: Route) -> some View {
        switch route {
        case .login:
            LoginView()
        case .onboarding(let nsec, let npub):
            OnboardingView(nsec: nsec, npub: npub)
        case .importKey:
            ImportKeyView()
        case .pinSet:
            PINSetView()
        case .pinUnlock:
            PINUnlockView()
        case .dashboard:
            MainTabView()
        case .noteDetail, .noteCreate:
            // These are handled within the Notes tab's own NavigationStack
            EmptyView()
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Content View - Unauthenticated") {
    let appState = AppState()
    let router = Router()
    router.resetForAuthStatus(.unauthenticated)
    return ContentView()
        .environment(appState)
        .environment(router)
}

#Preview("Content View - Locked") {
    let appState = AppState()
    let router = Router()
    router.resetForAuthStatus(.locked)
    return ContentView()
        .environment(appState)
        .environment(router)
}
#endif
