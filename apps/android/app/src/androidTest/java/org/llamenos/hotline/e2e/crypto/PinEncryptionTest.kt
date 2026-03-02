package org.llamenos.hotline.e2e.crypto

import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.llamenos.hotline.crypto.CryptoException
import org.llamenos.hotline.crypto.CryptoService
import javax.inject.Inject

/**
 * E2E tests for pin-encryption.feature scenarios.
 *
 * Feature: PIN Encryption
 * Verifies PIN-based key encryption/decryption on real Android hardware.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class PinEncryptionTest {

    @get:Rule
    val hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var cryptoService: CryptoService

    @Before
    fun setup() {
        hiltRule.inject()
    }

    // Scenario: PIN encryption roundtrip with correct PIN
    @Test
    fun pinEncryptionRoundtripWithCorrectPin() = runBlocking {
        cryptoService.generateKeypair()
        val originalPubkey = cryptoService.pubkey!!

        val encrypted = cryptoService.encryptForStorage("1234")
        cryptoService.lock()
        assertFalse(cryptoService.isUnlocked)

        cryptoService.decryptFromStorage(encrypted, "1234")
        assertTrue(cryptoService.isUnlocked)
        assertEquals(originalPubkey, cryptoService.pubkey)
    }

    // Scenario: PIN encryption fails with wrong PIN
    @Test
    fun pinEncryptionFailsWithWrongPin() = runBlocking {
        cryptoService.generateKeypair()
        val encrypted = cryptoService.encryptForStorage("1234")
        cryptoService.lock()

        try {
            cryptoService.decryptFromStorage(encrypted, "9999")
            fail("Should have thrown CryptoException")
        } catch (_: CryptoException) {
            assertFalse(cryptoService.isUnlocked)
        }
    }

    // Scenario: Encrypted key data has correct structure
    @Test
    fun encryptedKeyDataHasCorrectStructure() = runBlocking {
        cryptoService.generateKeypair()
        val originalPubkey = cryptoService.pubkey!!

        val encrypted = cryptoService.encryptForStorage("5678")
        assertTrue("Ciphertext should not be empty", encrypted.ciphertext.isNotEmpty())
        assertTrue("Salt should not be empty", encrypted.salt.isNotEmpty())
        assertTrue("Nonce should not be empty", encrypted.nonce.isNotEmpty())
        assertTrue("PubkeyHex should not be empty", encrypted.pubkeyHex.isNotEmpty())
        assertEquals("Iterations should be 600000", 600_000u, encrypted.iterations)
    }

    // Scenario Outline: PIN too short
    @Test
    fun pinValidationRejectsInvalidInputsTooShort() = runBlocking {
        cryptoService.generateKeypair()
        try {
            cryptoService.encryptForStorage("123")
            fail("Should fail for PIN too short")
        } catch (_: CryptoException) {
            // Expected
        }
    }

    // Scenario Outline: PIN too long
    @Test
    fun pinValidationRejectsInvalidInputsTooLong() = runBlocking {
        cryptoService.generateKeypair()
        try {
            cryptoService.encryptForStorage("1234567")
            fail("Should fail for PIN too long")
        } catch (_: CryptoException) {
            // Expected
        }
    }

    // Scenario Outline: PIN empty
    @Test
    fun pinValidationRejectsInvalidInputsEmpty() = runBlocking {
        cryptoService.generateKeypair()
        try {
            cryptoService.encryptForStorage("")
            fail("Should fail for empty PIN")
        } catch (_: CryptoException) {
            // Expected
        }
    }
}
