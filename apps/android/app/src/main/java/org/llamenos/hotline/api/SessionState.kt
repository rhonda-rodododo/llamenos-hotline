package org.llamenos.hotline.api

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Holds runtime session state fetched from the API (e.g., GET /api/auth/me).
 * Injected as a singleton so all ViewModels share the same state.
 */
@Singleton
class SessionState @Inject constructor() {
    /** Admin decryption pubkey for E2EE envelope encryption. */
    @Volatile
    var adminDecryptionPubkey: String? = null

    /** Convenience: returns a list containing the admin pubkey, or empty if not set. */
    val adminPubkeys: List<String>
        get() = listOfNotNull(adminDecryptionPubkey)
}
