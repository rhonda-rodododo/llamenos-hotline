package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * A hub representing a hotline operation.
 *
 * Hubs are the top-level organizational unit: each hub has its own
 * phone number, volunteers, shifts, and settings.
 */
@Serializable
data class Hub(
    val id: String,
    val name: String,
    val slug: String,
    val description: String? = null,
    val status: String = "active",
    val phoneNumber: String? = null,
    val createdBy: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
)

/**
 * Response from GET /api/hubs.
 */
@Serializable
data class HubsListResponse(
    val hubs: List<Hub>,
)

/**
 * Response from POST /api/hubs.
 */
@Serializable
data class CreateHubResponse(
    val hub: Hub,
)

/**
 * Request body for POST /api/hubs.
 */
@Serializable
data class CreateHubRequest(
    val name: String,
    val description: String? = null,
    val phoneNumber: String? = null,
)

/**
 * Response from PATCH /api/hubs/:id.
 */
@Serializable
data class UpdateHubResponse(
    val hub: Hub,
)

/**
 * Request body for PATCH /api/hubs/:id.
 */
@Serializable
data class UpdateHubRequest(
    val name: String? = null,
    val description: String? = null,
    val phoneNumber: String? = null,
)
