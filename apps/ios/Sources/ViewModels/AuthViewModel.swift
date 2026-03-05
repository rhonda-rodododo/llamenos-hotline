import Foundation

// MARK: - AuthStep

/// Steps in the login/onboarding flow.
enum AuthStep: Equatable {
    /// Initial login screen.
    case login
    /// User is entering an nsec to import.
    case importingKey
    /// User is viewing their generated nsec for backup.
    case showingNsec(nsec: String, npub: String)
    /// User is setting their PIN.
    case settingPIN
    /// Complete — ready to proceed to dashboard.
    case complete
}

// MARK: - AuthViewModel

/// View model for the login and onboarding flow. Manages the state machine for
/// identity creation, nsec import, and hub URL configuration. PIN handling is
/// delegated to PINViewModel.
@Observable
final class AuthViewModel {
    private let authService: AuthService
    private let apiService: APIService

    /// Current step in the auth flow.
    var currentStep: AuthStep = .login

    /// Hub URL text field value.
    var hubURL: String = ""

    /// Nsec text field value for import flow.
    var nsecInput: String = ""

    /// Error to display to the user.
    var errorMessage: String?

    /// Whether an async operation is in progress.
    var isLoading: Bool = false

    /// The generated nsec (for display during onboarding).
    /// Set only during the onboarding flow and cleared after PIN set.
    private(set) var generatedNsec: String?
    private(set) var generatedNpub: String?

    init(authService: AuthService, apiService: APIService) {
        self.authService = authService
        self.apiService = apiService
        self.hubURL = authService.hubURL ?? ""
    }

    // MARK: - Create New Identity

    /// Generate a new keypair and show the nsec for backup confirmation.
    func createNewIdentity() {
        errorMessage = nil

        // Validate hub URL first
        guard validateAndStoreHubURL() else { return }

        let (nsec, npub) = authService.createNewIdentity()
        generatedNsec = nsec
        generatedNpub = npub
        currentStep = .showingNsec(nsec: nsec, npub: npub)
    }

    /// User has confirmed they backed up their nsec. Proceed to PIN set.
    func confirmBackup() {
        currentStep = .settingPIN
    }

    // MARK: - Import Existing Key

    /// Begin the nsec import flow.
    func startImport() {
        errorMessage = nil
        currentStep = .importingKey
    }

    /// Submit the imported nsec.
    /// M27: Clears nsecInput from memory on successful import to prevent
    /// the sensitive key material from lingering in view model state.
    func submitImport() {
        errorMessage = nil

        // Validate hub URL
        guard validateAndStoreHubURL() else { return }

        let trimmed = nsecInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = NSLocalizedString("error_nsec_empty", comment: "Please enter your nsec key")
            return
        }

        do {
            try authService.importExistingIdentity(nsec: trimmed)
            // M27: Clear nsecInput after successful import — don't leave sensitive
            // key material in the view model's observable state.
            nsecInput = ""
            currentStep = .settingPIN
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Cancel the import and return to login.
    func cancelImport() {
        nsecInput = ""
        errorMessage = nil
        currentStep = .login
    }

    // MARK: - Hub URL

    /// Validate and persist the hub URL.
    /// Returns true if valid, false if invalid (sets errorMessage).
    @discardableResult
    private func validateAndStoreHubURL() -> Bool {
        let trimmed = hubURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = NSLocalizedString("error_hub_url_empty", comment: "Please enter the hub URL")
            return false
        }

        do {
            try authService.setHubURL(trimmed)
            try apiService.configure(hubURLString: trimmed)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    // MARK: - Reset

    /// Reset the view model to the initial login state.
    func reset() {
        currentStep = .login
        nsecInput = ""
        errorMessage = nil
        isLoading = false
        generatedNsec = nil
        generatedNpub = nil
    }

    /// Clear sensitive data (nsec display) after it's no longer needed.
    func clearSensitiveData() {
        generatedNsec = nil
        generatedNpub = nil
    }
}
