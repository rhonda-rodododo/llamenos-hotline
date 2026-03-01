import Foundation

// MARK: - PINMode

/// The mode of the PIN pad: setting a new PIN or unlocking with an existing one.
enum PINMode: Equatable {
    /// User is creating a new PIN (enter + confirm).
    case set
    /// User is entering their PIN to unlock.
    case unlock
}

// MARK: - PINPhase

/// Sub-phases within PIN set mode.
enum PINPhase: Equatable {
    /// First entry of new PIN.
    case enter
    /// Confirming the new PIN matches.
    case confirm
}

// MARK: - PINViewModel

/// View model for PIN entry, both for setting a new PIN and unlocking with an existing one.
/// Handles the enter-then-confirm flow for new PINs, PIN validation, and error display.
@Observable
final class PINViewModel {
    private let authService: AuthService
    private let onSuccess: () -> Void

    /// Current mode (set or unlock).
    let mode: PINMode

    /// Current PIN digits entered by the user.
    var pin: String = ""

    /// PIN length (4-6 digits).
    let maxLength: Int

    /// For set mode: the phase within the set flow.
    var phase: PINPhase = .enter

    /// The first PIN entry (during set mode), used for confirmation comparison.
    private var firstEntry: String?

    /// Error message to display.
    var errorMessage: String?

    /// Whether an async operation is in progress (PIN verification).
    var isLoading: Bool = false

    /// Number of failed unlock attempts (for lockout / rate limiting).
    private(set) var failedAttempts: Int = 0

    /// Maximum unlock attempts before temporary lockout.
    private let maxAttempts: Int = 5

    /// Whether biometric unlock is available and enabled.
    var isBiometricAvailable: Bool {
        mode == .unlock && authService.isBiometricEnabled && BiometricPrompt.isAvailable
    }

    /// Title text for the current PIN entry state.
    var titleText: String {
        switch mode {
        case .set:
            switch phase {
            case .enter:
                return NSLocalizedString("pin_set_title", comment: "Create a PIN")
            case .confirm:
                return NSLocalizedString("pin_confirm_title", comment: "Confirm your PIN")
            }
        case .unlock:
            return NSLocalizedString("pin_unlock_title", comment: "Enter your PIN")
        }
    }

    /// Subtitle text providing additional context.
    var subtitleText: String {
        switch mode {
        case .set:
            switch phase {
            case .enter:
                return NSLocalizedString("pin_set_subtitle", comment: "Choose a 4-6 digit PIN to protect your key")
            case .confirm:
                return NSLocalizedString("pin_confirm_subtitle", comment: "Enter the same PIN again to confirm")
            }
        case .unlock:
            if failedAttempts > 0 {
                return String(
                    format: NSLocalizedString("pin_unlock_attempts", comment: "%d of %d attempts used"),
                    failedAttempts,
                    maxAttempts
                )
            }
            return NSLocalizedString("pin_unlock_subtitle", comment: "Enter your PIN to unlock")
        }
    }

    /// Whether the user is temporarily locked out due to too many failed attempts.
    var isLockedOut: Bool {
        failedAttempts >= maxAttempts
    }

    init(mode: PINMode, authService: AuthService, maxLength: Int = 4, onSuccess: @escaping () -> Void) {
        self.mode = mode
        self.authService = authService
        self.maxLength = maxLength
        self.onSuccess = onSuccess
    }

    // MARK: - PIN Completion

    /// Called when the user finishes entering a PIN (all digits entered).
    func onPINComplete(_ enteredPIN: String) {
        errorMessage = nil

        switch mode {
        case .set:
            handleSetPIN(enteredPIN)
        case .unlock:
            handleUnlockPIN(enteredPIN)
        }
    }

    // MARK: - Set PIN Flow

    private func handleSetPIN(_ enteredPIN: String) {
        switch phase {
        case .enter:
            // Validate PIN format
            do {
                try authService.validatePIN(enteredPIN)
            } catch {
                errorMessage = error.localizedDescription
                pin = ""
                return
            }

            // Store first entry and move to confirm phase
            firstEntry = enteredPIN
            pin = ""
            phase = .confirm

        case .confirm:
            guard let firstEntry else {
                errorMessage = NSLocalizedString("error_pin_internal", comment: "Internal error. Please try again.")
                resetToEnter()
                return
            }

            // Check PINs match
            guard enteredPIN == firstEntry else {
                errorMessage = NSLocalizedString("error_pin_mismatch", comment: "PINs do not match. Try again.")
                resetToEnter()
                return
            }

            // PINs match — complete onboarding with this PIN
            isLoading = true
            do {
                let enableBiometric = BiometricPrompt.isAvailable
                try authService.completeOnboarding(pin: enteredPIN, enableBiometric: enableBiometric)
                isLoading = false
                onSuccess()
            } catch {
                isLoading = false
                errorMessage = error.localizedDescription
                resetToEnter()
            }
        }
    }

    // MARK: - Unlock PIN Flow

    private func handleUnlockPIN(_ enteredPIN: String) {
        guard !isLockedOut else {
            errorMessage = NSLocalizedString("error_pin_locked_out", comment: "Too many attempts. Please wait.")
            return
        }

        isLoading = true
        do {
            try authService.unlockWithPIN(enteredPIN)
            isLoading = false
            failedAttempts = 0
            onSuccess()
        } catch {
            isLoading = false
            failedAttempts += 1
            pin = ""

            if isLockedOut {
                errorMessage = NSLocalizedString("error_pin_locked_out", comment: "Too many failed attempts. Please wait and try again.")
            } else {
                errorMessage = NSLocalizedString("error_pin_incorrect", comment: "Incorrect PIN. Please try again.")
            }
        }
    }

    // MARK: - Biometric Unlock

    /// Attempt biometric unlock. On success, loads the stored keys using the
    /// Keychain's biometric-protected access.
    func attemptBiometricUnlock() {
        guard isBiometricAvailable else { return }

        Task { @MainActor in
            let success = await BiometricPrompt.authenticate()
            guard success else { return }

            // After biometric auth, the Keychain item protected with .biometryCurrentSet
            // is accessible. We still need the PIN to decrypt the nsec though.
            // In a full implementation, the PIN would be stored in biometric-protected
            // Keychain. For now, biometric just confirms identity for the PIN prompt.
            // The actual unlock still requires PIN entry.
            //
            // Future: store a "biometric token" in biometric-protected Keychain that
            // can be used as a PIN equivalent for decryption.
        }
    }

    // MARK: - Reset

    /// Reset to the initial enter phase (after mismatch or error).
    private func resetToEnter() {
        firstEntry = nil
        pin = ""
        phase = .enter
    }

    /// Full reset of the view model.
    func reset() {
        pin = ""
        firstEntry = nil
        phase = .enter
        errorMessage = nil
        isLoading = false
        failedAttempts = 0
    }
}
