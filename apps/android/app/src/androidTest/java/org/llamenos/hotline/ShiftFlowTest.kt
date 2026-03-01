package org.llamenos.hotline

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for the shifts feature flow.
 *
 * Tests:
 * 1. Navigate to shifts tab
 * 2. View clock in/out card
 * 3. Clock in button presence
 * 4. Dashboard clock in/out quick action
 *
 * Prerequisites: The test must complete the auth flow first to reach
 * the main screen with bottom navigation.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ShiftFlowTest {

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
    fun navigateToShiftsTab() {
        navigateToMainScreen()

        // Tap Shifts tab
        composeRule.onNodeWithTag("nav-shifts").performClick()
        composeRule.waitForIdle()

        // Should show the clock in/out card
        composeRule.onNodeWithTag("clock-card").assertIsDisplayed()
        composeRule.onNodeWithTag("clock-status-text").assertIsDisplayed()
    }

    @Test
    fun shiftsTabShowsClockInButton() {
        navigateToMainScreen()

        // Navigate to Shifts tab
        composeRule.onNodeWithTag("nav-shifts").performClick()
        composeRule.waitForIdle()

        // Clock in button should be visible (default state is off-shift)
        composeRule.onNodeWithTag("clock-in-button").assertIsDisplayed()
    }

    @Test
    fun dashboardShowsShiftCard() {
        navigateToMainScreen()

        // Dashboard should show the shift status card
        composeRule.onNodeWithTag("shift-card").assertIsDisplayed()
        composeRule.onNodeWithTag("shift-status-text").assertIsDisplayed()
    }

    @Test
    fun dashboardShowsClockButton() {
        navigateToMainScreen()

        // Dashboard should show the quick clock in/out button
        composeRule.onNodeWithTag("dashboard-clock-button").assertIsDisplayed()
    }

    @Test
    fun dashboardShowsConnectionCard() {
        navigateToMainScreen()

        // Dashboard should show connection status
        composeRule.onNodeWithTag("connection-card").assertIsDisplayed()
        composeRule.onNodeWithTag("connection-status").assertIsDisplayed()
    }

    @Test
    fun dashboardShowsCallsCard() {
        navigateToMainScreen()

        // Dashboard should show active calls card
        composeRule.onNodeWithTag("calls-card").assertIsDisplayed()
        composeRule.onNodeWithTag("active-call-count").assertIsDisplayed()
    }

    @Test
    fun tabSwitchingPreservesState() {
        navigateToMainScreen()

        // Go to Shifts
        composeRule.onNodeWithTag("nav-shifts").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("clock-card").assertIsDisplayed()

        // Go to Notes
        composeRule.onNodeWithTag("nav-notes").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()

        // Go back to Dashboard
        composeRule.onNodeWithTag("nav-dashboard").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()

        // Go to Settings
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }
}
