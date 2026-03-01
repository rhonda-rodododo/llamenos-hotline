import Foundation

// MARK: - UserRole

/// Roles in the system, matching the protocol spec.
enum UserRole: String, Codable, Sendable, CaseIterable {
    case volunteer
    case admin

    var displayName: String {
        switch self {
        case .volunteer: return NSLocalizedString("role_volunteer", comment: "Volunteer")
        case .admin: return NSLocalizedString("role_admin", comment: "Admin")
        }
    }

    var badgeColor: String {
        switch self {
        case .volunteer: return "blue"
        case .admin: return "purple"
        }
    }
}

// MARK: - VolunteerStatus

/// Volunteer account status.
enum VolunteerStatus: String, Codable, Sendable, CaseIterable {
    case active
    case inactive
    case suspended

    var displayName: String {
        switch self {
        case .active: return NSLocalizedString("status_active", comment: "Active")
        case .inactive: return NSLocalizedString("status_inactive", comment: "Inactive")
        case .suspended: return NSLocalizedString("status_suspended", comment: "Suspended")
        }
    }
}

// MARK: - Volunteer

/// A volunteer/admin member from the API.
struct Volunteer: Codable, Identifiable, Sendable {
    let id: String
    let pubkey: String
    let displayName: String?
    let role: String
    let status: String
    let createdAt: String

    /// Parsed role enum.
    var userRole: UserRole {
        UserRole(rawValue: role) ?? .volunteer
    }

    /// Parsed status enum.
    var volunteerStatus: VolunteerStatus {
        VolunteerStatus(rawValue: status) ?? .active
    }

    /// Display name or truncated pubkey.
    var displayLabel: String {
        if let name = displayName, !name.isEmpty {
            return name
        }
        return truncatedPubkey
    }

    /// Truncated pubkey for display.
    var truncatedPubkey: String {
        guard pubkey.count > 16 else { return pubkey }
        return "\(pubkey.prefix(8))...\(pubkey.suffix(6))"
    }

    /// Parsed creation date.
    var createdDate: Date? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: createdAt) { return date }
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: createdAt)
    }
}

// MARK: - BanEntry

/// A ban list entry from the API.
struct BanEntry: Codable, Identifiable, Sendable {
    let id: String
    let identifierHash: String
    let reason: String?
    let createdBy: String
    let createdAt: String

    /// Truncated identifier hash for display.
    var truncatedHash: String {
        guard identifierHash.count > 16 else { return identifierHash }
        return "\(identifierHash.prefix(8))...\(identifierHash.suffix(6))"
    }

    /// Truncated creator pubkey for display.
    var creatorDisplay: String {
        guard createdBy.count > 16 else { return createdBy }
        return "\(createdBy.prefix(8))...\(createdBy.suffix(6))"
    }

    /// Parsed creation date.
    var createdDate: Date? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: createdAt) { return date }
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: createdAt)
    }
}

// MARK: - AuditEntry

/// A hash-chained audit log entry from the API.
struct AuditEntry: Codable, Identifiable, Sendable {
    let id: String
    let action: String
    let actorPubkey: String
    let details: String?
    let entryHash: String
    let previousEntryHash: String?
    let timestamp: String

    /// Truncated actor pubkey for display.
    var actorDisplay: String {
        guard actorPubkey.count > 16 else { return actorPubkey }
        return "\(actorPubkey.prefix(8))...\(actorPubkey.suffix(6))"
    }

    /// Truncated entry hash for display.
    var truncatedEntryHash: String {
        guard entryHash.count > 16 else { return entryHash }
        return "\(entryHash.prefix(8))...\(entryHash.suffix(6))"
    }

    /// Parsed timestamp.
    var timestampDate: Date? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: timestamp) { return date }
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: timestamp)
    }

    /// Human-readable action description.
    var actionDisplay: String {
        action.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

// MARK: - Invite

/// An invite code from the API.
struct Invite: Codable, Identifiable, Sendable {
    let id: String
    let code: String
    let role: String
    let createdBy: String
    let claimedBy: String?
    let expiresAt: String
    let createdAt: String

    /// Whether this invite has been claimed.
    var isClaimed: Bool { claimedBy != nil }

    /// Whether this invite has expired.
    var isExpired: Bool {
        guard let date = expiresDate else { return false }
        return date < Date()
    }

    /// Whether this invite is currently usable (not claimed and not expired).
    var isActive: Bool { !isClaimed && !isExpired }

    /// Parsed role enum.
    var inviteRole: UserRole {
        UserRole(rawValue: role) ?? .volunteer
    }

    /// Parsed expiry date.
    var expiresDate: Date? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: expiresAt) { return date }
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: expiresAt)
    }

    /// Parsed creation date.
    var createdDate: Date? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: createdAt) { return date }
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: createdAt)
    }

    /// Truncated creator pubkey.
    var creatorDisplay: String {
        guard createdBy.count > 16 else { return createdBy }
        return "\(createdBy.prefix(8))...\(createdBy.suffix(6))"
    }
}

// MARK: - API Response Types

/// API response for the volunteers list.
struct VolunteersListResponse: Codable, Sendable {
    let members: [Volunteer]
}

/// API response for the ban list.
struct BanListResponse: Codable, Sendable {
    let bans: [BanEntry]
}

/// API response for the audit log.
struct AuditLogResponse: Codable, Sendable {
    let entries: [AuditEntry]
    let total: Int
}

/// API response for the invites list.
struct InvitesListResponse: Codable, Sendable {
    let invites: [Invite]
}

// MARK: - Request Types

/// Request body for `POST /api/identity/invite`.
struct CreateInviteRequest: Encodable, Sendable {
    let role: String
}

/// Request body for `POST /api/bans`.
struct CreateBanRequest: Encodable, Sendable {
    let identifierHash: String
    let reason: String?
}

/// Request body for `PATCH /api/identity/:pubkey/role`.
struct UpdateRoleRequest: Encodable, Sendable {
    let role: String
}
