package org.llamenos.hotline.crypto

/**
 * Interface for encrypted key-value storage.
 *
 * Implemented by [KeystoreService] (Android Keystore-backed EncryptedSharedPreferences)
 * and [InMemoryKeyValueStore] (for unit tests).
 */
interface KeyValueStore {
    fun store(key: String, value: String)
    fun retrieve(key: String): String?
    fun delete(key: String)
    fun clear()
    fun contains(key: String): Boolean
}
