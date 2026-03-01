import Foundation

// MARK: - ShiftStatus

/// The volunteer's current shift status.
enum ShiftStatus: Equatable {
    /// Not currently on shift.
    case offShift
    /// On shift and available to receive calls.
    case onShift
    /// On shift but currently on a call.
    case onCall
    /// Loading shift status from the API.
    case loading
    /// Failed to load shift status.
    case error(String)

    var isOnShift: Bool {
        self == .onShift || self == .onCall
    }
}

// MARK: - DashboardViewModel

/// View model for the main dashboard. Loads shift status, displays the user's
/// identity (pubkey/npub), and provides lock/logout actions.
@Observable
final class DashboardViewModel {
    private let apiService: APIService

    /// Current shift status.
    var shiftStatus: ShiftStatus = .offShift

    /// Convenience: whether the volunteer is currently on shift.
    var isOnShift: Bool { shiftStatus.isOnShift }

    /// Number of active calls (loaded from API).
    var activeCallCount: Int = 0

    /// Number of recent notes (loaded from API).
    var recentNoteCount: Int = 0

    /// Whether the logout confirmation dialog is showing.
    var showLogoutConfirmation: Bool = false

    /// Whether the dashboard is currently loading data.
    var isLoading: Bool = false

    /// Error message from the last failed operation.
    var errorMessage: String?

    init(apiService: APIService) {
        self.apiService = apiService
    }

    // MARK: - Data Loading

    /// Load dashboard data from the API.
    func loadDashboard() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil

        // Attempt to fetch shift status from the API
        do {
            let status: ShiftStatusResponse = try await apiService.request(
                method: "GET",
                path: "/api/shifts/status"
            )
            shiftStatus = status.isOnShift ? .onShift : .offShift
            activeCallCount = status.activeCallCount ?? 0
            recentNoteCount = status.recentNoteCount ?? 0
        } catch {
            // On first launch or when hub is unreachable, show off-shift as default
            // rather than an error state, since the user may be setting up.
            shiftStatus = .offShift
            activeCallCount = 0
            recentNoteCount = 0
            if case APIError.noBaseURL = error {
                // Expected when hub isn't configured yet — no error display needed
            } else {
                errorMessage = error.localizedDescription
            }
        }

        isLoading = false
    }

    /// Refresh dashboard data.
    func refresh() async {
        isLoading = false
        await loadDashboard()
    }
}

// MARK: - API Response Types

/// Response from the shift status endpoint.
private struct ShiftStatusResponse: Decodable {
    let isOnShift: Bool
    let shiftId: String?
    let startedAt: String?
    let activeCallCount: Int?
    let recentNoteCount: Int?
}
