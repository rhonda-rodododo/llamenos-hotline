import Foundation

// MARK: - AuthStatus

/// Top-level authentication state for the app.
enum AuthStatus: Equatable {
    /// No identity exists — show login/onboarding.
    case unauthenticated
    /// Identity exists but is locked — show PIN unlock.
    case locked
    /// Identity is loaded and nsec is in memory — show dashboard.
    case unlocked
}

// MARK: - AppState

/// Root observable state container for the entire app. Holds all service instances
/// and the current auth status. Injected into the SwiftUI environment at the app root.
@Observable
final class AppState {
    // MARK: - Services

    let cryptoService: CryptoService
    let keychainService: KeychainService
    let apiService: APIService
    let authService: AuthService

    // MARK: - Auth State

    /// Current authentication status, drives top-level navigation.
    var authStatus: AuthStatus = .unauthenticated

    /// Whether the app is currently locked (background timeout or manual lock).
    /// Distinct from authStatus == .locked because it tracks the explicit "needs re-auth" state.
    var isLocked: Bool = false

    // MARK: - Initialization

    init() {
        let crypto = CryptoService()
        let keychain = KeychainService()
        let api = APIService(cryptoService: crypto)
        let auth = AuthService(cryptoService: crypto, keychainService: keychain)

        self.cryptoService = crypto
        self.keychainService = keychain
        self.apiService = api
        self.authService = auth

        // Configure API base URL if stored
        if let hubURL = auth.hubURL {
            try? api.configure(hubURLString: hubURL)
        }

        // Determine initial auth state
        resolveAuthStatus()
    }

    // MARK: - Auth Status Resolution

    /// Determine auth status from service state. Called on init and after state transitions.
    func resolveAuthStatus() {
        if cryptoService.isUnlocked && !isLocked {
            authStatus = .unlocked
        } else if authService.hasStoredKeys {
            authStatus = .locked
        } else {
            authStatus = .unauthenticated
        }
    }

    // MARK: - Lock / Unlock

    /// Lock the app: clear nsec from memory, set locked state.
    func lockApp() {
        authService.lock()
        isLocked = true
        authStatus = .locked
    }

    /// Called after successful PIN/biometric unlock.
    func didUnlock() {
        isLocked = false
        authStatus = .unlocked
    }

    /// Called after successful onboarding (new identity or import + PIN set).
    func didCompleteOnboarding() {
        isLocked = false
        authStatus = .unlocked

        // Configure API with the stored hub URL
        if let hubURL = authService.hubURL {
            try? apiService.configure(hubURLString: hubURL)
        }
    }

    /// Called when the user logs out / resets identity.
    func didLogout() {
        authService.logout()
        isLocked = false
        authStatus = .unauthenticated
    }
}
