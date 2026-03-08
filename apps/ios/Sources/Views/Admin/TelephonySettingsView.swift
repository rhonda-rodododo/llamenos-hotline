import SwiftUI

// MARK: - TelephonySettingsView

/// Admin view for configuring the telephony provider. Allows selecting the provider
/// and entering credentials (Account SID, Auth Token, Phone Number).
struct TelephonySettingsView: View {
    @Bindable var viewModel: AdminViewModel

    var body: some View {
        Form {
            if viewModel.isLoadingTelephony {
                Section {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                }
            } else {
                providerSection
                credentialsSection
                saveSection

                if let error = viewModel.errorMessage {
                    Section {
                        Text(error)
                            .font(.brand(.footnote))
                            .foregroundStyle(Color.brandDestructive)
                    }
                }

                if let success = viewModel.successMessage {
                    Section {
                        Text(success)
                            .font(.brand(.footnote))
                            .foregroundStyle(.green)
                    }
                }
            }
        }
        .navigationTitle(NSLocalizedString("admin_telephony_settings", comment: "Telephony"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadTelephonySettings()
        }
        .accessibilityIdentifier("telephony-settings-view")
    }

    // MARK: - Provider Section

    private var providerSection: some View {
        Section {
            Picker(
                NSLocalizedString("admin_telephony_provider", comment: "Provider"),
                selection: Binding(
                    get: { viewModel.telephonySettings.telephonyProvider },
                    set: { viewModel.telephonySettings.telephonyProvider = $0 }
                )
            ) {
                ForEach(TelephonyProvider.allCases, id: \.self) { provider in
                    Text(provider.displayName)
                        .tag(provider)
                }
            }
            .accessibilityIdentifier("telephony-provider-picker")
        } header: {
            Text(NSLocalizedString("admin_telephony_provider_header", comment: "Voice Provider"))
        } footer: {
            Text(NSLocalizedString(
                "admin_telephony_provider_footer",
                comment: "Select the telephony provider for voice call routing."
            ))
            .font(.brand(.caption))
        }
    }

    // MARK: - Credentials Section

    private var credentialsSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(NSLocalizedString("admin_telephony_account_sid", comment: "Account SID"))
                    .font(.brand(.caption))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                TextField(
                    NSLocalizedString("admin_telephony_account_sid_placeholder", comment: "Enter account SID"),
                    text: Binding(
                        get: { viewModel.telephonySettings.accountSid },
                        set: { viewModel.telephonySettings.accountSid = $0 }
                    )
                )
                .font(.brandMono(.body))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("telephony-account-sid")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(NSLocalizedString("admin_telephony_auth_token", comment: "Auth Token"))
                    .font(.brand(.caption))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                SecureField(
                    NSLocalizedString("admin_telephony_auth_token_placeholder", comment: "Enter auth token"),
                    text: Binding(
                        get: { viewModel.telephonySettings.authToken },
                        set: { viewModel.telephonySettings.authToken = $0 }
                    )
                )
                .font(.brandMono(.body))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("telephony-auth-token")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(NSLocalizedString("admin_telephony_phone_number", comment: "Phone Number"))
                    .font(.brand(.caption))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                TextField(
                    NSLocalizedString("admin_telephony_phone_placeholder", comment: "+1234567890"),
                    text: Binding(
                        get: { viewModel.telephonySettings.phoneNumber },
                        set: { viewModel.telephonySettings.phoneNumber = $0 }
                    )
                )
                .font(.brandMono(.body))
                .keyboardType(.phonePad)
                .accessibilityIdentifier("telephony-phone-number")
            }
        } header: {
            Text(NSLocalizedString("admin_telephony_credentials_header", comment: "Credentials"))
        } footer: {
            Text(NSLocalizedString(
                "admin_telephony_credentials_footer",
                comment: "Credentials are encrypted at rest. Only admins can view or modify these settings."
            ))
            .font(.brand(.caption))
        }
    }

    // MARK: - Save Section

    private var saveSection: some View {
        Section {
            Button {
                Task { await viewModel.saveTelephonySettings() }
            } label: {
                HStack {
                    Spacer()
                    if viewModel.isSavingTelephony {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Text(NSLocalizedString("admin_save", comment: "Save"))
                            .fontWeight(.semibold)
                    }
                    Spacer()
                }
            }
            .disabled(viewModel.isSavingTelephony)
            .accessibilityIdentifier("telephony-save-button")
        }
    }
}
