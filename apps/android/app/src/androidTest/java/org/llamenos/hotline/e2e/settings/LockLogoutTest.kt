package org.llamenos.hotline.e2e.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.llamenos.hotline.MainActivity
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.helpers.NavTabs
import org.llamenos.hotline.helpers.TestNavigationHelper
import javax.inject.Inject

/**
 * E2E tests for lock-logout.feature scenarios.
 *
 * Feature: Lock & Logout
 * Tests locking the app and logging out. Needs @After cleanup since these
 * tests change auth state.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class LockLogoutTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Inject
    lateinit var keystoreService: KeystoreService

    @Inject
    lateinit var cryptoService: CryptoService

    @Before
    fun setup() {
        hiltRule.inject()
    }

    @After
    fun teardown() {
        keystoreService.clear()
        cryptoService.lock()
    }

    // Scenario: Lock app returns to PIN unlock
    @Test
    fun lockAppReturnsToPinUnlock() {
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)

        composeRule.onNodeWithTag("settings-lock-button").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }

    // Scenario: Logout shows confirmation dialog
    @Test
    fun logoutShowsConfirmationDialog() {
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)

        composeRule.onNodeWithTag("settings-logout-button").performScrollTo()
        composeRule.onNodeWithTag("settings-logout-button").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("logout-confirmation-dialog").assertIsDisplayed()
    }

    // Scenario: Cancel logout dismisses dialog
    @Test
    fun cancelLogoutDismissesDialog() {
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)

        composeRule.onNodeWithTag("settings-logout-button").performScrollTo()
        composeRule.onNodeWithTag("settings-logout-button").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("cancel-logout-button").performClick()
        composeRule.waitForIdle()

        // Should remain on settings
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }

    // Scenario: Confirm logout clears identity
    @Test
    fun confirmLogoutClearsIdentity() {
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)

        composeRule.onNodeWithTag("settings-logout-button").performScrollTo()
        composeRule.onNodeWithTag("settings-logout-button").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("confirm-logout-button").performClick()
        composeRule.waitForIdle()

        // Should be back on login screen
        composeRule.onNodeWithTag("app-title").assertIsDisplayed()
        composeRule.onNodeWithTag("create-identity").assertIsDisplayed()
    }
}
