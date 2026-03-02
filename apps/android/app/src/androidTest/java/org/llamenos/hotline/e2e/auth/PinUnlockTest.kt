package org.llamenos.hotline.e2e.auth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.llamenos.hotline.MainActivity
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.helpers.enterPin
import javax.inject.Inject

/**
 * E2E tests for pin-unlock.feature scenarios.
 *
 * Feature: PIN Unlock
 * Tests unlocking the app with a stored identity.
 * Requires pre-populating stored keys to simulate a returning user.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class PinUnlockTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Inject
    lateinit var cryptoService: CryptoService

    @Inject
    lateinit var keystoreService: KeystoreService

    @Before
    fun setup() {
        hiltRule.inject()
        setupStoredIdentity()
    }

    @After
    fun teardown() {
        keystoreService.clear()
        cryptoService.lock()
    }

    @Serializable
    private data class StoredKeyData(
        val ciphertext: String,
        val salt: String,
        val nonce: String,
        val pubkeyHex: String,
        val iterations: UInt = 600_000u,
    )

    private fun setupStoredIdentity() {
        cryptoService.generateKeypair()
        runBlocking {
            val encrypted = cryptoService.encryptForStorage("1234")
            val stored = Json.encodeToString(
                StoredKeyData(
                    ciphertext = encrypted.ciphertext,
                    salt = encrypted.salt,
                    nonce = encrypted.nonce,
                    pubkeyHex = encrypted.pubkeyHex,
                    iterations = encrypted.iterations,
                )
            )
            keystoreService.store(KeystoreService.KEY_ENCRYPTED_KEYS, stored)
            keystoreService.store(KeystoreService.KEY_PUBKEY, cryptoService.pubkey!!)
            keystoreService.store(KeystoreService.KEY_NPUB, cryptoService.npub!!)
        }
        cryptoService.lock()
    }

    // Scenario: Unlock screen displays for returning user
    @Test
    fun unlockScreenDisplaysForReturningUser() {
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }

    // Scenario: Correct PIN unlocks the app
    @Test
    fun correctPinUnlocksTheApp() {
        composeRule.enterPin("1234")
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    // Scenario: Wrong PIN shows error
    @Test
    fun wrongPinShowsError() {
        composeRule.enterPin("9999")
        composeRule.onNodeWithTag("pin-error").assertIsDisplayed()
    }

    // Scenario: Multiple wrong PINs allow retry
    @Test
    fun multipleWrongPinsAllowRetry() {
        composeRule.enterPin("0000")
        composeRule.onNodeWithTag("pin-error").assertIsDisplayed()
        composeRule.enterPin("1111")
        composeRule.onNodeWithTag("pin-error").assertIsDisplayed()
        composeRule.enterPin("1234")
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    // Scenario: Reset identity from unlock screen
    @Test
    fun resetIdentityFromUnlockScreen() {
        composeRule.onNodeWithTag("reset-identity").assertIsDisplayed()
        // Note: This test verifies the reset button exists on the unlock screen.
        // Full reset flow (confirmation dialog, clearing keys) depends on UI implementation.
    }
}
