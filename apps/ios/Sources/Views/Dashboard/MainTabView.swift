import SwiftUI

// MARK: - Tab

/// Tabs in the main authenticated view.
enum Tab: String, CaseIterable, Sendable {
    case dashboard
    case notes
    case shifts
    case settings

    var title: String {
        switch self {
        case .dashboard: return NSLocalizedString("tab_dashboard", comment: "Dashboard")
        case .notes: return NSLocalizedString("tab_notes", comment: "Notes")
        case .shifts: return NSLocalizedString("tab_shifts", comment: "Shifts")
        case .settings: return NSLocalizedString("tab_settings", comment: "Settings")
        }
    }

    var icon: String {
        switch self {
        case .dashboard: return "house.fill"
        case .notes: return "note.text"
        case .shifts: return "calendar"
        case .settings: return "gearshape"
        }
    }
}

// MARK: - MainTabView

/// The primary authenticated experience. Contains a `TabView` with four tabs:
/// Dashboard, Notes, Shifts, and Settings. Shown when `authStatus == .unlocked`.
///
/// Each tab has its own `NavigationStack` so navigation state is preserved
/// when switching between tabs.
struct MainTabView: View {
    @Environment(AppState.self) private var appState
    @Environment(Router.self) private var router
    @State private var selectedTab: Tab = .dashboard

    var body: some View {
        TabView(selection: $selectedTab) {
            // Dashboard
            DashboardView()
                .tabItem {
                    Label(Tab.dashboard.title, systemImage: Tab.dashboard.icon)
                }
                .tag(Tab.dashboard)
                .accessibilityIdentifier("tab-dashboard")

            // Notes
            NotesView()
                .tabItem {
                    Label(Tab.notes.title, systemImage: Tab.notes.icon)
                }
                .tag(Tab.notes)
                .accessibilityIdentifier("tab-notes")

            // Shifts
            ShiftsView()
                .tabItem {
                    Label(Tab.shifts.title, systemImage: Tab.shifts.icon)
                }
                .tag(Tab.shifts)
                .accessibilityIdentifier("tab-shifts")

            // Settings
            SettingsView()
                .tabItem {
                    Label(Tab.settings.title, systemImage: Tab.settings.icon)
                }
                .tag(Tab.settings)
                .accessibilityIdentifier("tab-settings")
        }
        .accessibilityIdentifier("main-tab-view")
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Main Tab View") {
    MainTabView()
        .environment(AppState())
        .environment(Router())
}
#endif
