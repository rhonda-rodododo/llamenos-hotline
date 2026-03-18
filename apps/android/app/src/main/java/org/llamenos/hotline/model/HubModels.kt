package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * A hub representing a hotline operation.
 *
 * Client-specific shape — the generated HubResponse uses enum status
 * (HubResponseStatus) and has optional slug/createdAt/updatedAt, while
 * this type uses String status with non-nullable defaults for createdBy,
 * createdAt, updatedAt (fields not in the generated type).
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
 * Client-side wrapper that uses the client Hub type.
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
 * Client-specific simplified shape — matches CreateHubBody but without slug.
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
 * Client-specific simplified shape — matches UpdateHubBody but without
 * slug and status (enum) fields.
 */
@Serializable
data class UpdateHubRequest(
    val name: String? = null,
    val description: String? = null,
    val phoneNumber: String? = null,
)
