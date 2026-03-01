import SwiftUI

/// Main dashboard screen shown after successful authentication. Displays the
/// volunteer's identity (truncated npub), shift status, active calls count,
/// recent notes count, hub connection status, and lock/logout actions.
struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @Environment(Router.self) private var router
    @State private var viewModel: DashboardViewModel?

    var body: some View {
        let vm = resolvedViewModel

        ScrollView {
            VStack(spacing: 24) {
                // Identity card
                VStack(spacing: 16) {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)

                    if let npub = appState.cryptoService.npub {
                        VStack(spacing: 4) {
                            Text(NSLocalizedString("dashboard_identity_label", comment: "Your Identity"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)

                            Text(truncatedNpub(npub))
                                .font(.system(.body, design: .monospaced))
                                .foregroundStyle(.primary)
                                .accessibilityIdentifier("dashboard-npub")
                        }
                    }
                }
                .padding(.top, 24)

                // Shift status card
                VStack(spacing: 12) {
                    HStack {
                        Image(systemName: "clock.badge.checkmark")
                            .font(.title3)
                            .foregroundStyle(.green)

                        Text(NSLocalizedString("dashboard_shift_status", comment: "Shift Status"))
                            .font(.headline)

                        Spacer()

                        shiftStatusBadge(vm.shiftStatus)
                    }

                    HStack {
                        Circle()
                            .fill(vm.isOnShift ? Color.green : Color.secondary.opacity(0.3))
                            .frame(width: 10, height: 10)

                        Text(vm.isOnShift
                            ? NSLocalizedString("dashboard_on_shift", comment: "On Shift")
                            : NSLocalizedString("dashboard_off_shift", comment: "Off Shift")
                        )
                        .font(.subheadline)
                        .foregroundStyle(vm.isOnShift ? .primary : .secondary)
                        .accessibilityIdentifier("shift-status-text")

                        Spacer()
                    }
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.systemGray6))
                )
                .accessibilityIdentifier("shift-status-card")

                // Active calls card
                VStack(spacing: 12) {
                    HStack {
                        Image(systemName: "phone.arrow.down.left")
                            .font(.title3)
                            .foregroundStyle(.blue)

                        Text(NSLocalizedString("dashboard_active_calls", comment: "Active Calls"))
                            .font(.headline)

                        Spacer()

                        Text("\(vm.activeCallCount)")
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundStyle(.blue)
                            .accessibilityIdentifier("active-call-count")
                    }

                    if vm.activeCallCount == 0 {
                        Text(NSLocalizedString("dashboard_no_active_calls", comment: "No active calls"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.systemGray6))
                )
                .accessibilityIdentifier("active-calls-card")

                // Recent notes card
                VStack(spacing: 12) {
                    HStack {
                        Image(systemName: "note.text")
                            .font(.title3)
                            .foregroundStyle(.orange)

                        Text(NSLocalizedString("dashboard_recent_notes", comment: "Recent Notes"))
                            .font(.headline)

                        Spacer()

                        Text("\(vm.recentNoteCount)")
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("recent-note-count")
                    }

                    if vm.recentNoteCount == 0 {
                        Text(NSLocalizedString("dashboard_no_notes", comment: "No notes yet"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.systemGray6))
                )
                .accessibilityIdentifier("recent-notes-card")

                // Hub connection info
                if let hubURL = appState.authService.hubURL {
                    HStack(spacing: 8) {
                        Image(systemName: "link")
                            .foregroundStyle(.secondary)
                        Text(hubURL)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .accessibilityIdentifier("dashboard-hub-url")
                }

                // Error message
                if let error = vm.errorMessage {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.orange.opacity(0.1))
                    )
                    .accessibilityIdentifier("dashboard-error")
                }

                // Lock and logout actions
                VStack(spacing: 12) {
                    Button {
                        appState.lockApp()
                    } label: {
                        Label(
                            NSLocalizedString("dashboard_lock", comment: "Lock App"),
                            systemImage: "lock.fill"
                        )
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("lock-app")

                    Button(role: .destructive) {
                        vm.showLogoutConfirmation = true
                    } label: {
                        Label(
                            NSLocalizedString("dashboard_logout", comment: "Logout"),
                            systemImage: "rectangle.portrait.and.arrow.right"
                        )
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("logout")
                }

                Spacer(minLength: 40)
            }
            .padding(.horizontal, 24)
        }
        .navigationTitle(NSLocalizedString("dashboard_title", comment: "Dashboard"))
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden()
        .accessibilityIdentifier("dashboard-title")
        .refreshable {
            await vm.refresh()
        }
        .task {
            await vm.loadDashboard()
        }
        .alert(
            NSLocalizedString("logout_confirm_title", comment: "Logout"),
            isPresented: Binding(
                get: { vm.showLogoutConfirmation },
                set: { vm.showLogoutConfirmation = $0 }
            )
        ) {
            Button(NSLocalizedString("cancel", comment: "Cancel"), role: .cancel) {}
            Button(NSLocalizedString("logout_confirm_action", comment: "Logout"), role: .destructive) {
                appState.didLogout()
            }
        } message: {
            Text(NSLocalizedString(
                "logout_confirm_message",
                comment: "This will remove your identity from this device. Make sure you have backed up your secret key."
            ))
        }
    }

    // MARK: - Shift Status Badge

    @ViewBuilder
    private func shiftStatusBadge(_ status: ShiftStatus) -> some View {
        switch status {
        case .onShift:
            Text(NSLocalizedString("badge_on_shift", comment: "On Shift"))
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.green)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(Color.green.opacity(0.15)))
        case .onCall:
            Text(NSLocalizedString("badge_on_call", comment: "On Call"))
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.blue)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(Color.blue.opacity(0.15)))
        case .offShift:
            Text(NSLocalizedString("badge_off_shift", comment: "Off Shift"))
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(Color(.systemGray5)))
        case .loading:
            ProgressView()
                .scaleEffect(0.7)
        case .error:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
        }
    }

    // MARK: - Helpers

    private func truncatedNpub(_ npub: String) -> String {
        guard npub.count > 20 else { return npub }
        let prefix = npub.prefix(12)
        let suffix = npub.suffix(6)
        return "\(prefix)...\(suffix)"
    }

    // MARK: - ViewModel Resolution

    private var resolvedViewModel: DashboardViewModel {
        if let vm = viewModel {
            return vm
        }
        let vm = DashboardViewModel(apiService: appState.apiService)
        DispatchQueue.main.async {
            self.viewModel = vm
        }
        return vm
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Dashboard - Off Shift") {
    NavigationStack {
        DashboardView()
            .environment(AppState())
            .environment(Router())
    }
}
#endif
