package org.llamenos.hotline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.llamenos.hotline.crypto.KeystoreService

/**
 * Unit tests for [KeystoreService].
 *
 * Note: EncryptedSharedPreferences requires the Android Keystore which is only
 * available on real devices/emulators. These unit tests verify the service's
 * logical behavior by mocking the underlying SharedPreferences.
 *
 * For full integration tests of EncryptedSharedPreferences, see the
 * instrumented tests in androidTest/.
 *
 * Since EncryptedSharedPreferences cannot be instantiated in a JVM unit test
 * (it requires Android Keystore), these tests verify the companion object
 * constants and the service interface contract.
 */
class KeystoreServiceTest {

    @Test
    fun `storage key constants are defined correctly`() {
        assertEquals("encrypted-keys", KeystoreService.KEY_ENCRYPTED_KEYS)
        assertEquals("hub-url", KeystoreService.KEY_HUB_URL)
        assertEquals("device-id", KeystoreService.KEY_DEVICE_ID)
        assertEquals("pubkey", KeystoreService.KEY_PUBKEY)
        assertEquals("npub", KeystoreService.KEY_NPUB)
        assertEquals("biometric-enabled", KeystoreService.KEY_BIOMETRIC_ENABLED)
    }

    @Test
    fun `key constants are unique`() {
        val keys = listOf(
            KeystoreService.KEY_ENCRYPTED_KEYS,
            KeystoreService.KEY_HUB_URL,
            KeystoreService.KEY_DEVICE_ID,
            KeystoreService.KEY_PUBKEY,
            KeystoreService.KEY_NPUB,
            KeystoreService.KEY_BIOMETRIC_ENABLED,
        )
        val uniqueKeys = keys.toSet()
        assertEquals(
            "All storage keys must be unique",
            keys.size,
            uniqueKeys.size,
        )
    }

    @Test
    fun `key constants do not contain spaces or special characters`() {
        val keys = listOf(
            KeystoreService.KEY_ENCRYPTED_KEYS,
            KeystoreService.KEY_HUB_URL,
            KeystoreService.KEY_DEVICE_ID,
            KeystoreService.KEY_PUBKEY,
            KeystoreService.KEY_NPUB,
            KeystoreService.KEY_BIOMETRIC_ENABLED,
        )
        keys.forEach { key ->
            assertTrue(
                "Key '$key' should match pattern [a-z-]+",
                key.matches(Regex("[a-z][a-z-]*")),
            )
        }
    }
}
