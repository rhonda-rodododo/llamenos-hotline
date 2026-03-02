package org.llamenos.hotline.helpers

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.rules.ActivityScenarioRule
import org.llamenos.hotline.MainActivity

/**
 * Shared test navigation helper used across all E2E tests.
 *
 * Eliminates duplication of the auth flow (create identity → confirm backup → PIN → dashboard)
 * that was previously copied into every test file.
 */
object TestNavigationHelper {

    /**
     * Complete the auth flow: create identity → confirm backup → PIN 1234 → confirm PIN 1234.
     * After this, the app is on the dashboard (main screen).
     */
    fun navigateToMainScreen(
        composeRule: AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>,
    ) {
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()
        // Enter PIN: 1234
        for (digit in listOf("1", "2", "3", "4")) {
            composeRule.onNodeWithTag("pin-$digit").performClick()
        }
        composeRule.waitForIdle()
        // Confirm PIN: 1234
        for (digit in listOf("1", "2", "3", "4")) {
            composeRule.onNodeWithTag("pin-$digit").performClick()
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    /**
     * Navigate to a specific bottom nav tab from the main screen.
     */
    fun navigateToTab(
        composeRule: AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>,
        tabTag: String,
    ) {
        composeRule.onNodeWithTag(tabTag).performClick()
        composeRule.waitForIdle()
    }
}

/**
 * Well-known bottom navigation tab test tags.
 */
object NavTabs {
    const val DASHBOARD = "nav-dashboard"
    const val NOTES = "nav-notes"
    const val CONVERSATIONS = "nav-conversations"
    const val SHIFTS = "nav-shifts"
    const val SETTINGS = "nav-settings"
}
