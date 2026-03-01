package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * A volunteer registered in the system.
 *
 * Only admins can view the full volunteer list. [displayName] is optional
 * and may be null if the volunteer has not set one.
 */
@Serializable
data class Volunteer(
    val id: String,
    val pubkey: String,
    val displayName: String? = null,
    val role: String,
    val status: String,
    val createdAt: String,
)

/**
 * Paginated response from GET /api/admin/volunteers.
 */
@Serializable
data class VolunteersListResponse(
    val volunteers: List<Volunteer>,
    val total: Int,
)

/**
 * A ban list entry. Phone numbers / identifiers are stored as one-way hashes
 * to prevent the server from having a plaintext blacklist of numbers.
 */
@Serializable
data class BanEntry(
    val id: String,
    val identifierHash: String,
    val reason: String? = null,
    val createdBy: String,
    val createdAt: String,
)

/**
 * Paginated response from GET /api/admin/bans.
 */
@Serializable
data class BanListResponse(
    val bans: List<BanEntry>,
    val total: Int,
)

/**
 * Request body for adding a ban via POST /api/admin/bans.
 */
@Serializable
data class AddBanRequest(
    val identifier: String,
    val reason: String? = null,
)

/**
 * A hash-chained audit log entry.
 *
 * Each entry includes [entryHash] (SHA-256 of the entry) and
 * [previousEntryHash] (the prior entry's hash) forming an
 * append-only tamper-evident chain.
 */
@Serializable
data class AuditEntry(
    val id: String,
    val action: String,
    val actorPubkey: String,
    val details: String? = null,
    val entryHash: String,
    val previousEntryHash: String? = null,
    val timestamp: String,
)

/**
 * Paginated response from GET /api/admin/audit.
 */
@Serializable
data class AuditLogResponse(
    val entries: List<AuditEntry>,
    val total: Int,
    val page: Int,
)

/**
 * An invite code for onboarding new volunteers.
 *
 * Invite codes are single-use and time-limited. Once [claimedBy] is set,
 * the invite cannot be used again.
 */
@Serializable
data class Invite(
    val id: String,
    val code: String,
    val role: String,
    val createdBy: String,
    val claimedBy: String? = null,
    val expiresAt: String,
    val createdAt: String,
)

/**
 * Paginated response from GET /api/admin/invites.
 */
@Serializable
data class InvitesListResponse(
    val invites: List<Invite>,
    val total: Int,
)

/**
 * Request body for creating an invite via POST /api/admin/invites.
 */
@Serializable
data class CreateInviteRequest(
    val role: String,
)
