package org.llamenos.hotline

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for the admin feature flow.
 *
 * Tests:
 * 1. Navigate to admin panel via settings
 * 2. Verify admin tabs are present
 * 3. Switch between admin tabs
 * 4. Settings shows device link and admin cards
 *
 * Prerequisites: The test must complete the auth flow first to reach
 * the main screen with bottom navigation.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AdminFlowTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    /**
     * Complete the auth flow to reach the main screen.
     */
    private fun navigateToMainScreen() {
        // Create identity
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()

        // Confirm backup
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()

        // Enter PIN: 1234
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // Confirm PIN: 1234
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // Should reach main screen with dashboard
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    @Test
    fun settingsShowsDeviceLinkCard() {
        navigateToMainScreen()

        // Navigate to Settings tab
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()

        // Device link card should be visible
        composeRule.onNodeWithTag("settings-device-link-card").performScrollTo()
        composeRule.onNodeWithTag("settings-device-link-card").assertIsDisplayed()
    }

    @Test
    fun settingsShowsAdminCard() {
        navigateToMainScreen()

        // Navigate to Settings tab
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()

        // Admin card should be visible
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").assertIsDisplayed()
    }

    @Test
    fun navigateToAdminPanel() {
        navigateToMainScreen()

        // Navigate to Settings tab
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()

        // Tap admin card
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()

        // Admin screen should be displayed with title and tabs
        composeRule.onNodeWithTag("admin-title").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tabs").assertIsDisplayed()
    }

    @Test
    fun adminTabsArePresent() {
        navigateToMainScreen()

        // Navigate to admin panel
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()

        // Verify all four tabs are present
        composeRule.onNodeWithTag("admin-tab-volunteers").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tab-bans").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tab-audit").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tab-invites").assertIsDisplayed()
    }

    @Test
    fun switchBetweenAdminTabs() {
        navigateToMainScreen()

        // Navigate to admin panel
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()

        // Default tab should be Volunteers
        composeRule.onNodeWithTag("admin-tab-volunteers").assertIsDisplayed()

        // Switch to Bans tab
        composeRule.onNodeWithTag("admin-tab-bans").performClick()
        composeRule.waitForIdle()

        // Bans tab content should be shown (loading, empty, or list)
        val hasBansContent = try {
            composeRule.onNodeWithTag("bans-loading").assertIsDisplayed()
            true
        } catch (_: AssertionError) {
            try {
                composeRule.onNodeWithTag("bans-empty").assertIsDisplayed()
                true
            } catch (_: AssertionError) {
                try {
                    composeRule.onNodeWithTag("bans-list").assertIsDisplayed()
                    true
                } catch (_: AssertionError) {
                    false
                }
            }
        }
        assert(hasBansContent) { "Bans tab should show loading, empty, or list" }

        // Switch to Audit tab
        composeRule.onNodeWithTag("admin-tab-audit").performClick()
        composeRule.waitForIdle()

        // Switch to Invites tab
        composeRule.onNodeWithTag("admin-tab-invites").performClick()
        composeRule.waitForIdle()

        // Switch back to Volunteers
        composeRule.onNodeWithTag("admin-tab-volunteers").performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun adminBackNavigatesToSettings() {
        navigateToMainScreen()

        // Navigate to admin panel
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()

        // Verify we are on admin screen
        composeRule.onNodeWithTag("admin-title").assertIsDisplayed()

        // Tap back
        composeRule.onNodeWithTag("admin-back").performClick()
        composeRule.waitForIdle()

        // Should be back on settings
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }
}
