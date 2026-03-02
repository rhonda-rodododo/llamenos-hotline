package org.llamenos.hotline.e2e.crypto

import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
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
 * E2E tests for auth-tokens.feature scenarios.
 *
 * Feature: Auth Token Creation
 * Verifies Schnorr auth token creation on real Android hardware.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AuthTokenTest {

    @get:Rule
    val hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var cryptoService: CryptoService

    @Before
    fun setup() {
        hiltRule.inject()
    }

    // Scenario: Auth token has correct structure
    @Test
    fun authTokenHasCorrectStructure() = runBlocking {
        cryptoService.generateKeypair()
        val pubkey = cryptoService.pubkey!!

        val token = cryptoService.createAuthToken("GET", "/api/notes")

        assertEquals("Token pubkey should match", pubkey, token.pubkey)

        val now = System.currentTimeMillis()
        assertTrue(
            "Timestamp should be within last minute",
            now - token.timestamp < 60_000
        )
        assertEquals("Signature should be 128 hex chars", 128, token.token.length)
    }

    // Scenario: Auth token is unique per request
    @Test
    fun authTokenIsUniquePerRequest() = runBlocking {
        cryptoService.generateKeypair()

        val token1 = cryptoService.createAuthToken("GET", "/api/notes")
        val token2 = cryptoService.createAuthToken("POST", "/api/notes")

        assertNotEquals("Signatures should differ", token1.token, token2.token)
    }

    // Scenario: Locked crypto service cannot create tokens
    @Test
    fun lockedCryptoServiceCannotCreateTokens() {
        cryptoService.generateKeypair()
        cryptoService.lock()

        try {
            cryptoService.createAuthTokenSync("GET", "/api/notes")
            fail("Should have thrown CryptoException")
        } catch (_: CryptoException) {
            // Expected
        }
    }
}
