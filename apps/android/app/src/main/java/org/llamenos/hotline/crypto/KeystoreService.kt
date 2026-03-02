package org.llamenos.hotline.crypto

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * KeystoreService provides encrypted persistent storage backed by Android Keystore.
 *
 * Uses [EncryptedSharedPreferences] with a hardware-backed [MasterKey] (AES-256-GCM).
 * All values are encrypted at rest with key material that never leaves the Keystore.
 *
 * Storage layout:
 * - "encrypted-keys"  — PIN-encrypted nsec JSON (EncryptedKeyData serialized)
 * - "hub-url"         — Server endpoint URL
 * - "device-id"       — Unique device identifier
 * - "pubkey"          — Public key hex (for display when locked)
 * - "npub"            — Nostr npub (for display when locked)
 * - "biometric-enabled" — Whether biometric unlock is configured
 */
@Singleton
class KeystoreService @Inject constructor(
    @ApplicationContext private val context: Context,
) : KeyValueStore {

    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val prefs: SharedPreferences by lazy {
        EncryptedSharedPreferences.create(
            context,
            PREFS_FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Store a string value under the given key. The value is encrypted at rest.
     */
    override fun store(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    /**
     * Retrieve a previously stored value, or null if the key does not exist.
     */
    override fun retrieve(key: String): String? {
        return prefs.getString(key, null)
    }

    /**
     * Delete a single key-value pair.
     */
    override fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }

    /**
     * Clear all stored values. Used during account reset / logout.
     */
    override fun clear() {
        prefs.edit().clear().apply()
    }

    /**
     * Check whether a key exists in the store.
     */
    override fun contains(key: String): Boolean {
        return prefs.contains(key)
    }

    /**
     * Clear non-essential cached data while preserving identity keys and core settings.
     * Removes preferences like notification toggles, theme, profile info, etc.
     * Does NOT remove encrypted keys, hub URL, device ID, pubkey, npub, or biometric config.
     */
    fun clearCache() {
        val protectedKeys = setOf(
            KEY_ENCRYPTED_KEYS, KEY_HUB_URL, KEY_DEVICE_ID,
            KEY_PUBKEY, KEY_NPUB, KEY_BIOMETRIC_ENABLED,
        )
        val editor = prefs.edit()
        prefs.all.keys.filter { it !in protectedKeys }.forEach { key ->
            editor.remove(key)
        }
        editor.apply()
    }

    companion object {
        private const val PREFS_FILE_NAME = "llamenos_secure_prefs"

        // Well-known storage keys
        const val KEY_ENCRYPTED_KEYS = "encrypted-keys"
        const val KEY_HUB_URL = "hub-url"
        const val KEY_DEVICE_ID = "device-id"
        const val KEY_PUBKEY = "pubkey"
        const val KEY_NPUB = "npub"
        const val KEY_BIOMETRIC_ENABLED = "biometric-enabled"
    }
}
