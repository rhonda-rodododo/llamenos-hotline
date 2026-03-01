package org.llamenos.hotline.crypto

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Serialized wake payload delivered inside an ECIES-encrypted push envelope.
 *
 * Wake-tier payloads are decryptable without user PIN unlock because the
 * wake key is stored without user authentication requirements. They carry
 * only minimal metadata — enough to display "New call available" on the
 * lock screen without revealing caller identity.
 */
@Serializable
data class WakePayload(
    val type: String,
    val callId: String? = null,
    val shiftId: String? = null,
    val timestamp: Long = 0,
    val message: String? = null,
)

/**
 * Device-level wake key service for decrypting lock-screen push notifications.
 *
 * The wake keypair is generated once and stored in [KeystoreService] (backed by
 * Android Keystore / EncryptedSharedPreferences). Unlike the user's Nostr nsec,
 * the wake key does NOT require PIN/biometric to access — it must be available
 * when [PushService] receives a message while the device is locked.
 *
 * Flow:
 * 1. On first use, [getOrCreateWakePublicKey] generates a keypair and stores it
 * 2. The wake public key is registered with the server (POST /api/v1/identity/device)
 * 3. Server encrypts push payloads with the device's wake public key
 * 4. [PushService] calls [decryptWakePayload] to get the plaintext metadata
 *
 * In production (post-Epic 201), ECIES operations will delegate to llamenos-core.
 * Currently uses placeholder implementations for development.
 */
@Singleton
class WakeKeyService @Inject constructor(
    private val keystoreService: KeystoreService,
) {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Get the wake public key, generating a new keypair if none exists.
     * This key is registered with the server for push notification encryption.
     */
    fun getOrCreateWakePublicKey(): String {
        val existing = keystoreService.retrieve(KEY_WAKE_PUBKEY)
        if (existing != null) return existing

        // Generate a new wake keypair
        val random = SecureRandom()
        val secretBytes = ByteArray(32)
        random.nextBytes(secretBytes)
        val secretHex = secretBytes.joinToString("") { "%02x".format(it) }

        val pubBytes = ByteArray(32)
        random.nextBytes(pubBytes)
        val pubHex = pubBytes.joinToString("") { "%02x".format(it) }

        keystoreService.store(KEY_WAKE_SECRET, secretHex)
        keystoreService.store(KEY_WAKE_PUBKEY, pubHex)

        return pubHex
    }

    /**
     * Check whether a wake keypair has been generated.
     */
    fun hasWakeKey(): Boolean {
        return keystoreService.contains(KEY_WAKE_PUBKEY)
    }

    /**
     * Decrypt a wake-tier push notification payload.
     *
     * The [encryptedHex] is the ECIES ciphertext from the push data envelope.
     * Returns the decoded [WakePayload] or null if decryption fails.
     *
     * In production this will call LlamenosCore.eciesDecrypt with the wake secret.
     * Currently returns a placeholder parsed from the hex as development stand-in.
     */
    suspend fun decryptWakePayload(encryptedHex: String): WakePayload? =
        withContext(Dispatchers.Default) {
            val secretHex = keystoreService.retrieve(KEY_WAKE_SECRET)
                ?: return@withContext null

            try {
                // Production (post-Epic 201):
                // val plaintext = LlamenosCore.eciesDecrypt(
                //     ciphertext = encryptedHex,
                //     secretKeyHex = secretHex,
                //     label = LABEL_WAKE_KEY_WRAP
                // )
                // return@withContext json.decodeFromString<WakePayload>(plaintext)

                // Placeholder: try to decode the hex as UTF-8 JSON
                val bytes = encryptedHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                val plaintext = String(bytes, Charsets.UTF_8)
                json.decodeFromString<WakePayload>(plaintext)
            } catch (_: Exception) {
                null
            }
        }

    companion object {
        private const val KEY_WAKE_SECRET = "wake-secret"
        private const val KEY_WAKE_PUBKEY = "wake-pubkey"
    }
}
