import SwiftUI

// MARK: - SettingsView

/// Settings tab showing identity info, hub connection details, lock/logout actions,
/// and app version.
struct SettingsView: View {
    @Environment(AppState.self) private var appState

    @State private var showLogoutConfirmation: Bool = false
    @State private var showCopyConfirmation: Bool = false

    var body: some View {
        NavigationStack {
            List {
                // Identity section
                identitySection

                // Hub connection section
                hubSection

                // WebSocket connection section
                connectionSection

                // Actions section
                actionsSection

                // App info section
                appInfoSection
            }
            .navigationTitle(NSLocalizedString("settings_title", comment: "Settings"))
            .navigationBarTitleDisplayMode(.large)
            .alert(
                NSLocalizedString("logout_confirm_title", comment: "Logout"),
                isPresented: $showLogoutConfirmation
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
            .overlay(alignment: .bottom) {
                if showCopyConfirmation {
                    copyConfirmationBanner
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
    }

    // MARK: - Identity Section

    private var identitySection: some View {
        Section {
            if let npub = appState.cryptoService.npub {
                LabeledContent {
                    HStack(spacing: 8) {
                        Text(truncatedNpub(npub))
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        Button {
                            UIPasteboard.general.string = npub
                            showCopyFeedback()
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                                .foregroundStyle(.tint)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("copy-npub")
                        .accessibilityLabel(NSLocalizedString("settings_copy_npub", comment: "Copy npub"))
                    }
                } label: {
                    Label {
                        Text(NSLocalizedString("settings_npub", comment: "Public Key"))
                    } icon: {
                        Image(systemName: "key.horizontal.fill")
                            .foregroundStyle(.tint)
                    }
                }
                .accessibilityIdentifier("settings-npub")
            }

            if let pubkey = appState.cryptoService.pubkey {
                LabeledContent {
                    HStack(spacing: 8) {
                        Text(truncatedPubkey(pubkey))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)

                        Button {
                            UIPasteboard.general.string = pubkey
                            showCopyFeedback()
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("copy-pubkey")
                    }
                } label: {
                    Label {
                        Text(NSLocalizedString("settings_pubkey", comment: "Hex Pubkey"))
                    } icon: {
                        Image(systemName: "number")
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("settings-pubkey")
            }
        } header: {
            Text(NSLocalizedString("settings_identity_header", comment: "Identity"))
        }
    }

    // MARK: - Hub Section

    private var hubSection: some View {
        Section {
            if let hubURL = appState.authService.hubURL {
                LabeledContent {
                    Text(hubURL)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } label: {
                    Label {
                        Text(NSLocalizedString("settings_hub_url", comment: "Hub URL"))
                    } icon: {
                        Image(systemName: "link")
                            .foregroundStyle(.blue)
                    }
                }
                .accessibilityIdentifier("settings-hub-url")
            } else {
                LabeledContent {
                    Text(NSLocalizedString("settings_not_configured", comment: "Not configured"))
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                } label: {
                    Label {
                        Text(NSLocalizedString("settings_hub_url", comment: "Hub URL"))
                    } icon: {
                        Image(systemName: "link")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text(NSLocalizedString("settings_hub_header", comment: "Hub"))
        }
    }

    // MARK: - Connection Section

    private var connectionSection: some View {
        Section {
            LabeledContent {
                HStack(spacing: 6) {
                    Circle()
                        .fill(connectionColor)
                        .frame(width: 8, height: 8)
                    Text(appState.webSocketService.connectionState.displayText)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                }
            } label: {
                Label {
                    Text(NSLocalizedString("settings_connection", comment: "Relay Connection"))
                } icon: {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(.purple)
                }
            }
            .accessibilityIdentifier("settings-connection")

            LabeledContent {
                Text("\(appState.webSocketService.eventCount)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            } label: {
                Label {
                    Text(NSLocalizedString("settings_events", comment: "Events Received"))
                } icon: {
                    Image(systemName: "arrow.down.circle")
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            Text(NSLocalizedString("settings_connection_header", comment: "Connection"))
        }
    }

    // MARK: - Actions Section

    private var actionsSection: some View {
        Section {
            Button {
                appState.lockApp()
            } label: {
                Label {
                    Text(NSLocalizedString("settings_lock", comment: "Lock App"))
                        .foregroundStyle(.primary)
                } icon: {
                    Image(systemName: "lock.fill")
                        .foregroundStyle(.orange)
                }
            }
            .accessibilityIdentifier("settings-lock-app")

            Button(role: .destructive) {
                showLogoutConfirmation = true
            } label: {
                Label {
                    Text(NSLocalizedString("settings_logout", comment: "Logout"))
                } icon: {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .foregroundStyle(.red)
                }
            }
            .accessibilityIdentifier("settings-logout")
        } header: {
            Text(NSLocalizedString("settings_actions_header", comment: "Actions"))
        }
    }

    // MARK: - App Info Section

    private var appInfoSection: some View {
        Section {
            LabeledContent {
                Text(appVersion)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } label: {
                Label {
                    Text(NSLocalizedString("settings_version", comment: "Version"))
                } icon: {
                    Image(systemName: "info.circle")
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityIdentifier("settings-version")

            LabeledContent {
                Text(buildNumber)
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            } label: {
                Label {
                    Text(NSLocalizedString("settings_build", comment: "Build"))
                } icon: {
                    Image(systemName: "hammer")
                        .foregroundStyle(.tertiary)
                }
            }
        } header: {
            Text(NSLocalizedString("settings_about_header", comment: "About"))
        } footer: {
            Text(NSLocalizedString("settings_footer", comment: "Llamenos - Secure Crisis Response"))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
        }
    }

    // MARK: - Copy Confirmation

    private var copyConfirmationBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text(NSLocalizedString("copied_to_clipboard", comment: "Copied to clipboard"))
                .font(.subheadline)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(
            Capsule()
                .fill(.ultraThinMaterial)
                .shadow(radius: 8)
        )
        .padding(.bottom, 16)
        .accessibilityIdentifier("copy-confirmation")
    }

    // MARK: - Helpers

    private var connectionColor: Color {
        switch appState.webSocketService.connectionState {
        case .connected: return .green
        case .connecting, .reconnecting: return .yellow
        case .disconnected: return .red
        }
    }

    private func truncatedNpub(_ npub: String) -> String {
        guard npub.count > 20 else { return npub }
        return "\(npub.prefix(12))...\(npub.suffix(6))"
    }

    private func truncatedPubkey(_ pubkey: String) -> String {
        guard pubkey.count > 16 else { return pubkey }
        return "\(pubkey.prefix(8))...\(pubkey.suffix(6))"
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    private func showCopyFeedback() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)

        withAnimation(.easeInOut(duration: 0.3)) {
            showCopyConfirmation = true
        }

        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.easeInOut(duration: 0.3)) {
                showCopyConfirmation = false
            }
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Settings") {
    SettingsView()
        .environment(AppState())
}
#endif
