package org.llamenos.hotline.e2e.admin

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
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.llamenos.hotline.MainActivity
import org.llamenos.hotline.crypto.CryptoException
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.helpers.NavTabs
import org.llamenos.hotline.helpers.TestNavigationHelper
import javax.inject.Inject

/**
 * E2E tests for access-control.feature scenarios.
 *
 * Feature: Access Control
 * Tests that locked state restricts access and unlocked state provides it.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AccessControlTest {

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

    private fun setupLockedIdentity() {
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

    // Scenario: Locked state restricts to PIN unlock only
    @Test
    fun lockedStateRestrictsToPinUnlockOnly() {
        setupLockedIdentity()
        // When locked with stored identity, should show PIN unlock
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
    }

    // Scenario: Unlocked state provides full app access
    @Test
    fun unlockedStateProvidesFullAppAccess() {
        TestNavigationHelper.navigateToMainScreen(composeRule)
        composeRule.onNodeWithTag(NavTabs.DASHBOARD).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.NOTES).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.CONVERSATIONS).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.SHIFTS).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.SETTINGS).assertIsDisplayed()
    }

    // Scenario: Crypto operations blocked when locked
    @Test
    fun cryptoOperationsBlockedWhenLocked() {
        cryptoService.generateKeypair()
        cryptoService.lock()
        assertFalse(cryptoService.isUnlocked)

        try {
            cryptoService.createAuthTokenSync("GET", "/api/notes")
            fail("Should have thrown CryptoException")
        } catch (_: CryptoException) {
            // Expected
        }

        try {
            runBlocking {
                cryptoService.encryptNote("{}", emptyList())
            }
            fail("Should have thrown CryptoException")
        } catch (_: CryptoException) {
            // Expected
        }
    }
}
