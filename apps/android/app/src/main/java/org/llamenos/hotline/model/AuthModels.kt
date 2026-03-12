package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * Response from GET /api/auth/me.
 *
 * Contains the authenticated user's identity, roles, permissions,
 * and the server event encryption key needed to decrypt Nostr relay events.
 */
@Serializable
data class MeResponse(
    val pubkey: String,
    val roles: List<String> = emptyList(),
    val permissions: List<String> = emptyList(),
    val webauthnRequired: Boolean = false,
    val webauthnRegistered: Boolean = false,
    val adminDecryptionPubkey: String? = null,
    val serverEventKeyHex: String? = null,
)
