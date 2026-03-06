import SwiftUI

extension ConnectionState {
    var color: Color {
        switch self {
        case .connected: return .statusActive
        case .connecting, .reconnecting: return .statusWarning
        case .disconnected: return .brandDestructive
        }
    }
}
